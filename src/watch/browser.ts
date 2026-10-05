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

type WatchModel = {
  videoUrl: string | null;
  videoName: string;
  audioUrl: string | null;
  audioReady: boolean;
  audioMuted: boolean;
  repairingAudio: boolean;
  repairFraction: number;
  repairMessage: string;
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
    videoUrl: null,
    videoName: "",
    audioUrl: null,
    audioReady: false,
    audioMuted: false,
    repairingAudio: false,
    repairFraction: 0,
    repairMessage: "",
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
  let repairController: AbortController | null = null;

  const cancelRepair = (): void => {
    repairController?.abort();
    repairController = null;
    model.repairingAudio = false;
    model.repairFraction = 0;
    model.repairMessage = "";
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
    root.querySelector<HTMLVideoElement>("video")?.pause();
    model.audioReady = false;
    model.audioMuted = false;
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
    const file = videoFile;
    const controller = new AbortController();
    repairController = controller;
    model.repairingAudio = true;
    model.repairMessage = "Loading the browser audio engine…";
    root.querySelector<HTMLVideoElement>("video")?.pause();
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
        loadAudio(result.value);
        return;
      }
      switch (result.error.kind) {
        case "cancelled":
          setMessage("Audio repair cancelled. You can try again.");
          return;
        case "engineUnavailable":
          setMessage(
            "The browser audio engine could not load. Try again or choose an extracted audio track below.",
            "error",
          );
          return;
        case "conversionFailed":
          setMessage(
            "The first audio track could not be converted. Try another audio track or a browser-compatible video.",
            "error",
          );
          return;
      }
    } catch {
      if (destroyed || repairController !== controller) return;
      cancelRepair();
      setMessage(
        "The browser audio engine could not load. Try again or choose an extracted audio track below.",
        "error",
      );
    }
  };

  const clearAudio = (): void => {
    root.querySelector<HTMLVideoElement>("video")?.pause();
    root.querySelector<HTMLAudioElement>("[data-watch-audio]")?.pause();
    playback.clearAudio();
    model.audioUrl = null;
    model.audioReady = false;
    model.audioMuted = false;
    const video = root.querySelector<HTMLVideoElement>("video");
    if (video !== null) video.muted = false;
    setMessage("Using the video’s original audio track.");
  };

  const chooseSubtitles = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) return;
    const version = ++subtitleVersion;
    invalidateCapture();
    draw();
    const parsed = await parseWatchSrt(new Uint8Array(await file.arrayBuffer()));
    if (destroyed || version !== subtitleVersion) return;
    if (!parsed.ok) {
      model.track = null;
      model.activeCues = [];
      setMessage(parsed.error.detail, "error");
      return;
    }
    model.track = parsed.value;
    const video = root.querySelector<HTMLVideoElement>("video");
    model.activeCues = playback.cuesAt(parsed.value.cues, video?.currentTime ?? 0);
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
    model.activeCues = playback.cuesAt(model.track?.cues ?? [], clock.currentTime);
    draw();
  };

  const onAudioReady = (event: Event): void => {
    if ((event.currentTarget as HTMLAudioElement).src !== model.audioUrl) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    audio.playbackRate = video.playbackRate;
    audio.volume = video.volume;
    audio.muted = model.audioMuted;
    model.audioReady = true;
    video.muted = true;
    syncAudio(true);
    setMessage("Firefox-compatible audio is ready. Press play.", "success");
  };

  const onAudioError = (event: Event): void => {
    if ((event.currentTarget as HTMLAudioElement).src !== model.audioUrl) return;
    clearAudio();
    setMessage(
      "This browser could not play the selected audio. Choose an Ogg/Opus file.",
      "error",
    );
  };

  const onVideoPlay = (): void => {
    if (!model.audioReady) return;
    const { video, audio } = audioElements();
    if (video === null || audio === null) return;
    syncAudio(true);
    if (!audio.paused) return;
    void audio.play().catch(() => {
      if (destroyed || video.paused || audioElements().audio !== audio) return;
      video.pause();
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
                <p>Convert the first audio track in this browser. The MKV stays unchanged and no media is uploaded.</p>
                <button type="button" ?disabled=${model.repairingAudio || model.audioReady}
                  @click=${() => void repairFirefoxAudio()}>${model.audioReady ? "Audio fixed" : model.repairingAudio ? "Repairing audio…" : "Fix audio in Firefox"}</button>
                ${
                  model.repairingAudio
                    ? html`
                  <progress aria-label="Audio repair progress" max="1" .value=${model.repairFraction}></progress>
                  <p>${model.repairMessage}</p>
                  <button type="button" class="secondary" @click=${() => {
                    cancelRepair();
                    setMessage("Audio repair cancelled. You can try again.");
                  }}>Cancel audio repair</button>
                `
                    : ""
                }
                <details>
                  <summary>Choose an existing audio track</summary>
                  <p>You can also extract audio on your computer with FFmpeg and choose the output here.</p>
                  <code>ffmpeg -i "input.mkv" -map 0:a:0 -vn -c:a libopus "audio.ogg"</code>
                  <label>
                    Choose repaired audio
                    <input type="file" accept="audio/*,.ogg,.opus,.m4a,.mp3,.wav" @change=${chooseAudio} />
                  </label>
                </details>
                <details>
                  <summary>Audio engine source and licences</summary>
                  <p><a href=${coreLicenseUrl}>FFmpeg core: GPL v2 or later</a> · <a href=${wrapperLicenseUrl}>Browser wrapper: MIT</a></p>
                  <p><a href="https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1">Core source and build recipe (0.12.10)</a> · <a href="https://github.com/ffmpegwasm/ffmpeg.wasm">Browser wrapper source</a></p>
                </details>
                ${
                  model.audioUrl === null
                    ? ""
                    : html`<div class="button-row">
                  <button type="button" class="secondary" @click=${clearAudio}>Use original audio</button>
                  <button type="button" class="secondary" ?disabled=${!model.audioReady} @click=${() => {
                    const audio = audioElements().audio;
                    if (audio === null) return;
                    model.audioMuted = !model.audioMuted;
                    audio.muted = model.audioMuted;
                    draw();
                  }}>${model.audioMuted ? "Unmute repaired audio" : "Mute repaired audio"}</button>
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
    cancelRepair();
    subtitleVersion += 1;
    captureVersion += 1;
    document.removeEventListener("keydown", keydown);
    playback.dispose();
  };
};
