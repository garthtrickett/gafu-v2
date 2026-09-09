import { readBoundedBody } from "../local-api.ts";
import { err, ok } from "../result.ts";
import type {
  MaterialProvider,
  MaterialProviderFailure,
  MaterialProviderRequest,
  RedactedProviderRequest,
} from "./generated-contracts.ts";

export type OpenAiMaterialFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Options = Readonly<{
  apiKey: () => string | null;
  model: string;
  promptVersion: string;
  timeoutMs: number;
  fetch?: OpenAiMaterialFetch;
}>;

const maximumProviderResponseBytes = 2 * 1024 * 1024;

const textSpanSchema = {
  type: "object",
  additionalProperties: false,
  required: ["start", "end", "unit", "normalization"],
  properties: {
    start: { type: "integer", minimum: 0 },
    end: { type: "integer", minimum: 1 },
    unit: { type: "string", enum: ["utf16-code-unit"] },
    normalization: { type: "string", enum: ["nfkc-v1"] },
  },
} as const;

const readingSegmentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["written", "reading"],
  properties: {
    written: { type: "string" },
    reading: { type: "string" },
  },
} as const;

const sharedProperties = {
  mode: { type: "string", enum: ["teach", "review"] },
  context: { type: "string" },
  prompt: { type: "string" },
  japanese: { type: "string" },
  targetSurface: { type: "string" },
  targetSpan: textSpanSchema,
  readingSegments: { type: "array", minItems: 1, items: readingSegmentSchema },
  answer: { type: "string" },
  explanation: { type: "string" },
  usageNote: { type: "string" },
} as const;

const sharedRequired = [
  "mode",
  "context",
  "prompt",
  "japanese",
  "targetSurface",
  "targetSpan",
  "readingSegments",
  "answer",
  "explanation",
  "usageNote",
] as const;

const materialSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [...sharedRequired, "targetKind", "target"],
      properties: {
        ...sharedProperties,
        targetKind: { type: "string", enum: ["vocabulary"] },
        target: {
          type: "object",
          additionalProperties: false,
          required: ["lemma", "reading", "partOfSpeech", "meaning"],
          properties: {
            lemma: { type: "string" },
            reading: { type: "string" },
            partOfSpeech: {
              type: "string",
              enum: [
                "noun",
                "verb",
                "adjective",
                "adverb",
                "particle",
                "auxiliary",
                "copula",
                "interjection",
                "symbol",
              ],
            },
            meaning: { type: "string" },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [...sharedRequired, "targetKind", "target"],
      properties: {
        ...sharedProperties,
        targetKind: { type: "string", enum: ["grammar"] },
        target: {
          type: "object",
          additionalProperties: false,
          required: ["canonicalForm", "meaning", "formationHint"],
          properties: {
            canonicalForm: { type: "string" },
            meaning: { type: "string" },
            formationHint: { type: "string" },
          },
        },
      },
    },
  ],
} as const;

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

const hasRefusal = (response: Record<string, unknown>): boolean =>
  Array.isArray(response["output"]) &&
  response["output"].some(
    (output) =>
      isRecord(output) &&
      Array.isArray(output["content"]) &&
      output["content"].some(
        (content) => isRecord(content) && content["type"] === "refusal",
      ),
  );

const httpFailure = (status: number): MaterialProviderFailure => {
  const detail = `OpenAI returned HTTP ${status}; response body omitted`;
  if (status === 401) return { kind: "authentication", detail };
  if (status === 403) return { kind: "permission", detail };
  if (status === 429) return { kind: "rateLimit", detail };
  return { kind: "offline", detail };
};

const promptInput = (request: MaterialProviderRequest): unknown => ({
  mode: request.mode,
  target: request.card,
  allowedSupportingVocabulary: request.knowledge.vocabulary.map((word) => ({
    lemma: word.lemma,
    reading: word.reading,
    meaning: word.meaning,
  })),
  allowedSupportingGrammar: request.knowledge.grammar.map(
    (grammar) => grammar.canonicalForm,
  ),
  recentJapaneseToAvoid: request.recentJapanese,
  candidateCount: request.candidateCount,
});

