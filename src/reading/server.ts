import type { BroadPartOfSpeech, JapaneseAnalyzer } from "../analysis/contracts.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import type { ReadingFailure } from "./contracts.ts";
import { type ReadingProvider, writeReading } from "./reading.ts";
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
        const unknown =
          knowledge === null
            ? words
            : words.filter(
                (word) =>
                  !knowledge.vocabulary.some(
                    (entry) =>
                      entry.lemma === word.lemma || entry.reading === word.reading,
                  ),
              );
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

  const match = url.pathname.match(/^\/api\/reading\/([A-Za-z0-9-]+)$/u);
  if (match === null) return null;
  const taleId = match[1] ?? "";
  const tale = taleById(taleId);
  if (tale === null) {
    return Response.json({ error: { kind: "taleNotFound", taleId } }, { status: 404 });
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

  if (request.method === "POST") {
    const knowledge = api.knowledge();
    if (knowledge === null) {
      return Response.json(
        { error: { kind: "readFailed", detail: "knowledge unavailable" } },
        { status: 500 },
      );
    }
    const written = await writeReading(
      {
        analyzer: api.analyzer,
        provider: api.provider,
        transparentPartOfSpeech: api.transparentPartOfSpeech,
      },
      tale,
      knowledge,
      api.now(),
    );
    if (!written.ok) {
      // A refusal names the sentence and the reason. "beatRefused" alone
      // leaves a reader — and whoever is debugging — with nothing to act on.
      return Response.json(
        {
          error: written.error,
          detail:
            written.error.kind === "beatRefused"
              ? `sentence ${written.error.index + 1}: ${written.error.reasons.join("; ")}`
              : undefined,
        },
        { status: status(written.error) },
      );
    }
    const saved = api.store.save(written.value);
    if (!saved.ok) {
      return Response.json({ error: saved.error }, { status: status(saved.error) });
    }
    return Response.json(written.value, { status: 201 });
  }

  return new Response(null, { status: 405 });
};
