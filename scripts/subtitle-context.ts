/**
 * Shows every occurrence of the given words with the cues either side.
 *
 *   bun run subs:context <file.srt> -- 放題 山盛り 見極め
 *
 * A dictionary lists every sense and leaves you choosing; the surrounding cues
 * show the one actually in use, and supply the example sentence with it. This
 * reads only the file it is given, calls nothing, and writes nothing.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createKuromojiAnalyzer } from "../src/analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../src/analysis/loaders.ts";
import { phase3ImportPolicy } from "../src/preparation/import-contracts.ts";
import { parseSrt } from "../src/preparation/srt.ts";

const separator = process.argv.indexOf("--");
if (separator < 0) throw new Error("Usage: <file.srt>... -- <word>...");
const files = process.argv.slice(2, separator);
const targets = new Set(process.argv.slice(separator + 1));
if (files.length === 0 || targets.size === 0) {
  throw new Error("Give at least one file and one word.");
}

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);

type Occurrence = { readonly index: number; readonly surface: string };
const found = new Map<string, Occurrence[]>();
const lines: string[] = [];

for (const file of files) {
  const parsed = parseSrt(
    basename(file),
    basename(file),
    new Uint8Array(readFileSync(file)),
    phase3ImportPolicy,
  );
  if (!parsed.ok) {
    console.error(`${file}: ${parsed.error.kind}`);
    continue;
  }
  for (const cue of parsed.value.cues) {
    const index = lines.length;
    lines.push(cue.normalizedText);
    const analyzed = await analyzer.analyze(cue.cueKey, cue.normalizedText);
    if (!analyzed.ok) continue;
    for (const token of analyzed.value.tokens) {
      // Matched on lemma so an inflected occurrence still counts, and on
      // surface so a word written differently is not missed.
      const hit = targets.has(token.lemma)
        ? token.lemma
        : targets.has(token.surface)
          ? token.surface
          : null;
      if (hit === null) continue;
      const list = found.get(hit) ?? [];
      if (!list.some((item) => item.index === index)) {
        list.push({ index, surface: token.surface });
      }
      found.set(hit, list);
    }
  }
}

for (const word of targets) {
  const occurrences = found.get(word);
  console.log(`\n${"=".repeat(58)}\n${word}`);
  if (occurrences === undefined) {
    console.log("  (no occurrence found)");
    continue;
  }
  for (const { index, surface } of occurrences) {
    console.log(`  --- as ${surface} ---`);
    for (let at = index - 1; at <= index + 1; at += 1) {
      const line = lines[at];
      if (line === undefined) continue;
      console.log(`  ${at === index ? ">" : " "} ${line}`);
    }
  }
}
