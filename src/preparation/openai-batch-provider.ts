import { err, ok } from "../result.ts";
import type {
  BatchProvider,
  CandidateEvidence,
  ProviderBatchResponse,
  ProviderFailure,
} from "./batching-contracts.ts";

export type OpenAiFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type OpenAiProviderOptions = Readonly<{
  apiKey: () => string | null;
  model: string;
  promptVersion: string;
  timeoutMs: number;
  fetch?: OpenAiFetch;
}>;

const candidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "canonicalKey", "cueId", "surface", "span", "ambiguity"],
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
    ambiguity: { type: "array", items: { type: "string" } },
  },
} as const;

const detail = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

const httpFailure = (status: number, body: string): ProviderFailure => {
  const safeDetail = `OpenAI request failed with HTTP ${status}${body === "" ? "" : " (response body omitted)"}`;
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
    typeof value["cueId"] === "string" &&
    typeof value["surface"] === "string" &&
    Array.isArray(value["ambiguity"]) &&
    value["ambiguity"].every((item) => typeof item === "string") &&
    Number.isInteger(span["start"]) &&
    Number.isInteger(span["end"]) &&
    span["unit"] === "utf16-code-unit" &&
    span["normalization"] === "nfkc-v1"
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

const decodeResponse = (
  value: unknown,
): { response: ProviderBatchResponse } | { failure: ProviderFailure } => {
  if (!isRecord(value) || typeof value["id"] !== "string") {
    return {
      failure: { kind: "malformedStructure", detail: "response object has no id" },
    };
  }
  if (value["status"] === "incomplete") {
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
  const usage = isRecord(value["usage"]) ? value["usage"] : {};
  return {
    response: {
      providerRequestId: value["id"],
      candidates: decoded["candidates"],
      usage: {
        inputTokens:
          typeof usage["input_tokens"] === "number" ? usage["input_tokens"] : null,
        outputTokens:
          typeof usage["output_tokens"] === "number" ? usage["output_tokens"] : null,
      },
    },
  };
};

export const createOpenAiBatchProvider = (
  options: OpenAiProviderOptions,
): BatchProvider => {
  const request = options.fetch ?? fetch;
  return {
    identity: {
      provider: "openai-responses",
      model: options.model,
      promptVersion: options.promptVersion,
    },
    submit: async (batch, requestKey, outerSignal) => {
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
        const response = await request("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model,
            store: true,
            metadata: {
              gafu_request_key: requestKey.slice(0, 512),
              gafu_batch_id: batch.batchId,
            },
            instructions:
              "Return one candidate for every supplied token and deterministic grammar-evidence item. For vocabulary, canonicalKey is exactly lemma:reading from the token. For grammar, canonicalKey is exactly canonicalForm. Copy cueId, surface, and span exactly from the supplied cue. Spans are zero-based UTF-16 code-unit offsets into normalizedJapanese. Preserve unresolved alternatives in ambiguity and invent no evidence.",
            input: JSON.stringify({ cues: batch.cues }),
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
          signal: controller.signal,
        });
        if (!response.ok)
          return err(httpFailure(response.status, await response.text()));
        let value: unknown;
        try {
          value = await response.json();
        } catch {
          return err({
            kind: "malformedStructure",
            detail: "OpenAI response body is not JSON",
          });
        }
        const decoded = decodeResponse(value);
        return "failure" in decoded ? err(decoded.failure) : ok(decoded.response);
      } catch (cause) {
        if (outerSignal?.aborted === true) {
          return err({ kind: "cancelled", detail: "OpenAI request was cancelled" });
        }
        if (timedOut)
          return err({ kind: "timeout", detail: "OpenAI request timed out" });
        return err({ kind: "offline", detail: detail(cause) });
      } finally {
        clearTimeout(timeout);
        outerSignal?.removeEventListener("abort", cancel);
      }
    },
    retrieve: async () => ok(null),
  };
};
