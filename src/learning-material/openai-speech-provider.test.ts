import { describe, expect, test } from "bun:test";
import {
  createOpenAiSpeechProvider,
  looksLikeMp3,
  OPENAI_SPEECH_ENDPOINT,
} from "./openai-speech-provider.ts";

const mp3 = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const harness = (
  respond: (init: RequestInit) => Response,
  apiKey: string | null = "sk-test",
) => {
  const calls: { input: string; init: RequestInit }[] = [];
  const provider = createOpenAiSpeechProvider({
    apiKey: () => apiKey,
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    speed: 0.95,
    timeoutMs: 50,
    fetch: async (input, init) => {
      calls.push({ input, init: init ?? {} });
      return respond(init ?? {});
    },
  });
  return { provider, calls };
};

describe("saying a sentence through OpenAI speech", () => {
  test("posts the fixed voice request and returns the MP3", async () => {
    const { provider, calls } = harness(() => new Response(mp3, { status: 200 }));
    const spoken = await provider.synthesize("今日 買うと　得する。");
    expect(spoken.ok).toBe(true);
    if (spoken.ok) {
      expect(spoken.value.contentType).toBe("audio/mpeg");
      expect(Array.from(spoken.value.bytes)).toEqual(Array.from(mp3));
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(OPENAI_SPEECH_ENDPOINT);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: "今日 買うと 得する。",
      response_format: "mp3",
      speed: 0.95,
    });
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(
      "Bearer sk-test",
    );
  });

  test("without a key nothing is sent", async () => {
    const { provider, calls } = harness(() => new Response(mp3), null);
    expect(await provider.synthesize("犬")).toEqual({
      ok: false,
      error: { kind: "providerNotConfigured" },
    });
    expect(calls).toEqual([]);
  });

  test("maps provider statuses onto the shared failure kinds", async () => {
    for (const [status, kind] of [
      [401, "authentication"],
      [403, "permission"],
      [429, "rateLimit"],
      [500, "offline"],
    ] as const) {
      const { provider } = harness(() => new Response("", { status }));
      const spoken = await provider.synthesize("犬");
      expect(spoken.ok).toBe(false);
      if (!spoken.ok) expect(spoken.error.kind).toBe(kind);
    }
  });

  test("refuses a body that is not MP3", async () => {
    const { provider } = harness(
      () => new Response("<html>oops</html>", { status: 200 }),
    );
    expect(await provider.synthesize("犬")).toEqual({
      ok: false,
      error: { kind: "malformedResponse", detail: "speech response is not MP3" },
    });
  });

  test("a slow provider times out", async () => {
    const provider = createOpenAiSpeechProvider({
      apiKey: () => "sk-test",
      model: "m",
      voice: "v",
      speed: 1,
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    const spoken = await provider.synthesize("犬");
    expect(spoken.ok).toBe(false);
    if (!spoken.ok) expect(spoken.error.kind).toBe("timeout");
  });
});

test("MP3 detection accepts ID3 and frame sync, rejects the rest", () => {
  expect(looksLikeMp3(mp3)).toBe(true);
  expect(looksLikeMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00]))).toBe(true);
  expect(looksLikeMp3(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]))).toBe(false);
  expect(looksLikeMp3(new Uint8Array([0x49, 0x44]))).toBe(false);
});
