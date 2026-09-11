import { readBoundedBody } from "../local-api.ts";
import { err, ok, type Result } from "../result.ts";
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
  /**
   * Bound on a single HTTP call, not on generation. Background mode makes the
   * dispatch and each poll short regardless of how long the model thinks, so
   * this no longer has to be sized against the slowest generation.
   */
  timeoutMs: number;
  /** Bound on the whole generation: dispatch plus polling to a terminal status. */
  completionTimeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
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

const terminalStatuses = new Set(["completed", "incomplete", "failed", "cancelled"]);

type MaterialDispatch = Readonly<{
  requestId: string;
  candidates: readonly unknown[];
  provider: string;
  model: string;
  promptVersion: string;
}>;

type DecodedMaterial =
  | { readonly pending: true; readonly responseId: string }
  | { readonly result: MaterialDispatch }
  | { readonly failure: MaterialProviderFailure };

const decodeTerminal = (body: unknown, options: Options): DecodedMaterial => {
  if (!isRecord(body) || typeof body["id"] !== "string") {
    return {
      failure: {
        kind: "malformedResponse",
        detail: "OpenAI response had no ID",
      },
    };
  }
  const status = body["status"];
  // Background responses report progress before they report output. Only a
  // terminal status is evidence about the material; anything else is "not yet".
  if (typeof status === "string" && !terminalStatuses.has(status)) {
    return { pending: true, responseId: body["id"] };
  }
  if (status === "cancelled") {
    return {
      failure: { kind: "cancelled", detail: "OpenAI cancelled the response" },
    };
  }
  if (status === "incomplete") {
    return {
      failure: {
        kind: "incompleteResponse",
        detail: "OpenAI response was incomplete",
      },
    };
  }
  if (status === "failed" || body["error"] != null) {
    return { failure: { kind: "refusal", detail: "OpenAI response failed" } };
  }
  if (hasRefusal(body)) {
    return { failure: { kind: "refusal", detail: "OpenAI refused the request" } };
  }
  const text = outputText(body);
  if (text === null) {
    return {
      failure: {
        kind: "malformedResponse",
        detail: "OpenAI response had no output text",
      },
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      failure: {
        kind: "malformedResponse",
        detail: "OpenAI output text was not JSON",
      },
    };
  }
  if (
    !isRecord(value) ||
    !Array.isArray(value["materials"]) ||
    value["materials"].length !== 3
  ) {
    return {
      failure: {
        kind: "malformedResponse",
        detail: "OpenAI output did not contain materials",
      },
    };
  }
  return {
    result: {
      requestId: body["id"],
      candidates: value["materials"],
      provider: "openai-responses",
      model: options.model,
      promptVersion: options.promptVersion,
    },
  };
};

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const httpFailure = (status: number): MaterialProviderFailure => {
  const detail = `OpenAI returned HTTP ${status}; response body omitted`;
  if (status === 401) return { kind: "authentication", detail };
  if (status === 403) return { kind: "permission", detail };
  if (status === 429) return { kind: "rateLimit", detail };
  return { kind: "offline", detail };
};

const promptInput = (request: MaterialProviderRequest): unknown => {
  // usageNotes stay out of the prompt. They quote the media cue the Card
  // came from, and the model copies that cue into its candidates — along
  // with whatever unknown language the cue leans on. Meaning already carries
  // the sense; the cue sentence would only poison the i+1 constraint.
  const { usageNotes: _cue, ...contentWithoutCue } = request.card.content;
  return {
    mode: request.mode,
    target: { ...request.card, content: contentWithoutCue },
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
  };
};

const requestBody = (options: Options, request: MaterialProviderRequest): unknown => ({
  model: options.model,
  background: true,
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
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  let lastRequest: RedactedProviderRequest | null = null;

  /**
   * One bounded HTTP call. `notFound` distinguishes a dispatch that aged out
   * of provider-side retention from a transport failure, because the two need
   * opposite recoveries.
   */
  const call = async (
    url: string,
    init: RequestInit,
    outerSignal: AbortSignal | undefined,
  ): Promise<
    Result<{ value: unknown } | { notFound: true }, MaterialProviderFailure>
  > => {
    const apiKey = options.apiKey();
    if (apiKey === null || apiKey.trim() === "") {
      return err({ kind: "providerNotConfigured" });
    }
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
      const response = await send(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      if (response.status === 404) return ok({ notFound: true });
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
      try {
        return ok({ value: JSON.parse(new TextDecoder().decode(responseBody.value)) });
      } catch {
        return err({
          kind: "malformedResponse",
          detail: "OpenAI response body was not JSON",
        });
      }
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
  };

  /**
   * Polls one dispatched response to a terminal status. A dispatch that is
   * gone from provider-side retention cannot be recovered by waiting longer.
   */
  const poll = async (
    providerResponseId: string,
    deadline: number,
    outerSignal: AbortSignal | undefined,
  ): Promise<Result<MaterialDispatch, MaterialProviderFailure>> => {
    const url = `https://api.openai.com/v1/responses/${encodeURIComponent(providerResponseId)}`;
    for (;;) {
      const polled = await call(url, { method: "GET" }, outerSignal);
      if (!polled.ok) return polled;
      if ("notFound" in polled.value) {
        return err({
          kind: "offline",
          detail: "OpenAI discarded the dispatched response before it was read",
        });
      }
      const decoded = decodeTerminal(polled.value.value, options);
      if ("failure" in decoded) return err(decoded.failure);
      if ("result" in decoded) return ok(decoded.result);
      if (outerSignal?.aborted === true) {
        return err({ kind: "cancelled", detail: "OpenAI request was cancelled" });
      }
      if (Date.now() + pollIntervalMs >= deadline) {
        return err({
          kind: "timeout",
          detail: "OpenAI response did not finish within the material budget",
        });
      }
      await sleep(pollIntervalMs, outerSignal);
    }
  };

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
      const deadline = Date.now() + options.completionTimeoutMs;
      const body = requestBody(options, input);
      lastRequest = { endpoint: "https://api.openai.com/v1/responses", body };
      // background: true returns as soon as the request is queued, so the
      // window in which an interruption loses the response id is one short
      // HTTP call rather than the whole generation. store stays false; the
      // provider retains a background response only long enough to be polled.
      const created = await call(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        outerSignal,
      );
      if (!created.ok) return created;
      if ("notFound" in created.value) {
        return err({
          kind: "offline",
          detail: "OpenAI responses endpoint is unavailable",
        });
      }
      const decoded = decodeTerminal(created.value.value, options);
      if ("failure" in decoded) return err(decoded.failure);
      if ("result" in decoded) return ok(decoded.result);
      return poll(decoded.responseId, deadline, outerSignal);
    },
  };
};
