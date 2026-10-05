import { html, type TemplateResult } from "lit-html";
import { live } from "lit-html/directives/live.js";
import type { SubtitleTiming } from "./timing.ts";

export type TimingControlsModel = {
  timing: SubtitleTiming;
  analyzing: boolean;
  analysisMessage: string;
  analysisDetail: string;
  analysisFraction: number;
};

export const subtitleTimingControls = (
  model: TimingControlsModel,
  available: boolean,
  hasTrack: boolean,
  actions: Readonly<{
    analyze: () => void;
    cancel: () => void;
    change: (timing: SubtitleTiming) => void;
    download: () => void;
  }>,
): TemplateResult => html`<section aria-label="Subtitle timing">
  <h2>Subtitle timing</h2>
  <p>Match subtitle timings to audio in this browser. Japanese and Japanesified subtitles work the same way when their original cue timings match.</p>
  <button type="button" ?disabled=${!available || model.analyzing} @click=${actions.analyze}>${model.analyzing ? "Analyzing subtitle timing…" : "Analyze subtitle timing"}</button>
  ${
    model.analyzing
      ? html`
    <progress aria-label="Subtitle analysis progress" max="1" .value=${model.analysisFraction}></progress>
    <button type="button" class="secondary" @click=${actions.cancel}>Cancel subtitle analysis</button>`
      : ""
  }
  <p data-subtitle-timing-status aria-live="polite">${model.analysisMessage}</p>
  ${model.analysisDetail === "" ? "" : html`<details><summary>Subtitle analysis details</summary><p>${model.analysisDetail}</p></details>`}
  <label>Subtitle offset (seconds)
    <input type="number" min="-600" max="600" step="0.1" .value=${live(String(model.timing.offsetSeconds))}
      @change=${(event: Event) => actions.change({ ...model.timing, offsetSeconds: (event.currentTarget as HTMLInputElement).valueAsNumber })} />
  </label>
  <p>Positive shows subtitles later; negative shows them earlier.</p>
  <div class="button-row">
    <button type="button" class="secondary" @click=${() => actions.change({ ...model.timing, offsetSeconds: Math.round((model.timing.offsetSeconds - 0.1) * 100) / 100 })}>Earlier 0.1s</button>
    <button type="button" class="secondary" @click=${() => actions.change({ ...model.timing, offsetSeconds: Math.round((model.timing.offsetSeconds + 0.1) * 100) / 100 })}>Later 0.1s</button>
  </div>
  <label>Subtitle timing scale
    <input type="number" min="0.9" max="1.1" step="0.000001" .value=${live(String(model.timing.scale))}
      @change=${(event: Event) => actions.change({ ...model.timing, scale: (event.currentTarget as HTMLInputElement).valueAsNumber })} />
  </label>
  <p>Keep 1 unless subtitles gradually drift. Changing to a subtitle file with the same cue timings keeps this correction; a different timeline resets it.</p>
  <div class="button-row">
    <button type="button" class="secondary" @click=${() => actions.change({ offsetSeconds: 0, scale: 1 })}>Reset subtitle timing</button>
    <button type="button" class="secondary" ?disabled=${!hasTrack} @click=${actions.download}>Download corrected SRT</button>
  </div>
</section>`;