const requestBody = (options: Options, request: MaterialProviderRequest): unknown => ({
  model: options.model,
  store: false,
  reasoning: { effort: "low" },
  instructions:
    "Create exactly three materially different Japanese learning presentations for the one target Card. Use only the supplied supporting vocabulary and grammar. The English context describes the situation and must not translate the Japanese answer. Copy target identity fields exactly. targetSpan is a zero-based UTF-16 code-unit span in NFKC Japanese. Reading segments must reconstruct Japanese exactly. Do not include another learning target.",
  input: JSON.stringify(promptInput(request)),
  text: {
    format: {
      type: "json_schema",
      name: "gafu_learning_material",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["materials"],
        properties: {
          materials: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: materialSchema,
          },
        },
      },
    },
  },
});

export const createOpenAiMaterialProvider = (options: Options): MaterialProvider => {
  const send = options.fetch ?? fetch;
  let lastRequest: RedactedProviderRequest | null = null;
  return {
    identity: {
      provider: "openai-responses",
      model: options.model,
      promptVersion: options.promptVersion,
    },
    inspectLastRequest: () => lastRequest,
    generate: async (input, outerSignal) => {
      const apiKey = options.apiKey();
      if (apiKey === null || apiKey.trim() === "") {
        return err({ kind: "providerNotConfigured" });
      }
      const body = requestBody(options, input);
      lastRequest = { endpoint: "https://api.openai.com/v1/responses", body };
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
      const cancel = () => controller.abort();
      if (outerSignal?.aborted === true) cancel();
      else outerSignal?.addEventListener("abort", cancel, { once: true });
      try {
        const response = await send("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) return err(httpFailure(response.status));
        const responseBody = await readBoundedBody(
          response,
          maximumProviderResponseBytes,
        );
        if (!responseBody.ok) {
          return err({
            kind: "malformedResponse",
            detail:
              responseBody.error.kind === "bodyTooLarge"
                ? "OpenAI response body was too large"
                : "OpenAI response body could not be read",
          });
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(new TextDecoder().decode(responseBody.value));
        } catch {
          return err({
            kind: "malformedResponse",
            detail: "OpenAI response body was not JSON",
          });
        }
        if (!isRecord(decoded) || typeof decoded["id"] !== "string") {
          return err({
            kind: "malformedResponse",
            detail: "OpenAI response had no ID",
          });
        }
        if (decoded["status"] === "incomplete") {
          return err({
            kind: "incompleteResponse",
            detail: "OpenAI response was incomplete",
          });
        }
        if (decoded["status"] === "failed" || decoded["error"] != null) {
          return err({ kind: "refusal", detail: "OpenAI response failed" });
        }
        if (hasRefusal(decoded)) {
          return err({ kind: "refusal", detail: "OpenAI refused the request" });
        }
        const text = outputText(decoded);
        if (text === null) {
          return err({
            kind: "malformedResponse",
            detail: "OpenAI response had no output text",
          });
        }
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          return err({
            kind: "malformedResponse",
            detail: "OpenAI output text was not JSON",
          });
        }
        if (
          !isRecord(value) ||
          !Array.isArray(value["materials"]) ||
          value["materials"].length !== 3
        ) {
          return err({
            kind: "malformedResponse",
            detail: "OpenAI output did not contain materials",
          });
        }
        return ok({
          requestId: decoded["id"],
          candidates: value["materials"],
          provider: "openai-responses",
          model: options.model,
          promptVersion: options.promptVersion,
        });
      } catch {
        if (outerSignal?.aborted === true) {
          return err({ kind: "cancelled", detail: "OpenAI request was cancelled" });
        }
        if (timedOut) {
          return err({ kind: "timeout", detail: "OpenAI request timed out" });
        }
        return err({ kind: "offline", detail: "OpenAI network request failed" });
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", cancel);
      }
    },
  };
};
