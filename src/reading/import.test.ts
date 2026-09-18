import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { mutationHeaders } from "../local-api.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import { handleReadingApi } from "./server.ts";
import { openReadingStore } from "./store.ts";
import { taleById, taleWords } from "./tales.ts";

const known = (
  lemma: string,
  reading: string,
  partOfSpeech: string,
): KnowledgeSnapshot["vocabulary"][number] => ({
  key: `baseline:${lemma}`,
  baselineKey: lemma,
  lemma,
  reading,
  partOfSpeech,
  meaning: lemma,
  source: "baseline",
  senseIds: [],
});

const knowledge: KnowledgeSnapshot = {
  vocabulary: [
    known("女", "おんな", "noun"),
    known("川", "かわ", "noun"),
    known("行く", "いく", "verb"),
    known("見る", "みる", "verb"),
    known("大きい", "おおきい", "adjective"),
  ],
  grammar: [],
  baseline: {
    id: "test",
    version: null,
    availability: "unavailable",
    enabledCount: 0,
    entries: [],
  },
};

/**
 * A tale may be written by hand, and hand-written prose is held to the rule
 * generated prose is held to: the import goes through the same check, and
 * one refusal rejects the whole tale rather than leaving half of one.
 */
test("an imported tale is checked sentence by sentence, all or nothing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-v2-reading-import-"));
  try {
    const opened = openReadingStore({
      databasePath: join(directory, "reading.sqlite"),
      now: () => new Date("2026-09-18T00:00:00.000Z"),
    });
    if (!opened.ok) throw new Error(JSON.stringify(opened.error));
    const store = opened.value;
    const api = {
      store,
      analyzer: createKuromojiAnalyzer(() =>
        loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
      ),
      provider: {
        write: async () => ({
          ok: false as const,
          error: { kind: "unused", detail: "" },
        }),
      },
      transparentPartOfSpeech: new Set<BroadPartOfSpeech>([
        "particle",
        "auxiliary",
        "copula",
        "symbol",
      ]),
      knowledge: () => knowledge,
      now: () => new Date("2026-09-18T00:00:00.000Z"),
    };
    const tale = taleById("momotaro");
    if (tale === null) throw new Error("no tale");

    const put = (sentences: unknown) =>
      handleReadingApi(
        new Request("http://localhost/api/reading/momotaro", {
          method: "PUT",
          headers: mutationHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ sentences }),
        }),
        api,
      );

    // A tale sent short is refused before anything is stored: a reading of
    // half a tale would read as a tale that stops.
    const short = await put([{ index: 0, japanese: "女は川に行く。", english: "x" }]);
    expect(short?.status).toBe(422);
    expect(store.progress("momotaro")).toMatchObject({
      ok: true,
      value: { total: 0 },
    });

    // The right number of sentences, but one of them uses a word the reader
    // does not have and no beat introduced.
    const wrong = tale.beats.map((_, index) => ({
      index,
      japanese: index === 3 ? "女は空を見る。" : "女は川に行く。",
      english: "The woman goes to the river.",
    }));
    const refused = await put(wrong);
    expect(refused?.status).toBe(422);
    const reason = (await refused?.json()) as { error: { index: number } };
    expect(reason.error.index).toBe(3);
    expect(store.progress("momotaro")).toMatchObject({
      ok: true,
      value: { total: 0 },
    });

    // A reader who already has every word the tale declares needs no new
    // word in any beat, so an ordinary sentence satisfies all of them.
    const fluent = {
      ...api,
      knowledge: () => ({
        ...knowledge,
        vocabulary: [
          ...knowledge.vocabulary,
          ...taleWords(tale).map((word) =>
            known(word.lemma, word.reading, word.partOfSpeech),
          ),
        ],
      }),
    };
    const accepted = await handleReadingApi(
      new Request("http://localhost/api/reading/momotaro", {
        method: "PUT",
        headers: mutationHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          sentences: tale.beats.map((_, index) => ({
            index,
            japanese: "女は川に行く。",
            english: "The woman goes to the river.",
          })),
        }),
      }),
      fluent,
    );
    expect(accepted?.status).toBe(200);
    expect(store.progress("momotaro")).toMatchObject({
      ok: true,
      value: { total: tale.beats.length, written: tale.beats.length, done: true },
    });
    const stored = store.load("momotaro");
    expect(stored).toMatchObject({ ok: true });
    if (!stored.ok || stored.value === null) throw new Error("nothing stored");
    expect(stored.value.sentences).toHaveLength(tale.beats.length);
    // Furigana is derived from the analyzer, not sent, so it rejoins.
    for (const sentence of stored.value.sentences) {
      expect(sentence.segments.map((s) => s.written).join("")).toBe(sentence.japanese);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an import without the mutation header never reaches the store", async () => {
  // The route is mutating, so it sits behind the same header every other
  // mutating route sits behind.
  const request = new Request("http://localhost/api/reading/momotaro", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentences: [] }),
  });
  const { authorizeLocalMutation } = await import("../local-api.ts");
  expect(authorizeLocalMutation(request)).toMatchObject({ ok: false });
});
