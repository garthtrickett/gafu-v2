import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyzedToken, JapaneseAnalyzer } from "../analysis/contracts.ts";
import { ok } from "../result.ts";
import {
  compileKaishiCompactPool,
  decodeKaishiSeedManifest,
  loadKaishiSeedManifest,
} from "./kaishi-seed.ts";

const token = (
  surface: string,
  lemma: string,
  reading: string,
  broadPartOfSpeech: AnalyzedToken["broadPartOfSpeech"],
): AnalyzedToken => ({
  surface,
  lemma,
  reading,
  broadPartOfSpeech,
  partOfSpeech: [],
  conjugation: null,
  span: {
    start: 0,
    end: surface.length,
    unit: "utf16-code-unit",
    normalization: "nfkc-v1",
  },
  dictionaryFormFound: true,
  senseCandidates: [],
});

const analyzer: JapaneseAnalyzer = {
  name: "kaishi-fixture",
  analyze: async (cueId, rawText) => {
    const tokens =
      rawText === "好き"
        ? [token("好き", "好きだ", "すき", "adjective")]
        : rawText === "について"
          ? [token("について", "について", "について", "particle")]
          : [
              token("持っ", "持つ", "もつ", "verb"),
              token("くる", "くる", "くる", "verb"),
            ];
    return ok({
      cueId,
      rawText,
      normalizedText: rawText,
      normalization: "nfkc-v1",
      spanUnit: "utf16-code-unit",
      rawBoundaryByNormalizedCodeUnit: [],
      tokens,
    });
  },
};

describe("private Kaishi seed import", () => {
  test("compiles only unambiguous lexical identities and validates its digest", async () => {
    const compiled = await compileKaishiCompactPool(
      [
        "好き (すき) - liked",
        "好き (すき) - fond of",
        "について - regarding",
        "持ってくる (もってくる) - to bring",
      ],
      analyzer,
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.value.manifest.sourceEntryCount).toBe(4);
    expect(compiled.value.manifest.entries).toHaveLength(1);
    expect(compiled.value.manifest.entries[0]).toMatchObject({
      lemma: "好きだ",
      reading: "すき",
      partOfSpeech: "adjective",
    });
    expect(compiled.value.duplicateLexemeCount).toBe(1);
    expect(compiled.value.unsupportedEntryCount).toBe(2);
    expect(decodeKaishiSeedManifest(compiled.value.manifest)).toEqual({
      ok: true,
      value: compiled.value.manifest,
    });
    expect(
      decodeKaishiSeedManifest({
        ...compiled.value.manifest,
        version: "sha256:tampered",
      }),
    ).toMatchObject({ ok: false, error: { kind: "manifestInvalid" } });
  });

  test("loads a private manifest from disk without committing its content", async () => {
    const compiled = await compileKaishiCompactPool(["好き - liked"], analyzer);
    if (!compiled.ok) throw new Error(compiled.error.kind);
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-kaishi-"));
    try {
      const path = join(directory, "seed.json");
      writeFileSync(path, JSON.stringify(compiled.value.manifest));
      expect(loadKaishiSeedManifest(path)).toEqual({
        ok: true,
        value: compiled.value.manifest,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
