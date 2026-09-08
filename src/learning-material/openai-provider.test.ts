import { describe, expect, test } from "bun:test";
import { asCardId } from "../study/contracts.ts";
import type { MaterialProviderRequest } from "./generated-contracts.ts";
import {
  createOpenAiMaterialProvider,
  type OpenAiMaterialFetch,
} from "./openai-provider.ts";

const request: MaterialProviderRequest = {
  mode: "review",
  candidateCount: 3,
  recentJapanese: [],
  card: {
    id: asCardId("card-1"),
    type: "vocabulary",
    content: {
      lemma: "猫",
      reading: "ねこ",
      partOfSpeech: "noun",
      meaning: "cat",
      usageNotes: "",
    },
    state: "active",
    supportReadyAt: null,
    stagedAt: "2026-09-08T00:00:00.000Z",
    admittedAt: "2026-09-08T00:00:00.000Z",
    dueAt: "2026-09-08T00:00:00.000Z",
    schedulePhase: "new",
    reviewCount: 0,
  },
  knowledge: {
    vocabulary: [],
    grammar: [],
    baseline: {
      id: "none",
      version: null,
      availability: "unavailable",
      enabledCount: 0,
      entries: [],
    },
  },
};

const response = (materials: readonly unknown[]) => ({
  id: "resp-1",
  status: "completed",
  error: null,
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify({ materials }) }],
    },
  ],
});

describe("OpenAI Learning Material adapter", () => {
  test("uses Luna structured Responses without storing provider output", async () => {
    let observed: RequestInit | undefined;
    const provider = createOpenAiMaterialProvider({
      apiKey: () => "sk-private",
      model: "gpt-5.6-luna",
      promptVersion: "study-v1",
      timeoutMs: 100,
      fetch: async (_url, init) => {
        observed = init;
        return Response.json(response([{}, {}, {}]));
      },
    });
    const result = await provider.generate(request);
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(observed?.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-5.6-luna");
    expect(body["store"]).toBe(false);
    expect(JSON.stringify(body)).toContain('"type":"json_schema"');
    expect(JSON.stringify(body)).not.toContain("sk-private");
    expect(JSON.stringify(provider.inspectLastRequest())).not.toContain("sk-private");
  });

  test.each([
    [401, "authentication"],
    [403, "permission"],
    [429, "rateLimit"],
    [500, "offline"],
  ] as const)("maps HTTP %i to %s without response content", async (status, kind) => {
    const provider = createOpenAiMaterialProvider({
      apiKey: () => "secret",
      model: "gpt-5.6-luna",
      promptVersion: "study-v1",
      timeoutMs: 100,
      fetch: async () => new Response("private", { status }),
    });
    const result = await provider.generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(JSON.stringify(result.error)).not.toContain("private");
      expect(JSON.stringify(result.error)).not.toContain("secret");
    }
  });

  test("separates incomplete, refusal, malformed, timeout, and cancellation", async () => {
    const make = (fetcher: OpenAiMaterialFetch) =>
      createOpenAiMaterialProvider({
        apiKey: () => "secret",
        model: "gpt-5.6-luna",
        promptVersion: "study-v1",
        timeoutMs: 10,
        fetch: fetcher,
      });
    const incomplete = await make(async () =>
      Response.json({ ...response([]), status: "incomplete" }),
    ).generate(request);
    expect(incomplete.ok ? "ok" : incomplete.error.kind).toBe("incompleteResponse");
    const refused = await make(async () =>
      Response.json({
        ...response([]),
        output: [{ type: "message", content: [{ type: "refusal" }] }],
      }),
    ).generate(request);
    expect(refused.ok ? "ok" : refused.error.kind).toBe("refusal");
    const malformed = await make(async () =>
      Response.json({ id: "x", output: [] }),
    ).generate(request);
    expect(malformed.ok ? "ok" : malformed.error.kind).toBe("malformedResponse");

    const hanging = async (
      _url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error("sk-secret"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("sk-secret")));
      });
    const timeout = await make(hanging).generate(request);
    expect(timeout.ok ? "ok" : timeout.error.kind).toBe("timeout");
    const controller = new AbortController();
    controller.abort();
    const cancelled = await make(hanging).generate(request, controller.signal);
    expect(cancelled.ok ? "ok" : cancelled.error.kind).toBe("cancelled");
  });
});
