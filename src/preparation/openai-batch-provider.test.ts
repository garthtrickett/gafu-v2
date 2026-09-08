import { describe, expect, test } from "bun:test";
import { evidence } from "../../tests/support/deterministic-batch-provider.ts";
import type { AnalysisBatch } from "./batching-contracts.ts";
import {
  createOpenAiBatchProvider,
  type OpenAiFetch,
} from "./openai-batch-provider.ts";

const batch: AnalysisBatch = {
  runId: "run-test",
  batchId: "batch-0001",
  inputDigest: "sha256:test",
  cues: [
    {
      cueId: "cue-1",
      normalizedJapanese: "猫が寝る。",
      tokens: [],
      grammarEvidence: [],
    },
  ],
};

const successBody = {
  id: "resp_test",
  status: "completed",
  error: null,
  usage: { input_tokens: 20, output_tokens: 10 },
  output: [
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            candidates: [
              evidence("cue-1", "猫が寝る。", "猫", "vocabulary", "猫:ねこ"),
            ],
          }),
        },
      ],
    },
  ],
};

const provider = (fetcher: OpenAiFetch, key = "test-secret") =>
  createOpenAiBatchProvider({
    apiKey: () => key,
    model: "gpt-5.6-luna",
    promptVersion: "preparation-v1",
    timeoutMs: 20,
    fetch: fetcher,
  });

describe("OpenAI preparation provider adapter", () => {
  test("sends server-held credentials and strict structured output", async () => {
    let observed: RequestInit | undefined;
    const result = await provider(async (_input, init) => {
      observed = init;
      return Response.json(successBody);
    }).submit(batch, "request-key");
    expect(result.ok).toBe(true);
    expect(observed?.headers).toEqual({
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(observed?.body)) as Record<string, unknown>;
    expect(body["store"]).toBe(false);
    expect(body["model"]).toBe("gpt-5.6-luna");
    expect(JSON.stringify(body)).not.toContain("test-secret");
    expect(JSON.stringify(body)).toContain('"type":"json_schema"');
  });

  test.each([
    [401, "authentication"],
    [403, "permission"],
    [429, "rateLimit"],
    [500, "offline"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const result = await provider(
      async () => new Response("private body", { status }),
    ).submit(batch, "request-key");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(result.error.detail).not.toContain("private body");
    }
  });

  test("rejects incomplete and malformed provider results", async () => {
    const incomplete = await provider(async () =>
      Response.json({ ...successBody, status: "incomplete" }),
    ).submit(batch, "request-key");
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.error.kind).toBe("incompleteResponse");

    const malformed = await provider(async () =>
      Response.json({ ...successBody, output: [] }),
    ).submit(batch, "request-key");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.kind).toBe("malformedStructure");

    const refused = await provider(async () =>
      Response.json({
        ...successBody,
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      }),
    ).submit(batch, "request-key");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("refusal");
  });

  test("distinguishes timeout, cancellation, and missing credentials", async () => {
    const hangingFetch: OpenAiFetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const timeout = await provider(hangingFetch).submit(batch, "request-key");
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.error.kind).toBe("timeout");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await provider(hangingFetch).submit(
      batch,
      "request-key",
      controller.signal,
    );
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.error.kind).toBe("cancelled");

    const missing = await provider(async () => Response.json(successBody), "").submit(
      batch,
      "request-key",
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("authentication");
  });

  test("does not claim it can retrieve an uncertain request by local key", async () => {
    const result = await provider(async () => Response.json(successBody)).retrieve(
      "local-request-key",
    );
    expect(result).toEqual({ ok: true, value: null });
  });
});
