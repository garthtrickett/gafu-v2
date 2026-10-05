import { err, type Result } from "../result.ts";
import {
  type LocalMediaError,
  type LocalMediaProgress,
  processLocalMedia,
} from "./local-media-engine.ts";
import {
  audioActivity,
  type CueTime,
  type TimingEstimate,
  type TimingFailure,
} from "./timing-alignment.ts";

export type AudioAnalysisFailure = LocalMediaError | TimingFailure;

export const analyzeSubtitleTiming = async (
  file: File,
  cues: readonly CueTime[],
  signal: AbortSignal,
  report: (progress: LocalMediaProgress) => void,
): Promise<Result<TimingEstimate, AudioAnalysisFailure>> => {
  const decoded = await processLocalMedia(file, "analyzeTiming", signal, report);
  if (!decoded.ok) return decoded;
  if (signal.aborted) return err({ kind: "cancelled" });
  report({ fraction: 1, message: "Matching subtitle times to audio activity…" });
  const activity = audioActivity(decoded.value);
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    const finish = (result: Result<TimingEstimate, AudioAnalysisFailure>): void => {
      signal.removeEventListener("abort", cancel);
      worker?.terminate();
      resolve(result);
    };
    const cancel = (): void => finish(err({ kind: "cancelled" }));
    signal.addEventListener("abort", cancel, { once: true });
    try {
      worker = new Worker(new URL("./timing-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<Result<TimingEstimate, TimingFailure>>) =>
        finish(event.data);
      worker.onerror = () =>
        finish(
          err({
            kind: "engineUnavailable",
            detail:
              "The timing worker could not run. You can still set the manual offset.",
          }),
        );
      worker.postMessage({ activity, cues }, [activity.buffer]);
    } catch (cause) {
      finish(err({ kind: "engineUnavailable", detail: String(cause).slice(-1200) }));
    }
  });
};
