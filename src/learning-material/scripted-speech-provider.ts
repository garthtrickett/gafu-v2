import { ok, type Result } from "../result.ts";
import type { MaterialProviderFailure } from "./generated-contracts.ts";
import type { SpeechAudio, SpeechProvider } from "./speech-contracts.ts";

/**
 * A short silent WAV: valid audio any browser plays, produced with no
 * network, so journeys exercise the whole clip path.
 */
export const silentWav = (milliseconds = 300): Uint8Array => {
  const sampleRate = 8_000;
  const samples = Math.round((sampleRate * milliseconds) / 1000);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
};

export type ScriptedSpeechStep =
  | Result<SpeechAudio, MaterialProviderFailure>
  | ((text: string) => Result<SpeechAudio, MaterialProviderFailure>);

export const createScriptedSpeechProvider = (
  steps: readonly ScriptedSpeechStep[],
  onSynthesize?: (text: string) => void,
): SpeechProvider => {
  let index = 0;
  return {
    identity: {
      provider: "scripted",
      model: "deterministic",
      voice: "silence",
      synthesisVersion: 1,
    },
    synthesize: async (text) => {
      onSynthesize?.(text);
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) {
        return { ok: false, error: { kind: "offline", detail: "script exhausted" } };
      }
      return typeof step === "function" ? step(text) : step;
    },
  };
};

export const createDeterministicSpeechProvider = (): SpeechProvider =>
  createScriptedSpeechProvider([ok({ contentType: "audio/wav", bytes: silentWav() })]);
