import { html, render } from "lit-html";
import { live } from "lit-html/directives/live.js";
import coreLicenseUrl from "../../licenses/ffmpeg-core-gpl-2.0.txt?url";
import wrapperLicenseUrl from "../../licenses/ffmpeg-wrapper-mit.txt?url";
import { mutationHeaders } from "../local-api.ts";
import type {
  CaptureCandidate,
  CaptureOutcome,
  CaptureResolution,
  ResolveCapture,
} from "./contracts.ts";
import { createLocalPlayback } from "./playback.ts";
import {
  type CaptureShortcut,
  defaultCaptureShortcut,
  isValidCaptureShortcut,
  matchesCaptureShortcut,
  shortcutFromKeyboardEvent,
  shortcutLabel,
} from "./shortcut.ts";
import { parseWatchSrt, type WatchCue, type WatchSubtitleTrack } from "./subtitles.ts";

type CaptureModel = Readonly<{
  resolution: CaptureResolution;
  candidateKey: string;
  meaning: string;
  senseId: string;
  operationKey: string;
}>;

import {
  correctedSrt,
  originalTiming,
  type SubtitleTiming,
  sameSubtitleTimes,
  subtitleTime,
  validSubtitleTiming,
} from "./timing.ts";
import { subtitleTimingControls, type TimingControlsModel } from "./timing-controls.ts";

type WatchModel = TimingControlsModel & {
  videoUrl: string | null;
  videoName: string;
  audioUrl: string | null;
  audioReady: boolean;
  audioMuted: boolean;
  repairingAudio: boolean;
  repairFraction: number;
  repairMessage: string;
  repairDetail: string;
  track: WatchSubtitleTrack | null;
  activeCues: readonly WatchCue[];
  shortcut: CaptureShortcut;
  recordingShortcut: boolean;
  capture: CaptureModel | null;
  busy: boolean;
  message: string;
  messageKind: "neutral" | "success" | "error";
};

type ApiError = Readonly<{ error?: { kind?: string; detail?: string } }>;

const shortcutStorageKey = "gafu-v2-watch-capture-shortcut";

const requestJson = async <Value>(url: string, value: unknown): Promise<Value> => {
  const response = await fetch(url, {
    method: "POST",
    headers: mutationHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(value),
  });
  const body = (await response.json()) as Value | ApiError;
  if (!response.ok) {
    const failure = body as ApiError;
    throw new Error(failure.error?.detail ?? failure.error?.kind ?? "requestFailed");
  }
  return body as Value;
};

const readShortcut = (): CaptureShortcut => {
  const fallback = defaultCaptureShortcut(navigator.platform);
  try {
    const value = JSON.parse(
      localStorage.getItem(shortcutStorageKey) ?? "null",
    ) as CaptureShortcut | null;
    return value !== null && isValidCaptureShortcut(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const enclosingCue = (node: Node | null): HTMLElement | null => {
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-cue-key]") ?? null;
};

const selectedCueSpan = (): Readonly<{
  cue: HTMLElement;
  start: number;
  end: number;
  surface: string;
}> | null => {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount !== 1 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startCue = enclosingCue(range.startContainer);
  const endCue = enclosingCue(range.endContainer);
  if (startCue === null || startCue !== endCue) return null;
  const beforeStart = document.createRange();
  beforeStart.selectNodeContents(startCue);
  beforeStart.setEnd(range.startContainer, range.startOffset);
  const beforeEnd = document.createRange();
  beforeEnd.selectNodeContents(startCue);
  beforeEnd.setEnd(range.endContainer, range.endOffset);
  const start = beforeStart.toString().length;
  const end = beforeEnd.toString().length;
  const surface = range.toString();
  return start < end && startCue.textContent?.slice(start, end) === surface
    ? { cue: startCue, start, end, surface }
    : null;
};

const editableTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof HTMLElement ? target : null;
  return (
    element !== null &&
    (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName))
  );
};

