import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { mutationHeaders } from "../local-api.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import { decodePassage } from "./passage-import.ts";
import { handleReadingApi } from "./server.ts";
import { openReadingStore } from "./store.ts";

const vocabulary = (
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

test("existing tale readings survive the passage schema migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-passage-upgrade-"));
  const databasePath = join(directory, "reading.sqlite");
  try {
    const legacy = new Database(databasePath, { create: true });
    legacy.exec(`
      CREATE TABLE reading_migration (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO reading_migration VALUES (1, '2026-09-01'), (2, '2026-09-01');
      CREATE TABLE reading (
        tale_id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, sentences_json TEXT NOT NULL
      );
      INSERT INTO reading VALUES ('momotaro', '2026-09-01', '[]');
      CREATE TABLE reading_beat (
        tale_id TEXT NOT NULL, seq INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'written', 'failed')),
        sentence_json TEXT, reasons_json TEXT,
        PRIMARY KEY (tale_id, seq)
      );
      CREATE INDEX reading_beat_pending ON reading_beat(tale_id, status, seq);
    `);
    legacy.close();
    const opened = openReadingStore({
      databasePath,
      now: () => new Date("2026-10-13"),
    });
    if (!opened.ok) throw new Error(JSON.stringify(opened.error));
    expect(opened.value.load("momotaro")).toEqual({
      ok: true,
      value: { generatedAt: "2026-09-01", sentences: [] },
    });
    expect(opened.value.passages()).toEqual({ ok: true, value: [] });
    opened.value.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const knowledge: KnowledgeSnapshot = {
  vocabulary: [
    vocabulary("女", "おんな", "noun"),
    vocabulary("川", "かわ", "noun"),
    vocabulary("行く", "いく", "verb"),
    vocabulary("見る", "みる", "verb"),
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

const passage = {
  format: "gafu-passage",
  version: 1,
  title: "川の話",
  titleReading: "かわのはなし",
  titleEnglish: "A river story",
  paragraphs: [
    [
      {
        speaker: "Narrator",
        japanese: "女は川に行く。",
        english: "The woman goes to the river.",
        segments: [
          { written: "女", reading: "おんな" },
          { written: "は", reading: "は" },
          { written: "川", reading: "かわ" },
          { written: "に行く。", reading: "にいく。" },
        ],
      },
      { japanese: "女は川を見る。", english: "She sees the river." },
    ],
    [{ japanese: "女は川に行く。", english: "She goes there again." }],
  ],
};

test("an authored passage is checked whole, saved with furigana and reopened", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gafu-passage-"));
  const databasePath = join(directory, "reading.sqlite");
  const now = () => new Date("2026-10-13T00:00:00.000Z");
  try {
    const opened = openReadingStore({ databasePath, now });
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
      now,
    };
    const importFile = (file: unknown) =>
      handleReadingApi(
        new Request("http://localhost/api/reading/import", {
          method: "POST",
          headers: mutationHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(file),
        }),
        api,
      );

    const unknown = structuredClone(passage);
    unknown.paragraphs[1] = [
      { japanese: "女は空を見る。", english: "She looks at the sky." },
    ];
    const refused = await importFile(unknown);
    expect(refused?.status).toBe(422);
    expect((await refused?.json())?.error.index).toBe(2);
    expect(store.passages()).toMatchObject({ ok: true, value: [] });

    const badReading = structuredClone(passage);
    const first = badReading.paragraphs[0]?.[0];
    if (
      first !== undefined &&
      "segments" in first &&
      first.segments?.[3] !== undefined
    ) {
      first.segments[3].reading = "でいく。";
    }
    const refusedReading = await importFile(badReading);
    expect(refusedReading?.status).toBe(422);
    expect(store.passages()).toMatchObject({ ok: true, value: [] });

    const accepted = await importFile(passage);
    expect(accepted?.status).toBe(201);
    const receipt = (await accepted?.json()) as { id: string };
    expect(receipt.id).toStartWith("passage-");
    expect((await importFile(passage))?.status).toBe(201);
    const listed = store.passages();
    expect(listed).toMatchObject({ ok: true, value: [{ id: receipt.id }] });
    if (!listed.ok) throw new Error("listing failed");
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.paragraphStarts).toEqual([0, 2]);
    expect(listed.value[0]?.sentences[0]?.speaker).toBe("Narrator");
    expect(listed.value[0]?.sentences[0]?.segments[0]).toEqual({
      written: "女",
      reading: "おんな",
    });
    store.close();

    const reopened = openReadingStore({ databasePath, now });
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));
    const loaded = await handleReadingApi(
      new Request(`http://localhost/api/reading/${receipt.id}`),
      { ...api, store: reopened.value },
    );
    expect(loaded?.status).toBe(200);
    const reopenedReading = (await loaded?.json()) as {
      title: string;
      paragraphStarts: number[];
      sentences: { japanese: string; speaker?: string }[];
    };
    expect(reopenedReading.title).toBe(passage.title);
    expect(reopenedReading.paragraphStarts).toEqual([0, 2]);
    expect(reopenedReading.sentences[0]?.speaker).toBe("Narrator");
    expect(reopenedReading.sentences.map((sentence) => sentence.japanese)).toEqual([
      "女は川に行く。",
      "女は川を見る。",
      "女は川に行く。",
    ]);
    reopened.value.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

test("speaker labels are optional, bounded and part of a passage's identity", () => {
  const original = decodePassage(passage);
  const unlabeled = structuredClone(passage);
  const first = unlabeled.paragraphs[0]?.[0];
  if (first === undefined) throw new Error("missing fixture sentence");
  delete first.speaker;
  const without = decodePassage(unlabeled);
  expect(original.ok).toBe(true);
  expect(without.ok).toBe(true);
  if (!original.ok || !without.ok) throw new Error("fixture refused");
  expect(original.value.id).not.toBe(without.value.id);
  expect(without.value.paragraphs[0]?.[0]?.speaker).toBeUndefined();
  for (const speaker of [null, 7, "", " ", "A\nB", "x".repeat(61)]) {
    expect(
      decodePassage({
        ...passage,
        paragraphs: [[{ japanese: "川。", english: "A river.", speaker }]],
      }).ok,
    ).toBe(false);
  }
});
