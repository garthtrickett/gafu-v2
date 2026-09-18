import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../analysis/contracts.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import type { ReadingFailure } from "./contracts.ts";
import {
  alreadyHas,
  draftBeat,
  introducedBefore,
  type ReadingProvider,
} from "./reading.ts";
import type { ReadingStore } from "./store.ts";
import { taleById, tales, taleWords } from "./tales.ts";

const status = (failure: ReadingFailure): number => {
  switch (failure.kind) {
    case "taleNotFound":
    case "readingNotFound":
      return 404;
    case "providerCannotRead":
      return 503;
    case "beatRefused":
      return 422;
    default:
      return 500;
  }
};

export type ReadingApi = Readonly<{
  store: ReadingStore;
  analyzer: JapaneseAnalyzer;
  provider: ReadingProvider;
  transparentPartOfSpeech: ReadonlySet<BroadPartOfSpeech>;
  knowledge: () => KnowledgeSnapshot | null;
  now: () => Date;
}>;

/**
 * The reading routes.
 *
 * Writing a tale is a dozen generations, so it is a POST that takes its
 * time, and what it produces is stored. Reading one back is a GET of what
 * was stored. The tale list says which have been written, so a reader can
 * tell the difference between "start this" and "carry on".
 */
export const handleReadingApi = async (
  request: Request,
  api: ReadingApi,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/reading")) return null;

  if (request.method === "GET" && url.pathname === "/api/reading/tales") {
    const written = api.store.generated();
    if (!written.ok) {
      return Response.json({ error: written.error }, { status: status(written.error) });
    }
    const knowledge = api.knowledge();
    return Response.json({
      tales: tales.map((tale) => {
        const words = taleWords(tale);
        // The same rule the beat itself uses, so the list cannot promise a
        // tale is cheaper than it turns out to be.
        const unknown =
          knowledge === null
            ? words
            : words.filter((word) => !alreadyHas(word, knowledge));
        return {
          id: tale.id,
          title: tale.title,
          titleReading: tale.titleReading,
          titleEnglish: tale.titleEnglish,
          provenance: tale.provenance,
          sentenceCount: tale.beats.length,
          words: unknown,
          generatedAt: written.value.get(tale.id) ?? null,
        };
      }),
    });
  }

  const match = url.pathname.match(/^\/api\/reading\/([A-Za-z0-9-]+)(\/progress)?$/u);
  if (match === null) return null;
  const taleId = match[1] ?? "";
  const isProgress = match[2] !== undefined;
  const tale = taleById(taleId);
  if (tale === null) {
    return Response.json({ error: { kind: "taleNotFound", taleId } }, { status: 404 });
  }

  // Each poll writes one sentence, so polling is the pump: no daemon, and a
  // tale of a hundred sentences never holds a request open for minutes. What
  // is written is kept, so a poll that fails costs one sentence.
  if (request.method === "GET" && isProgress) {
    const before = api.store.progress(taleId);
    if (!before.ok) {
      return Response.json({ error: before.error }, { status: status(before.error) });
    }
    if (before.value.total === 0) {
      return Response.json(
        { error: { kind: "readingNotFound", taleId } },
        { status: 404 },
      );
    }
    const seq = before.value.next;
    if (seq !== null) {
      const knowledge = api.knowledge();
      if (knowledge === null) {
        return Response.json(
          { error: { kind: "readFailed", detail: "knowledge unavailable" } },
          { status: 500 },
        );
      }
      const beat = tale.beats[seq];
      const written = api.store.written(taleId);
      if (!written.ok) {
        return Response.json(
          { error: written.error },
          { status: status(written.error) },
        );
      }
      if (beat !== undefined) {
        const drafted = await draftBeat(
          {
            analyzer: api.analyzer,
            provider: api.provider,
            transparentPartOfSpeech: api.transparentPartOfSpeech,
          },
          tale,
          beat,
          written.value.map((sentence) => sentence.japanese),
          knowledge,
          introducedBefore(tale, seq, knowledge),
        );
        const recorded = api.store.record(
          taleId,
          seq,
          drafted.ok
            ? { sentence: { ...drafted.value, index: seq } }
            : { reasons: drafted.error },
        );
        if (!recorded.ok) {
          return Response.json(
            { error: recorded.error },
            { status: status(recorded.error) },
          );
        }
      }
    }
    const after = api.store.progress(taleId);
    if (!after.ok) {
      return Response.json({ error: after.error }, { status: status(after.error) });
    }
    // Finished: the sentences become the reading the page reads back.
    if (after.value.done) {
      const sentences = api.store.written(taleId);
      if (!sentences.ok) {
        return Response.json(
          { error: sentences.error },
          { status: status(sentences.error) },
        );
      }
      const saved = api.store.save({
        taleId,
        title: tale.title,
        titleReading: tale.titleReading,
        titleEnglish: tale.titleEnglish,
        provenance: tale.provenance,
        generatedAt: api.now().toISOString(),
        sentences: sentences.value,
      });
      if (!saved.ok) {
        return Response.json({ error: saved.error }, { status: status(saved.error) });
      }
    }
    return Response.json({ taleId, ...after.value });
  }

  if (request.method === "GET") {
    const stored = api.store.load(taleId);
    if (!stored.ok) {
      return Response.json({ error: stored.error }, { status: status(stored.error) });
    }
    if (stored.value === null) {
      return Response.json(
        { error: { kind: "readingNotFound", taleId } },
        { status: 404 },
      );
    }
    return Response.json({
      taleId,
      title: tale.title,
      titleReading: tale.titleReading,
      titleEnglish: tale.titleEnglish,
      provenance: tale.provenance,
      generatedAt: stored.value.generatedAt,
      sentences: stored.value.sentences,
    });
  }

  // Starting a reading lays out the beats and returns. Nothing is generated
  // here: a hundred sentences is minutes, and no request should wait on it.
  if (request.method === "POST") {
    const begun = api.store.begin(taleId, tale.beats.length);
    if (!begun.ok) {
      return Response.json({ error: begun.error }, { status: status(begun.error) });
    }
    return Response.json(
      { taleId, total: tale.beats.length, written: 0, failed: 0, done: false },
      { status: 202 },
    );
  }

  return new Response(null, { status: 405 });
};
