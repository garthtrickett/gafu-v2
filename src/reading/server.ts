import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../analysis/contracts.ts";
import { readBoundedJson } from "../local-api.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import type { ReadingFailure, ReadingSentence } from "./contracts.ts";
import {
  alreadyHas,
  checkBeat,
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

  // A tale may also be written by hand. The provider is the usual author,
  // but it is not the only one a tale can have, and prose written by a
  // person is held to exactly the rule generated prose is held to: every
  // sentence goes through the same check, and one refusal rejects the lot
  // rather than leaving half a tale standing.
  if (request.method === "PUT") {
    const knowledge = api.knowledge();
    if (knowledge === null) {
      return Response.json(
        { error: { kind: "readFailed", detail: "knowledge unavailable" } },
        { status: 500 },
      );
    }
    const body = await readBoundedJson(request);
    if (!body.ok) {
      return Response.json(
        { error: { kind: "beatRefused", index: 0, reasons: [body.error.kind] } },
        { status: 400 },
      );
    }
    const authored =
      (
        body.value as {
          sentences?: { index?: number; japanese?: string; english?: string }[];
        }
      ).sentences ?? [];
    if (authored.length !== tale.beats.length) {
      return Response.json(
        {
          error: {
            kind: "beatRefused",
            index: 0,
            reasons: [
              `the tale has ${tale.beats.length} beats and ${authored.length} were sent`,
            ],
          },
        },
        { status: 422 },
      );
    }
    const checked: { index: number; sentence: ReadingSentence }[] = [];
    for (const [index, beat] of tale.beats.entries()) {
      const written = authored.find((item) => item.index === index);
      if (written?.japanese === undefined || written.english === undefined) {
        return Response.json(
          {
            error: { kind: "beatRefused", index, reasons: ["no sentence was sent"] },
          },
          { status: 422 },
        );
      }
      // Furigana is derived, not sent: the analyzer's own tokens rejoin into
      // the sentence by construction, so an author cannot mis-split a word.
      const analyzed = await api.analyzer.analyze("reading", written.japanese);
      if (!analyzed.ok) {
        return Response.json(
          {
            error: {
              kind: "beatRefused",
              index,
              reasons: [`the sentence could not be analyzed`],
            },
          },
          { status: 422 },
        );
      }
      const segments = analyzed.value.tokens.map((token) => ({
        written: token.surface,
        reading: token.reading ?? token.surface,
      }));
      const target =
        beat.word !== null && !alreadyHas(beat.word, knowledge) ? beat.word : null;
      const result = await checkBeat(
        {
          analyzer: api.analyzer,
          provider: api.provider,
          transparentPartOfSpeech: api.transparentPartOfSpeech,
        },
        { japanese: written.japanese, english: written.english, segments },
        target,
        knowledge,
        introducedBefore(tale, index, knowledge),
      );
      if (!result.ok) {
        return Response.json(
          { error: { kind: "beatRefused", index, reasons: result.error } },
          { status: 422 },
        );
      }
      checked.push({ index, sentence: { ...result.value, index } });
    }
    const begun = api.store.begin(taleId, tale.beats.length);
    if (!begun.ok) {
      return Response.json({ error: begun.error }, { status: status(begun.error) });
    }
    for (const { index, sentence } of checked) {
      const recorded = api.store.record(taleId, index, { sentence });
      if (!recorded.ok) {
        return Response.json(
          { error: recorded.error },
          { status: status(recorded.error) },
        );
      }
    }
    const saved = api.store.save({
      taleId,
      title: tale.title,
      titleReading: tale.titleReading,
      titleEnglish: tale.titleEnglish,
      provenance: tale.provenance,
      generatedAt: api.now().toISOString(),
      sentences: checked.map(({ sentence }) => sentence),
    });
    if (!saved.ok) {
      return Response.json({ error: saved.error }, { status: status(saved.error) });
    }
    return Response.json({ taleId, total: checked.length, written: checked.length });
  }

  return new Response(null, { status: 405 });
};
