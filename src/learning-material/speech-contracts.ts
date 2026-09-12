import type { Result } from "../result.ts";
import type { MaterialProviderFailure } from "./generated-contracts.ts";

export type SpeechAudio = Readonly<{
  contentType: "audio/mpeg" | "audio/wav";
  bytes: Uint8Array;
}>;

/**
 * Says one Japanese sentence. The identity travels with every stored clip so
 * a voice or rate change is visible per row; bump `synthesisVersion` to make
 * old clips regenerate rather than purging them.
 */
export type SpeechProvider = Readonly<{
  identity: Readonly<{
    provider: string;
    model: string;
    voice: string;
    synthesisVersion: number;
  }>;
  synthesize: (
    text: string,
    signal?: AbortSignal,
  ) => Promise<Result<SpeechAudio, MaterialProviderFailure>>;
}>;

/** UTF-8 bound on one synthesis input; a sentence is far under it. */
export const MAX_SPEECH_INPUT_BYTES = 5_000;
