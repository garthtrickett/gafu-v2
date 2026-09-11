import { createHash } from "node:crypto";
import { readBoundedBody } from "../local-api.ts";
import { err, ok, type Result } from "../result.ts";
import type {
  AnalysisBatch,
  BatchProvider,
  CandidateEvidence,
  ProviderBatchResponse,
  ProviderFailure,
} from "./batching-contracts.ts";
import { canonicalVocabulary, earnsCandidate } from "./evidence-expectations.ts";

export type OpenAiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type OpenAiProviderOptions = Readonly<{
  apiKey: () => string | null;
  model: string;
  promptVersion: string;
  /**
   * Bound on a single HTTP call, not on generation. Background mode makes the
   * dispatch and each poll short regardless of how long the model thinks, so
   * this no longer has to be sized against the largest batch.
   */
  timeoutMs: number;
  /** Bound on the whole batch: dispatch plus polling to a terminal status. */
  completionTimeoutMs: number;
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  fetch?: OpenAiFetch;
}>;

const maximumProviderResponseBytes = 4 * 1024 * 1024;

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "canonicalKey",
    "cueId",
    "surface",
    "span",
    "meaning",
    "senseId",
    "impact",
    "confidence",
    "ambiguity",
  ],
  properties: {
    kind: { type: "string", enum: ["vocabulary", "grammar"] },
    canonicalKey: { type: "string" },
    cueId: { type: "string" },
    surface: { type: "string" },
    span: {
      type: "object",
      additionalProperties: false,
      required: ["start", "end", "unit", "normalization"],
      properties: {
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 1 },
        unit: { type: "string", enum: ["utf16-code-unit"] },
        normalization: { type: "string", enum: ["nfkc-v1"] },
      },
    },
    meaning: { type: "string" },
    senseId: { type: ["string", "null"] },
    impact: { type: "string", enum: ["required", "helpful", "incidental"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ambiguity: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * What the model is shown for a batch, and how to read its answer back.
 *
 * Two things the model was previously asked to reproduce that it cannot do
 * reliably, each of which rejects a whole batch of ~120 candidates on a single
 * slip:
 *
 * - A cue id is `cue-v1:sha256:` plus a 64-character digest. Echoing one per
 *   candidate meant thousands of characters of pure entropy, byte-perfect; an
 *   id came back 25 characters short. Cues are labelled `c1`, `c2`, ... here
 *   and translated back on the way in.
 * - Grammar evidence carried only a canonical form, which is a label --
 *   `受身形`, `の ( nominalizer )`, `〜ている` -- and mostly does not occur in
 *   the cue. Each occurrence is flattened to the token shape, which already
 *   carries the `surface` the candidate contract asks it to copy.
 * - `canonicalKey` had to be built from a rule, and the rule as written does
 *   not cover a null reading: the validator wants `グリズリー:` with a
 *   trailing colon. It is precomputed here so the model copies a string.
 *
 * Non-content tokens are dropped, so the answer's size is fixed by the
 * payload rather than by the model agreeing with `contentParts`.
 */
const labelledBatch = (
  cues: AnalysisBatch["cues"],
): {
  readonly payload: readonly unknown[];
  readonly cueIdOf: ReadonlyMap<string, string>;
} => {
  const cueIdOf = new Map<string, string>();
  const payload = cues.map((cue, index) => {
    const label = `c${index + 1}`;
    cueIdOf.set(label, cue.cueId);
    return {
      cueId: label,
      normalizedJapanese: cue.normalizedJapanese,
      // Only the tokens that earn a candidate, so "one per supplied token"
      // is countable rather than a part-of-speech judgement the model has to
      // reach the same way the validator does.
      tokens: cue.tokens.filter(earnsCandidate).map((token) => ({
        ...token,
        canonicalKey: canonicalVocabulary(token.lemma, token.reading),
      })),
      grammarEvidence: cue.grammarEvidence.flatMap((item) =>
        item.spans.map((span) => ({
          canonicalKey: item.canonicalForm,
          surface: cue.normalizedJapanese.slice(span.start, span.end),
          span,
        })),
      ),
    };
  });
  return { payload, cueIdOf };
};

const instructions =
  "Return exactly one candidate for every supplied token and exactly one for every supplied grammarEvidence entry, and nothing else. Copy cueId, canonicalKey, surface, and span verbatim from the entry you are answering; never derive, reformat, or shorten them. Tokens are vocabulary and take the senseId you choose: a short stable label for the meaning used in this cue. grammarEvidence entries are grammar and take senseId null. meaning is the concise English meaning or function in this cue. impact is required only when missing it is likely to block comprehension, helpful for useful supporting language, and incidental for names, noise, transparent terms, and low-value one-offs. Spans are zero-based UTF-16 code-unit offsets into normalizedJapanese and are supplied; do not compute them. Put plausible alternative sense labels in ambiguity and invent no evidence.";

const detail = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const httpFailure = (status: number): ProviderFailure => {
  const safeDetail = `OpenAI request failed with HTTP ${status}; response body omitted`;
  if (status === 401) return { kind: "authentication", detail: safeDetail };
  if (status === 403) return { kind: "permission", detail: safeDetail };
  if (status === 429) return { kind: "rateLimit", detail: safeDetail };
  return { kind: "offline", detail: safeDetail };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCandidate = (value: unknown): value is CandidateEvidence => {
  if (!isRecord(value) || !isRecord(value["span"])) return false;
  const span = value["span"];
  return (
    (value["kind"] === "vocabulary" || value["kind"] === "grammar") &&
    typeof value["canonicalKey"] === "string" &&
    value["canonicalKey"].trim() !== "" &&
    typeof value["cueId"] === "string" &&
    typeof value["surface"] === "string" &&
    value["surface"] !== "" &&
    Array.isArray(value["ambiguity"]) &&
    value["ambiguity"].every((item) => typeof item === "string") &&
    Number.isInteger(span["start"]) &&
    Number.isInteger(span["end"]) &&
    span["unit"] === "utf16-code-unit" &&
    span["normalization"] === "nfkc-v1" &&
    typeof value["meaning"] === "string" &&
    value["meaning"].trim() !== "" &&
    ((value["kind"] === "vocabulary" &&
      typeof value["senseId"] === "string" &&
      value["senseId"].trim() !== "") ||
      (value["kind"] === "grammar" && value["senseId"] === null)) &&
    (value["impact"] === "required" ||
      value["impact"] === "helpful" ||
      value["impact"] === "incidental") &&
    typeof value["confidence"] === "number" &&
    Number.isFinite(value["confidence"]) &&
    value["confidence"] >= 0 &&
    value["confidence"] <= 1
  );
};

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

type Decoded =
  | { readonly pending: true }
  | { readonly response: ProviderBatchResponse }
  | { readonly failure: ProviderFailure };

const decodeResponse = (
  value: unknown,
  cueIdOf: ReadonlyMap<string, string>,
): Decoded => {
  if (!isRecord(value) || typeof value["id"] !== "string") {
    return {
      failure: { kind: "malformedStructure", detail: "response object has no id" },
    };
  }
  const status = value["status"];
  // Background responses report progress before they report output. Only a
  // terminal status is evidence about the batch; anything else is "not yet".
  if (typeof status === "string" && !terminalStatuses.has(status)) {
    return { pending: true };
  }
  if (status === "cancelled") {
    return {
      failure: { kind: "cancelled", detail: "provider cancelled the response" },
    };
  }
  if (status === "incomplete") {
    return {
      failure: {
        kind: "incompleteResponse",
        detail: "provider response was incomplete",
      },
    };
  }
  if (value["error"] !== null && value["error"] !== undefined) {
    return {
      failure: { kind: "refusal", detail: "provider returned a response error" },
    };
  }
  if (hasRefusal(value)) {
    return {
      failure: { kind: "refusal", detail: "provider refused the request" },
    };
  }
  const text = outputText(value);
  if (text === null) {
    return {
      failure: { kind: "malformedStructure", detail: "response has no output text" },
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return {
      failure: { kind: "malformedStructure", detail: "output text is not JSON" },
    };
  }
  if (
    !isRecord(decoded) ||
    !Array.isArray(decoded["candidates"]) ||
    !decoded["candidates"].every(isCandidate)
  ) {
    return {
      failure: {
        kind: "malformedStructure",
        detail: "structured candidates do not match the local contract",
      },
    };
  }
  // A label the batch does not name is a real modelling error, and saying so
  // here beats letting it surface as an opaque unknown cue id.
  const unknown = decoded["candidates"].find(
    (candidate) => !cueIdOf.has(candidate.cueId),
  );
  if (unknown !== undefined) {
    return {
      failure: {
        kind: "malformedStructure",
        detail: `candidate names cue ${unknown.cueId}, which is not in this batch`,
      },
    };
  }
  const candidates = decoded["candidates"].map((candidate) => ({
    ...candidate,
    cueId: cueIdOf.get(candidate.cueId) as string,
  }));
  const usage = isRecord(value["usage"]) ? value["usage"] : {};
  return {
    response: {
      providerRequestId: value["id"],
      candidates,
      usage: {
        inputTokens:
          typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : null,
        outputTokens:
          typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : null,
      },
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

export const createOpenAiBatchProvider = (
  options: OpenAiProviderOptions,
): BatchProvider => {
  const request = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;

  /**
   * One bounded HTTP call. `notFound` distinguishes a dispatch that aged out of
   * provider-side retention from a transport failure, because the two need
   * opposite recoveries.
   */
  const call = async (
    url: string,
    init: RequestInit,
    outerSignal: AbortSignal | undefined,
  ): Promise<Result<{ value: unknown } | { notFound: true }, ProviderFailure>> => {
    const apiKey = options.apiKey();
    if (apiKey === null || apiKey.trim() === "") {
      return err({
        kind: "authentication",
        detail: "OpenAI API key is not configured",
      });
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
      const response = await request(url, {
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
          kind: "malformedStructure",
          detail:
            responseBody.error.kind === "bodyTooLarge"
              ? "OpenAI response body is too large"
              : "OpenAI response body could not be read",
        });
      }
      try {
        return ok({ value: JSON.parse(new TextDecoder().decode(responseBody.value)) });
      } catch {
        return err({
          kind: "malformedStructure",
          detail: "OpenAI response body is not JSON",
        });
      }
    } catch (cause) {
      if (outerSignal?.aborted === true) {
        return err({ kind: "cancelled", detail: "OpenAI request was cancelled" });
      }
      if (timedOut) return err({ kind: "timeout", detail: "OpenAI request timed out" });
      return err({ kind: "offline", detail: detail(cause) });
    } finally {
      clearTimeout(timeout);
      outerSignal?.removeEventListener("abort", cancel);
    }
  };

  /**
   * Polls one dispatched response to a terminal status. `null` means the
   * dispatch is gone from provider-side retention and cannot be recovered.
   */
  const poll = async (
    cueIdOf: ReadonlyMap<string, string>,
    providerResponseId: string,
    deadline: number,
    outerSignal: AbortSignal | undefined,
  ): Promise<Result<ProviderBatchResponse | null, ProviderFailure>> => {
    const url = `https://api.openai.com/v1/responses/${encodeURIComponent(providerResponseId)}`;
    for (;;) {
      const polled = await call(url, { method: "GET" }, outerSignal);
      if (!polled.ok) return polled;
      if ("notFound" in polled.value) return ok(null);
      const decoded = decodeResponse(polled.value.value, cueIdOf);
      if ("failure" in decoded) return err(decoded.failure);
      if ("response" in decoded) return ok(decoded.response);
      if (outerSignal?.aborted === true) {
        return err({ kind: "cancelled", detail: "OpenAI request was cancelled" });
      }
      if (Date.now() + pollIntervalMs >= deadline) {
        return err({
          kind: "timeout",
          detail: "OpenAI response did not finish within the batch budget",
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
    submit: async (batch, requestKey, dispatched, outerSignal) => {
      const deadline = Date.now() + options.completionTimeoutMs;
      const { payload, cueIdOf } = labelledBatch(batch.cues);
      // background: true returns as soon as the request is queued, so the
      // window in which a crash loses the response id is one short HTTP call
      // rather than the whole generation. store stays false; the provider
      // retains a background response only long enough to be polled.
      const created = await call(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: options.model,
            background: true,
            store: false,
            safety_identifier: createHash("sha256")
              .update("gafu-v2-local-learner")
              .digest("hex"),
            metadata: {
              gafu_request_key: requestKey.slice(0, 512),
              gafu_batch_id: batch.batchId,
            },
            instructions,
            input: JSON.stringify({ cues: payload }),
            text: {
              format: {
                type: "json_schema",
                name: "gafu_preparation_candidates",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["candidates"],
                  properties: {
                    candidates: { type: "array", items: candidateSchema },
                  },
                },
              },
            },
          }),
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
      const body = created.value.value;
      if (!isRecord(body) || typeof body["id"] !== "string") {
        return err({
          kind: "malformedStructure",
          detail: "dispatch response object has no id",
        });
      }
      await dispatched(body["id"]);
      const decoded = decodeResponse(body, cueIdOf);
      if ("failure" in decoded) return err(decoded.failure);
      if ("response" in decoded) return ok(decoded.response);
      const polled = await poll(cueIdOf, body["id"], deadline, outerSignal);
      if (!polled.ok) return polled;
      if (polled.value === null) {
        return err({
          kind: "offline",
          detail: "OpenAI discarded the dispatched response before it was read",
        });
      }
      return ok(polled.value);
    },
    retrieve: (batch, providerResponseId, outerSignal) =>
      poll(
        labelledBatch(batch.cues).cueIdOf,
        providerResponseId,
        Date.now() + options.completionTimeoutMs,
        outerSignal,
      ),
  };
};
