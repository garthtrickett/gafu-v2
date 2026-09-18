import { readBoundedBody } from "../local-api.ts";
import { err, ok, type Result } from "../result.ts";
import type { KnowledgeSnapshot } from "../study/contracts.ts";
import type {
  ReadingBeatDraft,
  ReadingBeatRequest,
  ReadingProvider,
} from "./reading.ts";

const MAXIMUM_RESPONSE_BYTES = 512 * 1024;

type Options = Readonly<{
  apiKey: () => string | null;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const outputText = (response: Record<string, unknown>): string | null => {
  if (!Array.isArray(response["output"])) return null;
  for (const output of response["output"]) {
    if (!isRecord(output) || !Array.isArray(output["content"])) continue;
    for (const content of output["content"]) {
      if (
        isRecord(content) &&
        content["type"] === "output_text" &&
        typeof content["text"] === "string"
      ) {
        return content["text"];
      }
    }
  }
  return null;
};

/** The learner's vocabulary, compactly, because all of it goes in the prompt. */
const supporting = (knowledge: KnowledgeSnapshot) => ({
  vocabulary: knowledge.vocabulary.map((word) => ({
    w: word.lemma,
    r: word.reading,
    m: word.meaning,
  })),
  grammar: knowledge.grammar.map((item) => item.canonicalForm),
});

/**
 * Writes one sentence of a tale.
 *
 * The instruction is narrow on purpose. The model is given what happens, the
 * sentences already written, the learner's whole vocabulary, and at most one
 * word it may use that is not in that vocabulary. Everything else is
 * refused downstream, so there is no value in it being inventive about
 * wording — only about telling the beat inside the words available.
 *
 * It is also told to write its own prose. These are traditional tales with
 * no owner, but published retellings and translations of them have authors,
 * and a reader here should be getting Japanese written for their vocabulary
 * rather than someone else's text.
 */
const instructions = [
  "Write exactly one Japanese sentence telling the beat you are given, as the next sentence of a tale being retold for a learner.",
  "Use only words from supporting.vocabulary and grammar from supporting.grammar. If a target word is supplied you may also use that one word, and you must use it. Use no other word the learner does not have.",
  "The tales are traditional and have no author, but retellings of them do: write your own plain sentences and do not reproduce any published translation or retelling.",
  "Keep it short and plain. A reader should meet at most one unfamiliar word in the sentence, and that is the target.",
  "Continue from preceding without repeating it. Do not summarise, do not add events the beat does not contain.",
  "english is what your Japanese sentence says, in English.",
  "readingSegments must rejoin into japanese exactly, in order. Give the reading of each run in hiragana; a run already in kana takes its own text as its reading.",
].join(" ");

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["japanese", "english", "readingSegments"],
  properties: {
    japanese: { type: "string" },
    english: { type: "string" },
    readingSegments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["written", "reading"],
        properties: { written: { type: "string" }, reading: { type: "string" } },
      },
    },
  },
} as const;

export const createOpenAiReadingProvider = (options: Options): ReadingProvider => {
  const send = options.fetch ?? fetch;
  return {
    write: async (
      request: ReadingBeatRequest,
      signal?: AbortSignal,
    ): Promise<Result<ReadingBeatDraft, { kind: string; detail: string }>> => {
      const apiKey = options.apiKey();
      if (apiKey === null || apiKey.trim() === "") {
        return err({ kind: "providerNotConfigured", detail: "no API key" });
      }
      const body = {
        model: options.model,
        store: false,
        reasoning: { effort: "low" },
        instructions,
        input: JSON.stringify({
          tale: request.titleEnglish,
          beat: request.beat,
          preceding: request.preceding,
          target: request.target,
          supporting: supporting(request.knowledge),
          previousRejections: request.rejections,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "gafu_reading_beat",
            strict: true,
            schema,
          },
        },
      };
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      const cancel = () => controller.abort();
      if (signal?.aborted === true) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
      try {
        const response = await send("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          return err({
            kind: "httpError",
            detail: `OpenAI returned ${response.status}`,
          });
        }
        const read = await readBoundedBody(response, MAXIMUM_RESPONSE_BYTES);
        if (!read.ok)
          return err({ kind: "malformedResponse", detail: "body unreadable" });
        const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
        if (!isRecord(parsed)) {
          return err({ kind: "malformedResponse", detail: "body was not an object" });
        }
        const text = outputText(parsed);
        if (text === null) {
          return err({ kind: "malformedResponse", detail: "no output text" });
        }
        const draft: unknown = JSON.parse(text);
        if (
          !isRecord(draft) ||
          typeof draft["japanese"] !== "string" ||
          typeof draft["english"] !== "string" ||
          !Array.isArray(draft["readingSegments"])
        ) {
          return err({
            kind: "malformedResponse",
            detail: "draft was not the shape asked for",
          });
        }
        const segments = draft["readingSegments"].filter(
          (segment): segment is { written: string; reading: string } =>
            isRecord(segment) &&
            typeof segment["written"] === "string" &&
            typeof segment["reading"] === "string",
        );
        return ok({
          japanese: draft["japanese"],
          english: draft["english"],
          segments,
        });
      } catch (cause) {
        return err(
          timedOut
            ? { kind: "timeout", detail: "OpenAI did not answer in time" }
            : {
                kind: "offline",
                detail: cause instanceof Error ? cause.message : String(cause),
              },
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
};
