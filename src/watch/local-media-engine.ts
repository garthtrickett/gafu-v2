import wasmUrl from "@ffmpeg/core/wasm?url";
import coreUrl from "@ffmpeg/core?url";
import { FFFSType, FFmpeg } from "@ffmpeg/ffmpeg";
import workerUrl from "@ffmpeg/ffmpeg/worker?worker&url";
import { err, ok, type Result } from "../result.ts";

export type LocalMediaError = Readonly<{
  kind: "cancelled" | "engineUnavailable" | "conversionFailed";
  detail?: string;
}>;

export type LocalMediaProgress = Readonly<{
  fraction: number;
  message: string;
}>;

// A fresh worker owns one conversion and its memory. WORKERFS reads the File
// directly rather than copying an entire episode into the WASM heap.
export const processLocalMedia = async (
  file: File,
  operation: "repairAudio" | "analyzeTiming",
  signal: AbortSignal,
  report: (progress: LocalMediaProgress) => void,
): Promise<Result<Uint8Array<ArrayBuffer>, LocalMediaError>> => {
  if (signal.aborted) return err({ kind: "cancelled" });
  const engine = new FFmpeg();
  const cancel = (): void => engine.terminate();
  signal.addEventListener("abort", cancel, { once: true });
  let failure: LocalMediaError["kind"] = "engineUnavailable";
  let conversionDetail = "";
  engine.on("log", ({ type, message }) => {
    if (type === "stderr") {
      conversionDetail = `${conversionDetail}\n${message}`.trim().slice(-1200);
    }
  });
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
    if (!mounted) {
      return err({
        kind: "conversionFailed",
        detail: "The local file could not be opened.",
      });
    }
    const message =
      operation === "repairAudio"
        ? "Converting the first audio track locally…"
        : "Analyzing audio activity locally…";
    report({ fraction: 0.05, message });
    engine.on("progress", ({ progress }) => {
      if (!signal.aborted) {
        report({
          fraction: Number.isFinite(progress)
            ? 0.05 + Math.max(0, Math.min(progress, 1)) * 0.9
            : 0.05,
          message,
        });
      }
    });
    const output = operation === "repairAudio" ? "/repaired.mkv" : "/activity.pcm";
    const exitCode = await engine.exec(
      operation === "repairAudio"
        ? [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "/media/input.mkv",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            // Muting the source cannot prevent Firefox from buffering on embedded
            // FLAC. Copy its encoded video frames and replace its audio in one
            // container, keeping native playback controls and its timestamps.
            "-c:v",
            "copy",
            "-c:a",
            // The pinned WASM libopus encoder traps on stereo FLAC input. Vorbis
            // preserves the channels and plays in Firefox without that encoder path.
            "libvorbis",
            "-b:a",
            "128k",
            "-avoid_negative_ts",
            "disabled",
            "-f",
            "matroska",
            output,
          ]
        : [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "/media/input.mkv",
            "-map",
            "0:a:0",
            "-vn",
            "-t",
            "14400.1",
            "-ac",
            "1",
            // Preserve the media clock, including leading silence and timestamp gaps.
            "-af",
            "highpass=f=150,lowpass=f=3500,aresample=8000:async=1:first_pts=0",
            "-ar",
            "8000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "s16le",
            output,
          ],
    );
    if (exitCode !== 0) {
      return err({ kind: "conversionFailed", detail: conversionDetail });
    }
    const data = await engine.readFile(output);
    if (typeof data === "string" || data.byteLength === 0) {
      return err({
        kind: "conversionFailed",
        detail: "The selected track produced no audio.",
      });
    }
    const buffer = data.buffer;
    if (!(buffer instanceof ArrayBuffer)) return err({ kind: "conversionFailed" });
    if (signal.aborted) return err({ kind: "cancelled" });
    report({ fraction: 1, message: "Local audio processing complete." });
    return ok(new Uint8Array(buffer, data.byteOffset, data.byteLength));
  } catch (cause) {
    return err({
      kind: signal.aborted ? "cancelled" : failure,
      detail: (conversionDetail || String(cause)).slice(-1200),
    });
  } finally {
    signal.removeEventListener("abort", cancel);
    engine.terminate();
  }
};
