import { ok, type Result } from "../result.ts";
import {
  type LocalMediaError,
  type LocalMediaProgress,
  processLocalMedia,
} from "./local-media-engine.ts";

export type AudioRepairError = LocalMediaError;
export type AudioRepairProgress = LocalMediaProgress;

export const repairBrowserAudio = async (
  file: File,
  signal: AbortSignal,
  report: (progress: AudioRepairProgress) => void,
): Promise<Result<File, AudioRepairError>> => {
  const result = await processLocalMedia(file, "repairAudio", signal, report);
  if (!result.ok) return result;
  return ok(
    new File([result.value], "firefox-repaired.mkv", { type: "video/x-matroska" }),
  );
};
