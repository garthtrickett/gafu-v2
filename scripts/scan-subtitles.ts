/**
 * Reads Japanese SRTs and reports what is worth a Card, using only local
 * analysis and the Study data already on the server. It calls no AI provider
 * and writes nothing: it is the half of Preparation that is deterministic and
 * free, separated from the half that asks a model for evidence.
 *
 *   GAFU_ACCESS_PASSWORD=... bun run subs:scan <file.srt>...
 *
 * Cue text is read from the files given and never written anywhere, because
 * subtitle bodies from copyrighted media must not enter the repository.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createKuromojiAnalyzer } from "../src/analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../src/analysis/loaders.ts";
import { declaredGrammarDetector } from "../src/learning-material/declared-grammar.ts";
import {
  canonicalVocabulary,
  earnsCandidate,
} from "../src/preparation/evidence-expectations.ts";
import { phase3ImportPolicy } from "../src/preparation/import-contracts.ts";
import { parseSrt } from "../src/preparation/srt.ts";

const baseUrl =
  process.env["GAFU_BASE_URL"] ?? "https://gafu-v2-production.up.railway.app";
const password = process.env["GAFU_ACCESS_PASSWORD"] ?? "";
const files = process.argv.slice(2);

if (files.length === 0) throw new Error("Pass at least one .srt path.");
if (password === "") throw new Error("GAFU_ACCESS_PASSWORD is required.");

const signIn = async (): Promise<string> => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");
  if (cookie === null) throw new Error(`Sign-in failed with HTTP ${response.status}.`);
  return cookie.split(";")[0] ?? "";
};

type StudySnapshot = {
  cards: readonly {
    type: string;
    content: {
      lemma?: string;
      reading?: string;
      partOfSpeech?: string;
      canonicalForm?: string;
    };
  }[];
  knowledge: {
    vocabulary: readonly {
      lemma: string;
      reading: string;
      partOfSpeech: string | null;
    }[];
  };
};

const cookie = await signIn();
const studyResponse = await fetch(`${baseUrl}/api/study`, { headers: { cookie } });
if (!studyResponse.ok)
  throw new Error(`Study read failed: HTTP ${studyResponse.status}`);
const study = (await studyResponse.json()) as StudySnapshot;

/**
 * Matched on lemma and part of speech, deliberately not on reading.
 * `token.lemma` is the dictionary form but `token.reading` is the surface
 * reading, so an inflected 忘れない yields `忘れる` paired with `わすれ` and
 * matches neither the baseline's `わすれる` nor anything else. Pairing them is
 * an incoherent identity; over ordinary conversational Japanese it reported 12
 * of 34 demonstrably known words as new.
 */
const formKey = (lemma: string, partOfSpeech: string | null): string =>
  `${lemma}\u0000${partOfSpeech ?? ""}`;

// A Card and a Known Word are both reasons not to propose something.
const carded = new Set(
  study.cards.flatMap((card) =>
    card.type === "vocabulary" && card.content.lemma !== undefined
      ? [formKey(card.content.lemma, card.content.partOfSpeech ?? null)]
      : [],
  ),
);
/**
 * The detector and the Cards write the same form differently: `\uff5e\u3093\u3067\u3059` against
 * `~\u3093\u3067\u3059`, `\u301c\u306e\u306b` against `\u306e\u306b`, `\u301c\u306e\u3067` against `\u306e\u3067 / \u304b\u3089`. Comparing them
 * literally reported \u306e\u306b, \u306a\u304c\u3089 and \u306e\u3067 as uncarded when they are carded.
 * Strip the placeholder tilde and treat a slash as listing alternates.
 */
const grammarForms = (form: string): readonly string[] =>
  form
    .split("/")
    .map((part) => part.replace(/^[\uff5e\u301c~]+/u, "").trim())
    .filter((part) => part !== "");

const cardedGrammar = new Set(
  study.cards.flatMap((card) =>
    card.type === "grammar" && card.content.canonicalForm !== undefined
      ? grammarForms(card.content.canonicalForm)
      : [],
  ),
);
const known = new Set(
  study.knowledge.vocabulary.map((entry) =>
    formKey(entry.lemma, entry.partOfSpeech ?? null),
  ),
);

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);

type Candidate = {
  canonicalKey: string;
  surface: string;
  lemma: string;
  reading: string | null;
  partOfSpeech: string;
  tags: string;
  count: number;
  example: string;
};

const vocabulary = new Map<string, Candidate>();
const grammar = new Map<string, { count: number; example: string }>();
let cueCount = 0;

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
    const analyzed = await analyzer.analyze(cue.cueKey, cue.normalizedText);
    if (!analyzed.ok) continue;
    cueCount += 1;
    const text = analyzed.value.normalizedText;
    for (const token of analyzed.value.tokens) {
      if (!earnsCandidate(token)) continue;
      const key = formKey(token.lemma, token.broadPartOfSpeech);
      const existing = vocabulary.get(key);
      if (existing === undefined) {
        vocabulary.set(key, {
          canonicalKey: canonicalVocabulary(token.lemma, token.reading),
          surface: token.surface,
          lemma: token.lemma,
          reading: token.reading,
          partOfSpeech: token.broadPartOfSpeech,
          tags: token.partOfSpeech.filter((part) => part !== "*").join("/"),
          count: 1,
          example: text,
        });
      } else existing.count += 1;
    }
    for (const detected of declaredGrammarDetector.detect(text)) {
      const existing = grammar.get(detected.canonicalForm);
      if (existing === undefined)
        grammar.set(detected.canonicalForm, { count: 1, example: text });
      else existing.count += 1;
    }
  }
}

const status = (key: string): "known" | "carded" | "new" =>
  known.has(key) ? "known" : carded.has(key) ? "carded" : "new";

const newVocabulary = [...vocabulary.entries()]
  .filter(([key]) => status(key) === "new")
  .map(([, item]) => item)
  .sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma));
const newGrammar = [...grammar.entries()]
  .filter(([form]) => !grammarForms(form).some((part) => cardedGrammar.has(part)))
  .sort((a, b) => b[1].count - a[1].count);

console.log(
  `\n${cueCount} cues · ${vocabulary.size} distinct words · ` +
    `${vocabulary.size - newVocabulary.length} already known or carded · ` +
    `${newVocabulary.length} new\n`,
);
// Everything, annotated. The scan supplies what is tedious and error-prone to
// establish by eye -- every distinct form, its tags, and whether it is already
// known or carded -- and leaves which of them deserve a Card to the reader.
console.log("NEW VOCABULARY");
for (const item of newVocabulary) {
  console.log(
    `${String(item.count).padStart(3)}x  ${`${item.lemma}(${item.reading ?? "?"})`.padEnd(26)} ` +
      `${item.tags.padEnd(26)} ${item.example.slice(0, 40)}`,
  );
}
console.log(`\nGRAMMAR NOT YET CARDED (${newGrammar.length})`);
for (const [form, item] of newGrammar.slice(0, 60)) {
  console.log(
    `${String(item.count).padStart(3)}x  ${form.padEnd(30)} ${item.example.slice(0, 42)}`,
  );
}
