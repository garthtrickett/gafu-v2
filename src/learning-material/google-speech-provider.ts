import { err, ok, type Result } from "../result.ts";
import type { MaterialProviderFailure } from "./generated-contracts.ts";
import { looksLikeMp3 } from "./openai-speech-provider.ts";
import {
  MAX_SPEECH_INPUT_BYTES,
  type SpeechAudio,
  type SpeechProvider,
} from "./speech-contracts.ts";

export type GoogleSpeechFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type Options = Readonly<{
  apiKey: () => string | null;
  /** V1's voice: a native Japanese neural voice, a shade under natural pace. */
  languageCode?: string;
  voice?: string;
  speakingRate?: number;
  timeoutMs: number;
  fetch?: GoogleSpeechFetch;
}>;

export const GOOGLE_SPEECH_ENDPOINT =
  "https://texttospeech.googleapis.com/v1/text:synthesize";
const maximumAudioBytes = 5 * 1024 * 1024;

/**
 * Google Cloud Text-to-Speech over REST with an API key, the voice V1 used.
 * The response carries the MP3 as base64; it is decoded and checked for MP3
 * framing before it is trusted.
 */
export const createGoogleSpeechProvider = (options: Options): SpeechProvider => {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const languageCode = options.languageCode ?? "ja-JP";
  const voice = options.voice ?? "ja-JP-Neural2-B";
  const speakingRate = options.speakingRate ?? 0.95;
  const synthesize = async (
    text: string,
    signal?: AbortSignal,
  ): Promise<Result<SpeechAudio, MaterialProviderFailure>> => {
    const apiKey = options.apiKey();
    if (apiKey === null || apiKey.trim() === "")
      return err({ kind: "providerNotConfigured" });
    const input = text.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (
      input.length === 0 ||
      new TextEncoder().encode(input).byteLength > MAX_SPEECH_INPUT_BYTES
    ) {
      return err({
        kind: "malformedResponse",
        detail: "speech input is empty or too long",
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await send(
        `${GOOGLE_SPEECH_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: input },
            voice: { languageCode, name: voice },
            audioConfig: { audioEncoding: "MP3", speakingRate },
          }),
          signal: controller.signal,
        },
      );
      if (response.status === 401)
        return err({ kind: "authentication", detail: "HTTP 401" });
      if (response.status === 403)
        return err({ kind: "permission", detail: "HTTP 403" });
      if (response.status === 429)
        return err({ kind: "rateLimit", detail: "HTTP 429" });
      if (!response.ok)
        return err({ kind: "offline", detail: `HTTP ${response.status}` });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return err({
          kind: "malformedResponse",
          detail: "speech response was not JSON",
        });
      }
      const encoded =
        typeof body === "object" && body !== null && "audioContent" in body
          ? (body as { audioContent: unknown }).audioContent
          : null;
      if (typeof encoded !== "string" || encoded.length === 0) {
        return err({
          kind: "malformedResponse",
          detail: "speech response had no audio",
        });
      }
      if (encoded.length > (maximumAudioBytes * 4) / 3 + 4) {
        return err({ kind: "malformedResponse", detail: "speech response too large" });
      }
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      if (!looksLikeMp3(bytes)) {
        return err({ kind: "malformedResponse", detail: "speech response is not MP3" });
      }
      return ok({ contentType: "audio/mpeg", bytes });
    } catch (cause) {
      if (signal?.aborted) return err({ kind: "cancelled", detail: "cancelled" });
      if (controller.signal.aborted)
        return err({ kind: "timeout", detail: "speech timed out" });
      return err({ kind: "offline", detail: String(cause) });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    identity: {
      provider: "google-tts",
      model: languageCode,
      voice,
      synthesisVersion: 1,
    },
    synthesize,
  };
};
