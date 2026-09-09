import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../analysis/contracts.ts";
import { err, ok, type Result } from "../result.ts";
import type { KnownWordSeed, KnownWordSeedEntry } from "./contracts.ts";
import { normalizeVocabularyReading } from "./identity.ts";

export const KAISHI_SEED_SCHEMA = "gafu-known-word-seed-v1";
export const DEFAULT_KAISHI_SEED_PATH = "data/kaishi-1.5k.local.json";
const maximumSeedBytes = 2 * 1024 * 1024;
const maximumSourceEntries = 5_000;
const maximumFieldLength = 2_000;

const contentParts = new Set<BroadPartOfSpeech>([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "interjection",
]);

export type KaishiSeedManifest = KnownWordSeed &
  Readonly<{
    schema: typeof KAISHI_SEED_SCHEMA;
    sourceEntryCount: number;
  }>;

export type KaishiCompilation = Readonly<{
  manifest: KaishiSeedManifest;
  duplicateLexemeCount: number;
  unsupportedEntryCount: number;
}>;

export type KaishiSeedFailure =
  | { readonly kind: "sourceInvalid"; readonly detail: string }
  | { readonly kind: "analysisFailed"; readonly entryIndex: number }
  | { readonly kind: "manifestInvalid"; readonly detail: string }
  | { readonly kind: "readFailed" };

type SeedRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is SeedRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalize = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const entryKey = (
  entry: Pick<KnownWordSeedEntry, "lemma" | "reading" | "partOfSpeech">,
) =>
  `kaishi-lexeme-v1:sha256:${sha256(
    JSON.stringify([entry.lemma, entry.reading, entry.partOfSpeech]),
  )}`;

const sortedEntries = (
  entries: readonly KnownWordSeedEntry[],
): readonly KnownWordSeedEntry[] =>
  [...entries].sort((left, right) => left.key.localeCompare(right.key, "en"));

const seedVersion = (entries: readonly KnownWordSeedEntry[]): string =>
  `sha256:${sha256(JSON.stringify(sortedEntries(entries)))}`;

const parseCompactEntry = (
  value: string,
  index: number,
): Result<Readonly<{ term: string; meaning: string }>, KaishiSeedFailure> => {
  const separator = value.indexOf(" - ");
  if (separator <= 0) {
    return err({
      kind: "sourceInvalid",
      detail: `Entry ${index + 1} does not use the compact Kaishi format.`,
    });
  }
  const display = normalize(value.slice(0, separator));
  const meaning = normalize(value.slice(separator + 3));
  const annotated = /^(.*?) \([^()]+\)$/u.exec(display);
  const term = normalize(annotated?.[1] ?? display);
  if (
    term === "" ||
    meaning === "" ||
    term.length > maximumFieldLength ||
    meaning.length > maximumFieldLength
  ) {
    return err({
      kind: "sourceInvalid",
      detail: `Entry ${index + 1} contains an empty or oversized field.`,
    });
  }
  return ok({ term, meaning });
};

export const compileKaishiCompactPool = async (
  source: readonly string[],
  analyzer: JapaneseAnalyzer,
): Promise<Result<KaishiCompilation, KaishiSeedFailure>> => {
  if (source.length === 0 || source.length > maximumSourceEntries) {
    return err({
      kind: "sourceInvalid",
      detail: `The source must contain 1–${maximumSourceEntries} entries.`,
    });
  }
  const entries = new Map<string, KnownWordSeedEntry>();
  let duplicateLexemeCount = 0;
  let unsupportedEntryCount = 0;
  for (const [index, raw] of source.entries()) {
    if (typeof raw !== "string") {
      return err({
        kind: "sourceInvalid",
        detail: `Entry ${index + 1} is not a string.`,
      });
    }
    const parsed = parseCompactEntry(raw, index);
    if (!parsed.ok) return parsed;
    const analyzed = await analyzer.analyze(
      `kaishi-source-${index + 1}`,
      parsed.value.term,
    );
    if (!analyzed.ok) return err({ kind: "analysisFailed", entryIndex: index });
    // Multi-token deck expressions do not safely prove that every component
    // lexeme is known. Keep this import conservative until phrase knowledge is
    // represented explicitly in the domain model.
    const tokens = analyzed.value.tokens.filter(
      (token) => contentParts.has(token.broadPartOfSpeech) && token.reading !== null,
    );
    if (tokens.length !== 1) {
      unsupportedEntryCount += 1;
      continue;
    }
    const token = tokens[0];
    if (token === undefined || token.reading === null) {
      unsupportedEntryCount += 1;
      continue;
    }
    const candidate: KnownWordSeedEntry = {
      key: "",
      lemma: normalize(token.lemma),
      reading: normalizeVocabularyReading(normalize(token.reading)),
      meaning: parsed.value.meaning,
      partOfSpeech: token.broadPartOfSpeech,
    };
    const key = entryKey(candidate);
    if (entries.has(key)) {
      duplicateLexemeCount += 1;
      continue;
    }
    entries.set(key, { ...candidate, key });
  }
  const canonicalEntries = sortedEntries([...entries.values()]);
  if (canonicalEntries.length === 0) {
    return err({
      kind: "sourceInvalid",
      detail: "No usable lexical entries remained.",
    });
  }
  return ok({
    manifest: {
      schema: KAISHI_SEED_SCHEMA,
      id: "kaishi-1.5k",
      version: seedVersion(canonicalEntries),
      availability: "available",
      sourceEntryCount: source.length,
      entries: canonicalEntries,
    },
    duplicateLexemeCount,
    unsupportedEntryCount,
  });
};

