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

const materials = [{}, {}, {}];

const provider = (
  fetcher: OpenAiMaterialFetch,
  key = "secret",
  completionTimeoutMs = 200,
) =>
  createOpenAiMaterialProvider({
    apiKey: () => key,
    model: "gpt-5.6-luna",
    promptVersion: "study-v1",
    timeoutMs: 20,
    completionTimeoutMs,
    pollIntervalMs: 1,
    sleep: async () => {},
    fetch: fetcher,
  });

describe("OpenAI Learning Material adapter", () => {
  test("uses Luna structured Responses without storing provider output", async () => {
    let observed: RequestInit | undefined;
    const material = provider(async (_url, init) => {
      observed = init;
      return Response.json(response(materials));
    }, "sk-private");
    const result = await material.generate(request);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestId).toBe("resp-1");
    const body = JSON.parse(String(observed?.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-5.6-luna");
    expect(body["background"]).toBe(true);
    expect(body["store"]).toBe(false);
    expect(JSON.stringify(body)).toContain('"type":"json_schema"');
    expect(JSON.stringify(body)).not.toContain("sk-private");
    expect(JSON.stringify(material.inspectLastRequest())).not.toContain("sk-private");
  });

  test.each([
    [401, "authentication"],
    [403, "permission"],
    [429, "rateLimit"],
    [500, "offline"],
  ] as const)("maps HTTP %i to %s without response content", async (status, kind) => {
    const result = await provider(
      async () => new Response("private", { status }),
    ).generate(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(JSON.stringify(result.error)).not.toContain("private");
      expect(JSON.stringify(result.error)).not.toContain("secret");
    }
  });

  test("rejects an oversized provider response before parsing it", async () => {
    expect(
      await provider(
        async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
      ).generate(request),
    ).toMatchObject({
      ok: false,
      error: {
        kind: "malformedResponse",
        detail: "OpenAI response body was too large",
      },
    });
  });

  test("separates incomplete, refusal, malformed, timeout, and cancellation", async () => {
    const make = (fetcher: OpenAiMaterialFetch) =>
      createOpenAiMaterialProvider({
        apiKey: () => "secret",
        model: "gpt-5.6-luna",
        promptVersion: "study-v1",
        timeoutMs: 10,
        completionTimeoutMs: 10,
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

  test("dispatches in the background and polls until the response is terminal", async () => {
    const urls: string[] = [];
    let dispatchBody: Record<string, unknown> = {};
    let polls = 0;
    const result = await provider(async (input, init) => {
      urls.push(String(input));
      if (init?.method === "POST") {
        dispatchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: "resp-1", status: "queued" });
      }
      polls += 1;
      return Response.json(
        polls < 3 ? { id: "resp-1", status: "in_progress" } : response(materials),
      );
    }).generate(request);

    // The long wait happens across short polls, so no single call has to be
    // sized against the model's thinking time.
    expect(dispatchBody["background"]).toBe(true);
    expect(dispatchBody["store"]).toBe(false);
    expect(polls).toBe(3);
    expect(urls[0]).toBe("https://api.openai.com/v1/responses");
    expect(urls[1]).toBe("https://api.openai.com/v1/responses/resp-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestId).toBe("resp-1");
  });

  test("reports a dispatch the provider no longer holds as unrecoverable", async () => {
    const result = await provider(async (_input, init) => {
      if (init?.method === "POST")
        return Response.json({ id: "resp-1", status: "queued" });
      return new Response("", { status: 404 });
    }).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("offline");
  });

  test("a generation that outlives its completion budget times out rather than vanishing", async () => {
    const result = await provider(async (_input, init) =>
      Response.json({
        id: "resp-1",
        status: init?.method === "POST" ? "queued" : "in_progress",
      }),
    ).generate(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });

  test("maps a provider-cancelled dispatch to cancellation", async () => {
    const result = await provider(async () =>
      Response.json({ id: "resp-1", status: "cancelled" }),
    ).generate(request);

    expect(result.ok ? "ok" : result.error.kind).toBe("cancelled");
  });

  test("cancels a poll when the caller goes away", async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = await provider(async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        controller.abort();
        return Response.json({ id: "resp-1", status: "queued" });
      }
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted === true) {
          reject(new Error("sk-secret"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("sk-secret")));
      });
    }).generate(request, controller.signal);

    expect(result.ok ? "ok" : result.error.kind).toBe("cancelled");
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });
});
