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
            candidates: [evidence("c1", "猫が寝る。", "猫", "vocabulary", "猫:ねこ")],
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
    completionTimeoutMs: 200,
    pollIntervalMs: 1,
    sleep: async () => {},
    fetch: fetcher,
  });

/** Records nothing: most cases do not care that a dispatch was announced. */
const ignoreDispatch = async () => {};

describe("OpenAI preparation provider adapter", () => {
  test("sends server-held credentials and strict structured output", async () => {
    let observed: RequestInit | undefined;
    const result = await provider(async (_input, init) => {
      observed = init;
      return Response.json(successBody);
    }).submit(batch, "request-key", ignoreDispatch);
    expect(result.ok).toBe(true);
    expect(observed?.headers).toEqual({
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(String(observed?.body)) as Record<string, unknown>;
    expect(body["store"]).toBe(false);
    expect(String(body["safety_identifier"])).toHaveLength(64);
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
    ).submit(batch, "request-key", ignoreDispatch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(kind);
      expect(result.error.detail).not.toContain("private body");
    }
  });

  test("rejects incomplete and malformed provider results", async () => {
    const incomplete = await provider(async () =>
      Response.json({ ...successBody, status: "incomplete" }),
    ).submit(batch, "request-key", ignoreDispatch);
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.error.kind).toBe("incompleteResponse");

    const malformed = await provider(async () =>
      Response.json({ ...successBody, output: [] }),
    ).submit(batch, "request-key", ignoreDispatch);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.kind).toBe("malformedStructure");

    const refused = await provider(async () =>
      Response.json({
        ...successBody,
        output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }],
      }),
    ).submit(batch, "request-key", ignoreDispatch);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("refusal");
  });

  test("rejects oversized provider responses before JSON parsing", async () => {
    const result = await provider(
      async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
    ).submit(batch, "request-key", ignoreDispatch);
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "malformedStructure",
        detail: "OpenAI response body is too large",
      },
    });
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
    const timeout = await provider(hangingFetch).submit(
      batch,
      "request-key",
      ignoreDispatch,
    );
    expect(timeout.ok).toBe(false);
    if (!timeout.ok) expect(timeout.error.kind).toBe("timeout");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await provider(hangingFetch).submit(
      batch,
      "request-key",
      ignoreDispatch,
      controller.signal,
    );
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(cancelled.error.kind).toBe("cancelled");

    const missing = await provider(async () => Response.json(successBody), "").submit(
      batch,
      "request-key",
      ignoreDispatch,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("authentication");
  });

  test("labels cues shortly and translates the answer back", async () => {
    // A cue id is `cue-v1:sha256:` plus 64 hex characters. Echoing one per
    // candidate meant reproducing thousands of characters of entropy exactly;
    // one came back 25 characters short and rejected its whole batch.
    const longId = `cue-v1:sha256:${"a1b2c3d4".repeat(8)}`;
    const digestBatch: AnalysisBatch = {
      ...batch,
      cues: batch.cues.map((cue) => ({ ...cue, cueId: longId })),
    };
    let sent: { cues: { cueId: string }[] } = { cues: [] };
    const result = await provider(async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { input: string };
        sent = JSON.parse(body.input);
        return Response.json({ id: "resp_test", status: "queued" });
      }
      return Response.json(successBody);
    }).submit(digestBatch, "request-key", ignoreDispatch);

    expect(longId).toHaveLength(78);
    // The model is asked to echo two characters, not seventy-eight.
    expect(sent.cues[0]?.cueId).toBe("c1");
    expect(String(sent.cues[0]?.cueId)).not.toContain("sha256");
    expect(result.ok).toBe(true);
    // And the answer comes back in the caller's terms.
    if (result.ok) expect(result.value.candidates[0]?.cueId).toBe(longId);
  });

  test("a label the batch does not name is reported as such", async () => {
    const result = await provider(async (_input, init) =>
      init?.method === "POST"
        ? Response.json({ id: "resp_test", status: "queued" })
        : Response.json({
            ...successBody,
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      candidates: [
                        evidence("c99", "猫が寝る。", "猫", "vocabulary", "猫:ねこ"),
                      ],
                    }),
                  },
                ],
              },
            ],
          }),
    ).submit(batch, "request-key", ignoreDispatch);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformedStructure");
      expect(result.error.detail).toContain("c99");
    }
  });

  test("sends only candidate-earning tokens, each with its canonicalKey", async () => {
    const filteredBatch: AnalysisBatch = {
      ...batch,
      cues: [
        {
          cueId: "cue-1",
          normalizedJapanese: "グリズリーは走る",
          tokens: [
            {
              surface: "グリズリー",
              lemma: "グリズリー",
              // Loanwords and latin come back without one, and the validator
              // wants a trailing colon that "lemma:reading" does not describe.
              reading: null,
              partOfSpeech: ["名詞"],
              broadPartOfSpeech: "noun",
              span: {
                start: 0,
                end: 5,
                unit: "utf16-code-unit",
                normalization: "nfkc-v1",
              },
            },
            {
              surface: "は",
              lemma: "は",
              reading: "ハ",
              partOfSpeech: ["助詞"],
              broadPartOfSpeech: "particle",
              span: {
                start: 5,
                end: 6,
                unit: "utf16-code-unit",
                normalization: "nfkc-v1",
              },
            },
          ],
          grammarEvidence: [],
        },
      ],
    };
    let sent: {
      cues: { tokens: { surface: string; canonicalKey: string }[] }[];
    } = { cues: [] };
    await provider(async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { input: string };
        sent = JSON.parse(body.input);
        return Response.json({ id: "resp_test", status: "queued" });
      }
      return Response.json(successBody);
    }).submit(filteredBatch, "request-key", ignoreDispatch);

    const tokens = sent.cues[0]?.tokens ?? [];
    // The particle earns no candidate, so it is not offered: the answer's size
    // is fixed by the payload, not by the model matching contentParts.
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.surface).toBe("グリズリー");
    // Copied, not derived from a rule that omits the null-reading case.
    expect(tokens[0]?.canonicalKey).toBe("グリズリー:");
  });

  test("shows a copyable surface for every grammar occurrence", async () => {
    // The candidate contract asks the model to copy `surface` and `span`. For
    // grammar it previously had only a canonical form, which is a label and
    // usually absent from the cue, so it had to compute UTF-16 offsets -- and
    // one wrong span rejects the whole batch.
    const grammarBatch: AnalysisBatch = {
      ...batch,
      cues: [
        {
          cueId: "cue-1",
          normalizedJapanese: "毎日走っているので、疲れた。",
          tokens: [],
          grammarEvidence: [
            {
              canonicalForm: "〜ている",
              spans: [
                {
                  start: 4,
                  end: 7,
                  unit: "utf16-code-unit",
                  normalization: "nfkc-v1",
                },
              ],
            },
            {
              canonicalForm: "受身形",
              spans: [
                {
                  start: 7,
                  end: 9,
                  unit: "utf16-code-unit",
                  normalization: "nfkc-v1",
                },
              ],
            },
          ],
        },
      ],
    };
    let sent: { cues: { normalizedJapanese: string; grammarEvidence: unknown[] }[] } = {
      cues: [],
    };
    await provider(async (_input, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { input: string };
        sent = JSON.parse(body.input);
        return Response.json({ id: "resp_test", status: "queued" });
      }
      return Response.json(successBody);
    }).submit(grammarBatch, "request-key", ignoreDispatch);

    const cue = sent.cues[0];
    const occurrences = cue?.grammarEvidence as readonly {
      canonicalKey: string;
      surface: string;
      span: { start: number; end: number };
    }[];
    expect(occurrences).toHaveLength(2);
    for (const occurrence of occurrences) {
      // Copying the surface verbatim is enough to satisfy the validator.
      expect(
        cue?.normalizedJapanese.slice(occurrence.span.start, occurrence.span.end),
      ).toBe(occurrence.surface);
    }
    // The label is still supplied as canonicalKey, and still is not the text.
    expect(occurrences[0]?.canonicalKey).toBe("〜ている");
    expect(occurrences[0]?.surface).toBe("ている");
    expect(occurrences[1]?.canonicalKey).toBe("受身形");
    expect(occurrences[1]?.surface).toBe("ので");
  });

  test("dispatches in the background and polls until the response is terminal", async () => {
    const urls: string[] = [];
    let dispatchBody: Record<string, unknown> = {};
    let polls = 0;
    const result = await provider(async (input, init) => {
      urls.push(String(input));
      if (init?.method === "POST") {
        dispatchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({ id: "resp_test", status: "queued" });
      }
      polls += 1;
      return Response.json(
        polls < 3 ? { id: "resp_test", status: "in_progress" } : successBody,
      );
    }).submit(batch, "request-key", ignoreDispatch);

    // The long wait happens across short polls, so no single call has to be
    // sized against the model's thinking time.
    expect(dispatchBody["background"]).toBe(true);
    expect(dispatchBody["store"]).toBe(false);
    expect(polls).toBe(3);
    expect(urls[0]).toBe("https://api.openai.com/v1/responses");
    expect(urls[1]).toBe("https://api.openai.com/v1/responses/resp_test");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.providerRequestId).toBe("resp_test");
  });

  test("names the dispatched request before waiting for its output", async () => {
    const announced: string[] = [];
    let pollsBeforeAnnouncement = -1;
    let polls = 0;
    await provider(async (_input, init) => {
      if (init?.method === "POST")
        return Response.json({ id: "resp_test", status: "queued" });
      polls += 1;
      return Response.json(successBody);
    }).submit(batch, "request-key", async (id) => {
      announced.push(id);
      pollsBeforeAnnouncement = polls;
    });

    expect(announced).toEqual(["resp_test"]);
    // Announced before the first poll: an interrupted wait still leaves a
    // request that can be retrieved instead of repaid.
    expect(pollsBeforeAnnouncement).toBe(0);
  });

  test("retrieves a dispatched response by the provider's own id", async () => {
    const urls: string[] = [];
    const result = await provider(async (input) => {
      urls.push(String(input));
      return Response.json(successBody);
    }).retrieve(batch, "resp_test");

    expect(urls).toEqual(["https://api.openai.com/v1/responses/resp_test"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.candidates).toHaveLength(1);
  });

  test("reports a dispatch the provider no longer holds as unrecoverable", async () => {
    const result = await provider(
      async () => new Response("", { status: 404 }),
    ).retrieve(batch, "resp_expired");
    // Not a failure: the caller must decide whether to pay for it again.
    expect(result).toEqual({ ok: true, value: null });
  });

  test("a batch that outlives its completion budget times out rather than vanishing", async () => {
    const result = await provider(async (_input, init) =>
      Response.json({
        id: "resp_test",
        status: init?.method === "POST" ? "queued" : "in_progress",
      }),
    ).submit(batch, "request-key", ignoreDispatch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });
});
