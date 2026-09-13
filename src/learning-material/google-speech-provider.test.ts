import { describe, expect, test } from "bun:test";
import {
  createGoogleSpeechProvider,
  GOOGLE_SPEECH_ENDPOINT,
} from "./google-speech-provider.ts";

const mp3 = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const harness = (
  respond: (init: RequestInit) => Response,
  apiKey: string | null = "g-key",
) => {
  const calls: { input: string; init: RequestInit }[] = [];
  const provider = createGoogleSpeechProvider({
    apiKey: () => apiKey,
    timeoutMs: 50,
    fetch: async (input, init) => {
      calls.push({ input, init: init ?? {} });
      return respond(init ?? {});
    },
  });
  return { provider, calls };
};

describe("saying a sentence through Google Cloud Text-to-Speech", () => {
  test("posts V1's voice settings with the key in the query and decodes the MP3", async () => {
    const { provider, calls } = harness(() =>
      Response.json({ audioContent: base64(mp3) }),
    );
    const spoken = await provider.synthesize("今日は　日本語の勉強を続けます。");
    expect(spoken.ok).toBe(true);
    if (spoken.ok) {
      expect(spoken.value.contentType).toBe("audio/mpeg");
      expect(Array.from(spoken.value.bytes)).toEqual(Array.from(mp3));
    }
    expect(calls[0]?.input).toBe(`${GOOGLE_SPEECH_ENDPOINT}?key=g-key`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      input: { text: "今日は 日本語の勉強を続けます。" },
      voice: { languageCode: "ja-JP", name: "ja-JP-Neural2-B" },
      audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
    });
    expect(provider.identity).toEqual({
      provider: "google-tts",
      model: "ja-JP",
      voice: "ja-JP-Neural2-B",
      synthesisVersion: 1,
    });
  });

  test("without a key nothing is sent", async () => {
    const { provider, calls } = harness(() => Response.json({}), null);
    expect(await provider.synthesize("犬")).toEqual({
      ok: false,
      error: { kind: "providerNotConfigured" },
    });
    expect(calls).toEqual([]);
  });

  test("maps statuses and refuses a body that is not MP3", async () => {
    for (const [status, kind] of [
      [401, "authentication"],
      [403, "permission"],
      [429, "rateLimit"],
      [500, "offline"],
    ] as const) {
      const spoken = await harness(
        () => new Response("", { status }),
      ).provider.synthesize("犬");
      expect(spoken.ok).toBe(false);
      if (!spoken.ok) expect(spoken.error.kind).toBe(kind);
    }
    const notMp3 = await harness(() =>
      Response.json({
        audioContent: base64(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0])),
      }),
    ).provider.synthesize("犬");
    expect(notMp3).toEqual({
      ok: false,
      error: { kind: "malformedResponse", detail: "speech response is not MP3" },
    });
    const empty = await harness(() => Response.json({})).provider.synthesize("犬");
    expect(empty).toEqual({
      ok: false,
      error: { kind: "malformedResponse", detail: "speech response had no audio" },
    });
  });
});
