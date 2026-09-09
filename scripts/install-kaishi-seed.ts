import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createKuromojiAnalyzer } from "../src/analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../src/analysis/loaders.ts";
import {
  compileKaishiCompactPool,
  DEFAULT_KAISHI_SEED_PATH,
} from "../src/study/kaishi-seed.ts";

const usage = (): never => {
  console.error(
    "Usage: bun run kaishi:install -- --source <compact-kaishi.json> " +
      `[--output ${DEFAULT_KAISHI_SEED_PATH}]`,
  );
  process.exit(2);
};

const arguments_ = process.argv.slice(2);
const option = (name: string): string | null => {
  const index = arguments_.indexOf(name);
  if (index < 0 || index + 1 >= arguments_.length) return null;
  return arguments_[index + 1] ?? null;
};
const sourcePath = option("--source");
const outputPath = option("--output") ?? DEFAULT_KAISHI_SEED_PATH;
if (sourcePath === null || sourcePath.trim() === "" || outputPath.trim() === "")
  usage();

let value: unknown;
try {
  const file = Bun.file(resolve(sourcePath));
  if (!(await file.exists()) || file.size > 2 * 1024 * 1024) throw new Error();
  value = JSON.parse(await file.text());
} catch {
  console.error(
    "Kaishi installation failed: the source is unreadable or invalid JSON.",
  );
  process.exit(1);
}
if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
  console.error("Kaishi installation failed: the source must be a JSON string array.");
  process.exit(1);
}

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const compiled = await compileKaishiCompactPool(value, analyzer);
if (!compiled.ok) {
  console.error(`Kaishi installation failed: ${compiled.error.kind}.`);
  process.exit(1);
}
const destination = resolve(outputPath);
try {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(compiled.value.manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
} catch {
  console.error(
    "Kaishi installation failed: output already exists or cannot be written.",
  );
  process.exit(1);
}
console.info(
  `Installed ${compiled.value.manifest.entries.length} unique lexical entries from ` +
    `${compiled.value.manifest.sourceEntryCount} private source rows.`,
);
console.info(
  `Skipped ${compiled.value.unsupportedEntryCount} ambiguous/non-content rows and ` +
    `${compiled.value.duplicateLexemeCount} duplicate lexical identities.`,
);
console.info("Restart Gafu V2 to apply the private Known Word Bank seed.");