export const mountWatchApp = (root: HTMLElement): (() => void) => {
  const playback = createLocalPlayback({
    create: (file) => URL.createObjectURL(file),
    revoke: (url) => URL.revokeObjectURL(url),
  });
  const model: WatchModel = {
    timing: originalTiming,
    analyzing: false,
    analysisMessage:
      "Choose a video and subtitles to analyze their timing. No media is uploaded.",
    analysisDetail: "",
    analysisFraction: 0,
    videoUrl: null,
    videoName: "",
    audioUrl: null,
    audioReady: false,
    audioMuted: false,
    repairingAudio: false,
    repairFraction: 0,
    repairMessage: "",
    repairDetail: "",
    track: null,
    activeCues: [],
    shortcut: readShortcut(),
    recordingShortcut: false,
    capture: null,
    busy: false,
    message: "Choose one local video and its Japanese SRT subtitles.",
    messageKind: "neutral",
  };
  let subtitleVersion = 0;
  let captureVersion = 0;
  let destroyed = false;
  let videoFile: File | null = null;
  let audioFile: File | null = null;
  let subtitleName = "subtitles.srt";
  let analysisController: AbortController | null = null;
  const cancelAnalysis = (): void => {
    analysisController?.abort();
    analysisController = null;
    model.analyzing = false;
  };
  let repairController: AbortController | null = null;
  let usingRepairedVideo = false;
  let pendingVideoTime: number | null = null;

  const cancelRepair = (): void => {
    repairController?.abort();
    repairController = null;
    model.repairingAudio = false;
    model.repairFraction = 0;
    model.repairMessage = "";
    model.repairDetail = "";
  };

  const invalidateCapture = (): void => {
    captureVersion += 1;
    model.capture = null;
    model.busy = false;
  };

  const setMessage = (
    message: string,
    kind: WatchModel["messageKind"] = "neutral",
  ): void => {
    model.message = message;
    model.messageKind = kind;
    draw();
  };

  const chooseVideo = (event: Event): void => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    cancelRepair();
    cancelAnalysis();
    model.timing = originalTiming;
    model.analysisMessage = "New video loaded. Subtitle timing reset.";
    model.analysisDetail = "";
    audioFile = null;
    usingRepairedVideo = false;
    pendingVideoTime = null;
    videoFile = file;
    const previousVideo = root.querySelector<HTMLVideoElement>("video");
    previousVideo?.pause();
    model.audioReady = false;
    model.audioUrl = null;
    if (previousVideo !== null && previousVideo !== undefined)
      previousVideo.muted = false;
    const selected = playback.replaceVideo(file);
    model.videoUrl = selected.url;
    model.videoName = selected.name;
    model.audioMuted = false;
    invalidateCapture();
    model.activeCues = playback.cuesAt(model.track?.cues ?? [], 0);
    setMessage(`Loaded ${file.name} locally. No media bytes were uploaded.`, "success");
  };

  const loadAudio = (file: File): void => {
    cancelAnalysis();
    audioFile = file;
    root.querySelector<HTMLVideoElement>("video")?.pause();
    model.audioReady = false;
    model.audioMuted = false;
    model.repairMessage = "Loading the converted audio…";
    model.repairDetail = "";
    model.audioUrl = playback.replaceAudio(file);
    setMessage(`Loaded ${file.name} locally. Waiting for its audio track.`, "neutral");
  };

  const chooseAudio = (event: Event): void => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file === undefined || model.videoUrl === null) return;
    cancelRepair();
    loadAudio(file);
  };

  const repairFirefoxAudio = async (): Promise<void> => {
    if (videoFile === null || model.repairingAudio || model.audioReady) return;
    cancelAnalysis();
    const file = videoFile;
    const controller = new AbortController();
    repairController = controller;
    model.repairingAudio = true;
    model.repairMessage = "Loading the browser audio engine…";
    const video = root.querySelector<HTMLVideoElement>("video");
    const position = video?.currentTime ?? 0;
    video?.pause();
    draw();
    try {
      const { repairBrowserAudio } = await import("./audio-repair.ts");
      const result = await repairBrowserAudio(file, controller.signal, (progress) => {
        if (destroyed || repairController !== controller) return;
        model.repairFraction = progress.fraction;
        model.repairMessage = progress.message;
        draw();
      });
      if (destroyed || repairController !== controller) return;
      cancelRepair();
      if (result.ok) {
        model.audioReady = false;
        model.audioUrl = null;
        if (video !== null) video.muted = false;
        model.videoUrl = playback.replaceVideo(result.value).url;
        usingRepairedVideo = true;
        pendingVideoTime = position;
        model.repairMessage = "Loading the repaired video…";
        setMessage("Audio repaired locally. Waiting for the playable video copy.");
        return;
      }
      model.repairDetail = result.error.detail ?? "";
      switch (result.error.kind) {
        case "cancelled":
          setMessage("Audio repair cancelled. You can try again.");
          return;
        case "engineUnavailable":
          model.repairMessage =
            "The audio engine could not load. Try again or choose an extracted audio track.";
          setMessage(
            "The browser audio engine could not load. Try again or choose an extracted audio track below.",
            "error",
          );
          return;
        case "conversionFailed":
          model.repairMessage =
            "Audio conversion failed. See the repair details below.";
          setMessage(
            "The first audio track could not be converted. Try another audio track or a browser-compatible video.",
            "error",
          );
          return;
      }
    } catch (cause) {
      if (destroyed || repairController !== controller) return;
      cancelRepair();
      model.repairMessage =
        "The audio engine could not load. Try again or choose an extracted audio track.";
      model.repairDetail = String(cause).slice(-1200);
      setMessage(
        "The browser audio engine could not load. Try again or choose an extracted audio track below.",
        "error",
      );
    }
  };

  const clearAudio = (): void => {
    cancelAnalysis();
    audioFile = null;
    const previousVideo = root.querySelector<HTMLVideoElement>("video");
    const position = previousVideo?.currentTime ?? 0;
    previousVideo?.pause();
    root.querySelector<HTMLAudioElement>("[data-watch-audio]")?.pause();
    playback.clearAudio();
    model.audioUrl = null;
    model.audioReady = false;
    model.audioMuted = false;
    model.repairMessage = "";
    model.repairDetail = "";
    if (usingRepairedVideo && videoFile !== null) {
      model.videoUrl = playback.replaceVideo(videoFile).url;
      usingRepairedVideo = false;
      pendingVideoTime = position;
    }
    const video = root.querySelector<HTMLVideoElement>("video");
    if (video !== null) video.muted = false;
    setMessage("Using the video’s original audio track.");
  };

  const chooseSubtitles = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    cancelAnalysis();
    const version = ++subtitleVersion;
    invalidateCapture();
    draw();
    const parsed = await parseWatchSrt(new Uint8Array(await file.arrayBuffer()));
    if (destroyed || version !== subtitleVersion) return;
    if (!parsed.ok) {
      model.track = null;
      model.timing = originalTiming;
      model.activeCues = [];
      setMessage(parsed.error.detail, "error");
      return;
    }
    const keepTiming =
      model.track !== null && sameSubtitleTimes(model.track.cues, parsed.value.cues);
    if (!keepTiming) model.timing = originalTiming;
    model.analysisMessage = keepTiming
      ? "Matching cue timings: kept the current subtitle correction."
      : "Subtitles loaded. Timing reset for this timeline.";
    model.analysisDetail = "";
    subtitleName = file.name;
    model.track = parsed.value;
    const video = root.querySelector<HTMLVideoElement>("video");
    model.activeCues = playback.cuesAt(
      parsed.value.cues,
      subtitleTime(video?.currentTime ?? 0, model.timing),
    );
    setMessage(
      `Loaded ${parsed.value.cues.length} local subtitle cues. Select text or copy normally.`,
      "success",
    );
  };

  const audioElements = (): Readonly<{
    video: HTMLVideoElement | null;
    audio: HTMLAudioElement | null;
  }> => ({
    video: root.querySelector<HTMLVideoElement>("video"),
    audio: root.querySelector<HTMLAudioElement>("[data-watch-audio]"),
  });

  const syncAudio = (force = false): void => {
    if (!model.audioReady) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    if (Math.abs(audio.currentTime - video.currentTime) > (force ? 0.05 : 0.3)) {
      audio.currentTime = video.currentTime;
    }
  };

  const updateCues = (): void => {
    const { video, audio } = audioElements();
    if (video === null) return;
    syncAudio();
    const clock = model.audioReady && audio !== null ? audio : video;
    model.activeCues = playback.cuesAt(
      model.track?.cues ?? [],
      subtitleTime(clock.currentTime, model.timing),
    );
    draw();
  };

  const changeTiming = (timing: SubtitleTiming): void => {
    cancelAnalysis();
    if (!validSubtitleTiming(timing)) {
      model.analysisMessage =
        "Use a finite offset within ten minutes and a timing scale between 0.9 and 1.1.";
      draw();
      return;
    }
    model.timing = timing;
    model.analysisMessage =
      "Subtitle timing updated. The original file stays unchanged.";
    model.analysisDetail = "";
    invalidateCapture();
    if (model.videoUrl === null)
      model.activeCues = playback.cuesAt(
        model.track?.cues ?? [],
        subtitleTime(0, timing),
      );
    updateCues();
    draw();
  };

  const analyzeTiming = async (): Promise<void> => {
    const track = model.track;
    const file = audioFile ?? videoFile;
    if (track === null || file === null || model.analyzing) return;
    cancelRepair();
    const controller = new AbortController();
    analysisController = controller;
    model.analyzing = true;
    model.analysisFraction = 0;
    model.analysisDetail = "";
    model.analysisMessage = "Loading local audio analysis…";
    draw();
    try {
      const { analyzeSubtitleTiming } = await import("./audio-analysis.ts");
      const result = await analyzeSubtitleTiming(
        file,
        track.cues,
        controller.signal,
        (progress) => {
          if (destroyed || analysisController !== controller) return;
          model.analysisFraction = progress.fraction;
          model.analysisMessage = progress.message;
          draw();
        },
      );
      if (destroyed || analysisController !== controller) return;
      cancelAnalysis();
      if (result.ok) {
        if (result.value.reliable) {
          model.timing = result.value.timing;
          invalidateCapture();
          model.analysisMessage = `Timing applied: ${model.timing.offsetSeconds.toFixed(2)}s offset, scale ${model.timing.scale}. Check a dialogue scene and adjust if needed.`;
          updateCues();
        } else {
          model.analysisMessage =
            "No clear timing match. Your current correction is unchanged; use the manual offset.";
        }
      } else {
        model.analysisDetail = result.error.detail ?? "";
        switch (result.error.kind) {
          case "cancelled":
            model.analysisMessage = "Subtitle analysis cancelled. You can try again.";
            break;
          case "engineUnavailable":
            model.analysisMessage =
              "The local audio engine could not load. Try again or use the manual offset.";
            break;
          case "conversionFailed":
            model.analysisMessage =
              "The audio track could not be analyzed. Use the manual offset or choose an extracted audio track.";
            break;
          case "insufficientSignal":
            model.analysisMessage = result.error.detail;
            break;
        }
      }
      draw();
    } catch (cause) {
      if (destroyed || analysisController !== controller) return;
      cancelAnalysis();
      model.analysisMessage =
        "Subtitle analysis could not start. Try again or use the manual offset.";
      model.analysisDetail = String(cause).slice(-1200);
      draw();
    }
  };

  const downloadSubtitles = (): void => {
    if (model.track === null) return;
    const exported = correctedSrt(model.track, model.timing);
    if (!exported.ok) {
      model.analysisMessage = exported.error.detail;
      draw();
      return;
    }
    const url = URL.createObjectURL(
      new Blob([exported.value], { type: "application/x-subrip;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${subtitleName.replace(/\.srt$/iu, "")}-aligned.srt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onAudioReady = (event: Event): void => {
    if ((event.currentTarget as HTMLAudioElement).src !== model.audioUrl) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    audio.playbackRate = video.playbackRate;
    audio.volume = video.volume;
    audio.muted = model.audioMuted;
    model.audioReady = true;
    model.repairMessage = "Audio converted. Press play on the video to hear it.";
    video.muted = true;
    syncAudio(true);
    setMessage("Firefox-compatible audio is ready. Press play.", "success");
  };

  const onAudioError = (event: Event): void => {
    const audio = event.currentTarget as HTMLAudioElement;
    if (audio.src !== model.audioUrl) return;
    const detail =
      audio.error?.message || `Media error ${audio.error?.code ?? "unknown"}`;
    clearAudio();
    model.repairMessage =
      "Firefox could not play the audio. See the repair details below.";
    model.repairDetail = detail.slice(-1200);
    setMessage(
      "This browser could not play the selected audio. Choose an Ogg audio file.",
      "error",
    );
  };

  const onVideoPlay = (): void => {
    if (!model.audioReady) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    syncAudio(true);
    if (!audio.paused) return;
    void audio.play().catch((cause: unknown) => {
      if (destroyed || video.paused || audioElements().audio !== audio) return;
      video.pause();
      model.repairMessage = "Firefox could not start the audio. Press play again.";
      model.repairDetail = String(cause).slice(-1200);
      setMessage(
        "Firefox could not start the repaired audio. Press play again.",
        "error",
      );
    });
  };

  const onVideoVolumeChange = (): void => {
    if (!model.audioReady) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    audio.volume = video.volume;
    if (!video.muted) video.muted = true;
  };

  const resolveSelection = async (
    selected: ReturnType<typeof selectedCueSpan> = selectedCueSpan(),
  ): Promise<void> => {
    const track = model.track;
    const cueKey = selected?.cue.dataset["cueKey"];
    const cue = track?.cues.find((item) => item.cueKey === cueKey);
    if (selected === null || track === null || cue === undefined) {
      setMessage("Select one Japanese span inside a single active cue first.", "error");
      return;
    }
    const command: ResolveCapture = {
      sourceVersion: "watch-source-v1",
      episodeKey: track.episodeKey,
      cueKey: cue.cueKey,
      cueStartMs: cue.startMs,
      cueEndMs: cue.endMs,
      cueText: cue.text,
      selectedSurface: selected.surface,
      selectedSpan: { start: selected.start, end: selected.end },
    };
    const version = ++captureVersion;
    model.busy = true;
    draw();
    try {
      const resolution = await requestJson<CaptureResolution>(
        "/api/watch/capture/resolve",
        command,
      );
      if (destroyed || version !== captureVersion) return;
      const candidate = resolution.candidates[0];
      if (candidate === undefined) throw new Error("noContentCandidate");
      model.capture = {
        resolution,
        candidateKey: candidate.key,
        meaning: "",
        senseId: candidate.suggestedSenseId,
        operationKey: crypto.randomUUID(),
      };
      model.message =
        resolution.candidates.length === 1
          ? "Confirm this word's meaning before adding it."
          : "The selection has multiple words. Choose the intended one and confirm its meaning.";
      model.messageKind = "neutral";
    } catch (cause) {
      if (destroyed || version !== captureVersion) return;
      model.capture = null;
      model.message = cause instanceof Error ? cause.message : String(cause);
      model.messageKind = "error";
    } finally {
      if (!destroyed && version === captureVersion) {
        model.busy = false;
        draw();
      }
    }
  };

  const selectCandidate = (candidate: CaptureCandidate): void => {
    if (model.capture === null) return;
    model.capture = {
      ...model.capture,
      candidateKey: candidate.key,
      meaning: "",
      senseId: candidate.suggestedSenseId,
    };
    draw();
  };

  const commitCapture = (event: SubmitEvent): void => {
    event.preventDefault();
    const capture = model.capture;
    if (capture === null) return;
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    model.capture = {
      ...capture,
      meaning: String(fields.get("meaning") ?? ""),
      senseId: String(fields.get("senseId") ?? ""),
    };
    const version = ++captureVersion;
    model.busy = true;
    draw();
    void requestJson<CaptureOutcome>("/api/watch/capture/commit", {
      token: capture.resolution.token,
      candidateKey: capture.candidateKey,
      meaning: model.capture.meaning,
      senseId: model.capture.senseId,
      operationKey: capture.operationKey,
    })
      .then((outcome) => {
        if (destroyed || version !== captureVersion) return;
        model.capture = null;
        model.message =
          outcome.outcome === "created"
            ? `${outcome.lemma} was staged under your shared daily limit.`
            : `${outcome.lemma} already exists; its progress was kept.`;
        model.messageKind = "success";
      })
      .catch((cause: unknown) => {
        if (destroyed || version !== captureVersion) return;
        model.message = cause instanceof Error ? cause.message : String(cause);
        model.messageKind = "error";
      })
      .finally(() => {
        if (destroyed || version !== captureVersion) return;
        model.busy = false;
        draw();
      });
  };

  const keydown = (event: KeyboardEvent): void => {
    if (model.recordingShortcut) {
      event.preventDefault();
      const next = shortcutFromKeyboardEvent(event);
      if (!isValidCaptureShortcut(next)) {
        setMessage(
          "Use a letter or number with Ctrl, Cmd, or Alt. Native copy cannot be replaced.",
          "error",
        );
        return;
      }
      model.shortcut = next;
      model.recordingShortcut = false;
      localStorage.setItem(shortcutStorageKey, JSON.stringify(next));
      setMessage(`Capture shortcut changed to ${shortcutLabel(next)}.`, "success");
      return;
    }
    if (
      !editableTarget(event.target) &&
      matchesCaptureShortcut(event, model.shortcut)
    ) {
      const selected = selectedCueSpan();
      if (
        selected === null ||
        !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(
          selected.surface,
        )
      ) {
        setMessage(
          "Select one Japanese span inside a single active cue first.",
          "error",
        );
        return;
      }
      event.preventDefault();
      void resolveSelection(selected);
    }
  };

  const fullscreen = (): void => {
    const stage = root.querySelector<HTMLElement>("[data-testid=watch-stage]");
    if (stage === null) return;
    void stage.requestFullscreen().catch(() => {
      setMessage("This browser did not allow full screen.", "error");
    });
  };

  const draw = (): void => {
    const capture = model.capture;
    render(
      html`<main class="study-shell watch-shell">
        <header class="hero">
          <div>
            <p class="eyebrow">Gafu V2 · Watch</p>
            <h1>Watch locally. Capture deliberately.</h1>
            <p class="lede">
              Your video and subtitle files stay in this browser. Only the selected cue is
              sent to Gafu's local analyzer when you use the capture shortcut.
            </p>
          </div>
          <div class="button-row">
            <a class="secondary button-link" href="?view=prepare">Prepare</a>
            <a class="secondary button-link" href="/">Study</a>
          </div>
        </header>

        <p class="notice notice--${model.messageKind}" role="status">${model.message}</p>

        <section class="watch-grid">
          <div class="watch-main">
            <div class="watch-stage" data-testid="watch-stage">
              ${
                model.videoUrl === null
                  ? html`<div class="watch-placeholder">Choose a local video to begin playback.</div>`
                  : html`<video
                      controls
                      .src=${model.videoUrl}
                      aria-label=${model.videoName}
                      @loadedmetadata=${() => {
                        const video = audioElements().video;
                        if (video !== null && pendingVideoTime !== null) {
                          video.currentTime = pendingVideoTime;
                          pendingVideoTime = null;
                          syncAudio(true);
                        }
                        if (usingRepairedVideo && model.audioUrl === null) {
                          model.audioReady = true;
                          model.repairMessage =
                            "Audio repaired. Press play on the video to hear it.";
                          setMessage(
                            "Firefox-compatible audio is ready. Press play.",
                            "success",
                          );
                        }
                      }}
                      @play=${onVideoPlay}
                      @playing=${onVideoPlay}
                      @waiting=${() => audioElements().audio?.pause()}
                      @pause=${() => audioElements().audio?.pause()}
                      @seeking=${() => syncAudio(true)}
                      @ratechange=${() => {
                        const { video, audio } = audioElements();
                        if (video !== null && audio !== null)
                          audio.playbackRate = video.playbackRate;
                      }}
                      @volumechange=${onVideoVolumeChange}
                      @timeupdate=${updateCues}
                      @seeked=${updateCues}
                      @ended=${() => audioElements().audio?.pause()}
                      @error=${() =>
                        setMessage(
                          "This browser cannot play that file. Try an MP4 (H.264/AAC) or WebM file.",
                          "error",
                        )}
                    ></video>`
              }
              ${
                model.audioUrl === null
                  ? ""
                  : html`<audio
                data-watch-audio
                hidden
                preload="auto"
                .src=${model.audioUrl}
                @loadedmetadata=${onAudioReady}
                @error=${onAudioError}
                @timeupdate=${updateCues}
              ></audio>`
              }
              <div class="subtitle-overlay" aria-live="off">
                ${model.activeCues.map(
                  (cue) =>
                    html`<p lang="ja" data-cue-key=${cue.cueKey}>${cue.text}</p>`,
                )}
              </div>
            </div>
            <button type="button" class="secondary" @click=${fullscreen}>Full screen player</button>
          </div>

          <aside class="panel watch-controls">
            <h2>Local files</h2>
            <label>
              Choose video
              <input type="file" accept="video/mp4,video/webm,video/x-matroska,.mp4,.webm,.mkv" @change=${chooseVideo} />
            </label>
            ${
              model.videoName.toLowerCase().endsWith(".mkv")
                ? html`
              <div>
                <h3>Silent MKV in Firefox?</h3>
                <p>Repair the first audio track and prepare a playable video copy in this browser. The MKV stays unchanged and no media is uploaded.</p>
                <button type="button" ?disabled=${model.repairingAudio || model.audioReady || model.analyzing}
                  @click=${() => void repairFirefoxAudio()}>${model.audioReady ? "Audio fixed" : model.repairingAudio ? "Repairing audio…" : "Fix audio in Firefox"}</button>
                ${
                  model.repairingAudio
                    ? html`
                  <progress aria-label="Audio repair progress" max="1" .value=${model.repairFraction}></progress>
                  <button type="button" class="secondary" @click=${() => {
                    cancelRepair();
                    setMessage("Audio repair cancelled. You can try again.");
                  }}>Cancel audio repair</button>
                `
                    : ""
                }
                ${model.repairMessage === "" ? "" : html`<p data-audio-repair-status aria-live="polite">${model.repairMessage}</p>`}
                ${
                  model.repairDetail === ""
                    ? ""
                    : html`<details>
                  <summary>Audio repair details</summary>
                  <p>${model.repairDetail}</p>
                </details>`
                }
                <details>
                  <summary>Choose an existing audio track</summary>
                  <p>You can also repair the file on your computer with FFmpeg, then select repaired.mkv with Choose video above.</p>
                  <code>ffmpeg -i "input.mkv" -map 0:v:0 -map 0:a:0 -c:v copy -c:a libvorbis "repaired.mkv"</code>
                  <p>If you already have a separate audio track, choose it below.</p>
                  <label>
                    Choose repaired audio
                    <input type="file" accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav" @change=${chooseAudio} />
                  </label>
                </details>

                ${
                  model.audioUrl === null && !usingRepairedVideo
                    ? ""
                    : html`<div class="button-row">
                  <button type="button" class="secondary" @click=${clearAudio}>Use original audio</button>
                  ${
                    model.audioUrl === null
                      ? ""
                      : html`
                  <button type="button" class="secondary" ?disabled=${!model.audioReady} @click=${() => {
                    const audio = audioElements().audio;
                    if (audio === null) return;
                    model.audioMuted = !model.audioMuted;
                    audio.muted = model.audioMuted;
                    draw();
                  }}>${model.audioMuted ? "Unmute repaired audio" : "Mute repaired audio"}</button>
                  `
                  }
                </div>`
                }
              </div>
            `
                : ""
            }
            <label>
              Choose Japanese SRT
              <input type="file" accept=".srt,application/x-subrip" @change=${chooseSubtitles} />
            </label>
            <hr />
            ${subtitleTimingControls(
              model,
              model.track !== null && videoFile !== null && !model.repairingAudio,
              model.track !== null,
              {
                analyze: () => void analyzeTiming(),
                cancel: () => {
                  cancelAnalysis();
                  model.analysisMessage =
                    "Subtitle analysis cancelled. You can try again.";
                  draw();
                },
                change: changeTiming,
                download: downloadSubtitles,
              },
            )}
                <details>
                  <summary>Player source and licences</summary>
                  <p><a href=${coreLicenseUrl}>FFmpeg core: GPL v2 or later</a> · <a href=${wrapperLicenseUrl}>Browser wrapper: MIT</a></p>
                  <p><a href="https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1">Core source and build recipe (0.12.10)</a> · <a href="https://github.com/ffmpegwasm/ffmpeg.wasm">Browser wrapper source</a></p>
                  <p><a href=${new URL("./fonts/OFL.txt", import.meta.url).href}>Noto subtitle font licence (SIL OFL 1.1)</a></p>
                </details>
            <hr />
            <h2>Capture one word</h2>
            <p>
              Highlight subtitle text, then press
              <kbd>${shortcutLabel(model.shortcut)}</kbd>. Highlighting and Ctrl/Cmd+C stay
              native and do nothing else.
            </p>
            <button
              type="button"
              class="secondary"
              @click=${() => {
                model.recordingShortcut = true;
                setMessage("Press the new capture chord now.");
              }}
            >${model.recordingShortcut ? "Waiting for shortcut…" : "Change shortcut"}</button>
            <button
              type="button"
              class="secondary"
              @click=${() => {
                model.shortcut = defaultCaptureShortcut(navigator.platform);
                localStorage.removeItem(shortcutStorageKey);
                setMessage(
                  `Capture shortcut reset to ${shortcutLabel(model.shortcut)}.`,
                  "success",
                );
              }}
            >Reset shortcut</button>
          </aside>
        </section>

        ${
          capture === null
            ? ""
            : html`<section class="panel capture-panel" data-testid="capture-panel">
                <h2>Confirm Vocabulary Card</h2>
                <p>
                  Selected: <strong lang="ja">${capture.resolution.selectedSurface}</strong>
                </p>
                <fieldset>
                  <legend>Which word did you mean?</legend>
                  ${capture.resolution.candidates.map(
                    (candidate) => html`<label class="candidate-choice">
                      <input
                        type="radio"
                        name="candidate"
                        .checked=${candidate.key === capture.candidateKey}
                        @change=${() => selectCandidate(candidate)}
                      />
                      <span lang="ja">${candidate.lemma}</span>
                      <span>${candidate.reading} · ${candidate.partOfSpeech}</span>
                    </label>`,
                  )}
                </fieldset>
                <form @submit=${commitCapture}>
                  <label>
                    Meaning you intend to learn
                    <input
                      name="meaning"
                      required
                      maxlength="500"
                      .value=${live(capture.meaning)}
                    />
                  </label>
                  <label>
                    Local sense label
                    <input
                      name="senseId"
                      required
                      maxlength="200"
                      .value=${live(capture.senseId)}
                    />
                  </label>
                  <div class="button-row">
                    <button type="submit" ?disabled=${model.busy}>Add to SRS</button>
                    <button
                      type="button"
                      class="secondary"
                      @click=${() => {
                        invalidateCapture();
                        setMessage(
                          "Capture dismissed. Playback and selection were unchanged.",
                        );
                      }}
                    >Cancel</button>
                  </div>
                </form>
              </section>`
        }
      </main>`,
      root,
    );
  };

  document.addEventListener("keydown", keydown);
  draw();
  return () => {
    destroyed = true;
    cancelAnalysis();
    cancelRepair();
    subtitleVersion += 1;
    captureVersion += 1;
    document.removeEventListener("keydown", keydown);
    playback.dispose();
  };
};
