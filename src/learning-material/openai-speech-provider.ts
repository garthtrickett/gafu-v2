import { err, ok, type Result } from "../result.ts";
import type { MaterialProviderFailure } from "./generated-contracts.ts";
import {
  MAX_SPEECH_INPUT_BYTES,
  type SpeechAudio,
  type SpeechProvider,
} from "./speech-contracts.ts";

export type SpeechFetch = (input: string, init?: RequestInit) => Promise<Response>;

type Options = Readonly<{
  apiKey: () => string | null;
  model: string;
  voice: string;
  /** 0.95 matched the V1 Japanese voice: a shade under natural, for a learner. */
  speed: number;
  timeoutMs: number;
  fetch?: SpeechFetch;
}>;

export const OPENAI_SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";
const maximumAudioBytes = 5 * 1024 * 1024;

/** ID3 header or an MPEG frame sync: anything else is not the MP3 we asked for. */
export const looksLikeMp3 = (bytes: Uint8Array): boolean =>
  bytes.length > 4 &&
  ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0));

export const createOpenAiSpeechProvider = (options: Options): SpeechProvider => {
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const synthesize = async (
    text: string,
    signal?: AbortSignal,
  ): Promise<Result<SpeechAudio, MaterialProviderFailure>> => {
    const apiKey = options.apiKey();
    if (apiKey === null) return err({ kind: "providerNotConfigured" });
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
      const response = await send(OPENAI_SPEECH_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          voice: options.voice,
          input,
          response_format: "mp3",
          speed: options.speed,
        }),
        signal: controller.signal,
      });
      if (response.status === 401)
        return err({ kind: "authentication", detail: "HTTP 401" });
      if (response.status === 403)
        return err({ kind: "permission", detail: "HTTP 403" });
      if (response.status === 429)
        return err({ kind: "rateLimit", detail: "HTTP 429" });
      if (!response.ok)
        return err({ kind: "offline", detail: `HTTP ${response.status}` });
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maximumAudioBytes) {
        return err({ kind: "malformedResponse", detail: "speech response too large" });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maximumAudioBytes) {
        return err({ kind: "malformedResponse", detail: "speech response too large" });
      }
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
      provider: "openai",
      model: options.model,
      voice: options.voice,
      synthesisVersion: 1,
    },
    synthesize,
  };
};
