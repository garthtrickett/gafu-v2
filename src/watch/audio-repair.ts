import wasmUrl from "@ffmpeg/core/wasm?url";
import coreUrl from "@ffmpeg/core?url";
import { FFFSType, FFmpeg } from "@ffmpeg/ffmpeg";
import workerUrl from "@ffmpeg/ffmpeg/worker?worker&url";
import { err, ok, type Result } from "../result.ts";

export type AudioRepairError = Readonly<{
  kind: "cancelled" | "engineUnavailable" | "conversionFailed";
}>;

export type AudioRepairProgress = Readonly<{
  fraction: number;
  message: string;
}>;

// A fresh worker owns one conversion and its memory. WORKERFS reads the File
// directly rather than copying an entire episode into the WASM heap.
export const repairBrowserAudio = async (
  file: File,
  signal: AbortSignal,
  report: (progress: AudioRepairProgress) => void,
): Promise<Result<File, AudioRepairError>> => {
  if (signal.aborted) return err({ kind: "cancelled" });
  const engine = new FFmpeg();
  const cancel = (): void => engine.terminate();
  signal.addEventListener("abort", cancel, { once: true });
  let failure: AudioRepairError["kind"] = "engineUnavailable";
  try {
    report({ fraction: 0, message: "Loading the browser audio engine…" });
    await engine.load({
      classWorkerURL: workerUrl,
      coreURL: new URL(coreUrl, window.location.href).href,
      wasmURL: new URL(wasmUrl, window.location.href).href,
    });
    if (signal.aborted) return err({ kind: "cancelled" });
    failure = "conversionFailed";
    await engine.createDir("/media");
    const mounted = await engine.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "input.mkv", data: file }] },
      "/media",
    );
    if (!mounted) return err({ kind: "conversionFailed" });
    report({ fraction: 0.05, message: "Converting the first audio track locally…" });
    engine.on("progress", ({ progress }) => {
      if (!signal.aborted) {
        report({
          fraction: Number.isFinite(progress)
            ? 0.05 + Math.max(0, Math.min(progress, 1)) * 0.9
            : 0.05,
          message: "Converting the first audio track locally…",
        });
      }
    });
    const exitCode = await engine.exec([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "/media/input.mkv",
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-f",
      "ogg",
      "/audio.ogg",
    ]);
    if (exitCode !== 0) return err({ kind: "conversionFailed" });
    const data = await engine.readFile("/audio.ogg");
    if (typeof data === "string" || data.byteLength === 0) {
      return err({ kind: "conversionFailed" });
    }
    if (signal.aborted) return err({ kind: "cancelled" });
    report({ fraction: 1, message: "Preparing Firefox-compatible audio…" });
    return ok(
      new File([new Uint8Array(data)], "firefox-audio.ogg", { type: "audio/ogg" }),
    );
  } catch {
    return err({ kind: signal.aborted ? "cancelled" : failure });
  } finally {
    signal.removeEventListener("abort", cancel);
    engine.terminate();
  }
};
