import { ok } from "../result.ts";
import type { BatchProvider, CandidateEvidence } from "./batching-contracts.ts";

const contentParts = new Set(["noun", "verb", "adjective", "adverb", "interjection"]);
const fixtureMeanings: Readonly<Record<string, string>> = {
  猫: "cat",
  犬: "domestic dog",
};

export const createDeterministicPreparationProvider = (): BatchProvider & {
  readonly submissions: string[];
} => {
  const submissions: string[] = [];
  const responses = new Map<
    string,
    Readonly<{
      providerRequestId: string;
      candidates: readonly CandidateEvidence[];
      usage: { inputTokens: number; outputTokens: number };
    }>
  >();
  return {
    identity: {
      provider: "deterministic-fake",
      model: "fixture-v1",
      promptVersion: "preparation-v2",
    },
    submissions,
    submit: async (batch, key, signal) => {
      if (signal?.aborted === true) {
        return {
          ok: false,
          error: { kind: "cancelled", detail: "request was cancelled" },
        };
      }
      submissions.push(batch.inputDigest);
      const existing = responses.get(key);
      if (existing !== undefined) return ok(existing);
      const candidates: CandidateEvidence[] = batch.cues.flatMap((cue) => [
        ...cue.tokens
          .filter((token) => contentParts.has(token.broadPartOfSpeech))
          .map((token) => ({
            kind: "vocabulary" as const,
            canonicalKey: `${token.lemma}:${token.reading ?? ""}`,
            cueId: cue.cueId,
            surface: token.surface,
            span: token.span,
            meaning:
              fixtureMeanings[token.lemma] ?? `fixture meaning for ${token.lemma}`,
            senseId: `fixture:${token.lemma}:${token.reading ?? ""}:1`,
            impact: "helpful" as const,
            confidence: 0.95,
            ambiguity: [],
          })),
        ...cue.grammarEvidence.flatMap((grammar) =>
          grammar.spans.map((span) => ({
            kind: "grammar" as const,
            canonicalKey: grammar.canonicalForm,
            cueId: cue.cueId,
            surface: cue.normalizedJapanese.slice(span.start, span.end),
            span,
            meaning: `fixture function for ${grammar.canonicalForm}`,
            senseId: null,
            impact: "helpful" as const,
            confidence: 0.95,
            ambiguity: [],
          })),
        ),
      ]);
      const response = {
        providerRequestId: `fixture:${key}`,
        candidates,
        usage: {
          inputTokens: batch.cues.length * 10,
          outputTokens: candidates.length * 10,
        },
      };
      responses.set(key, response);
      return ok(response);
    },
    retrieve: async (key) => ok(responses.get(key) ?? null),
  };
};