export const decodeKaishiSeedManifest = (
  value: unknown,
): Result<KaishiSeedManifest, KaishiSeedFailure> => {
  if (
    !isRecord(value) ||
    value["schema"] !== KAISHI_SEED_SCHEMA ||
    value["id"] !== "kaishi-1.5k" ||
    value["availability"] !== "available" ||
    !Number.isSafeInteger(value["sourceEntryCount"]) ||
    Number(value["sourceEntryCount"]) < 1 ||
    Number(value["sourceEntryCount"]) > maximumSourceEntries ||
    !Array.isArray(value["entries"]) ||
    value["entries"].length === 0 ||
    value["entries"].length > maximumSourceEntries ||
    Number(value["sourceEntryCount"]) < value["entries"].length ||
    typeof value["version"] !== "string"
  ) {
    return err({ kind: "manifestInvalid", detail: "Manifest envelope is invalid." });
  }
  const entries: KnownWordSeedEntry[] = [];
  const keys = new Set<string>();
  for (const candidate of value["entries"]) {
    if (!isRecord(candidate)) {
      return err({ kind: "manifestInvalid", detail: "Manifest entry is invalid." });
    }
    const lemma =
      typeof candidate["lemma"] === "string" ? normalize(candidate["lemma"]) : "";
    const reading =
      typeof candidate["reading"] === "string"
        ? normalizeVocabularyReading(normalize(candidate["reading"]))
        : "";
    const meaning =
      typeof candidate["meaning"] === "string" ? normalize(candidate["meaning"]) : "";
    const partOfSpeech = candidate["partOfSpeech"];
    const key = candidate["key"];
    if (
      lemma === "" ||
      reading === "" ||
      meaning === "" ||
      lemma.length > maximumFieldLength ||
      reading.length > maximumFieldLength ||
      meaning.length > maximumFieldLength ||
      typeof partOfSpeech !== "string" ||
      !contentParts.has(partOfSpeech as BroadPartOfSpeech) ||
      typeof key !== "string"
    ) {
      return err({
        kind: "manifestInvalid",
        detail: "Manifest entry fields are invalid.",
      });
    }
    const entry = { key, lemma, reading, meaning, partOfSpeech };
    if (key !== entryKey(entry) || keys.has(key)) {
      return err({ kind: "manifestInvalid", detail: "Manifest identity is invalid." });
    }
    keys.add(key);
    entries.push(entry);
  }
  const canonicalEntries = sortedEntries(entries);
  if (value["version"] !== seedVersion(canonicalEntries)) {
    return err({ kind: "manifestInvalid", detail: "Manifest digest is invalid." });
  }
  return ok({
    schema: KAISHI_SEED_SCHEMA,
    id: "kaishi-1.5k",
    version: value["version"],
    availability: "available",
    sourceEntryCount: Number(value["sourceEntryCount"]),
    entries: canonicalEntries,
  });
};

export const loadKaishiSeedManifest = (
  path: string,
): Result<KaishiSeedManifest, KaishiSeedFailure> => {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > maximumSeedBytes) {
      return err({ kind: "readFailed" });
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    return decodeKaishiSeedManifest(JSON.parse(text));
  } catch {
    return err({ kind: "readFailed" });
  }
};
