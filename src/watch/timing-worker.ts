import { type CueTime, estimateSubtitleTiming } from "./timing-alignment.ts";

self.onmessage = (
  event: MessageEvent<{ activity: Float32Array; cues: readonly CueTime[] }>,
) => {
  self.postMessage(estimateSubtitleTiming(event.data.activity, event.data.cues));
};
