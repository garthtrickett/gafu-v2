# Watch subtitle timing — 2026-10-05

## Requirement and implementation

The owner reported missing V1-style audio/subtitle alignment in V2 and asked
whether Japanesified English needed a separate manual correction. V1 behavior
compares audio activity with cue times, independent of words. V2 independently
implements that behavior, with no legacy code reuse or new dependencies.

Watch now owns browser-local audio analysis, bounded offset/FPS drift fitting,
manual timing correction, matching-timeline language switching, and corrected
SRT export. Original cue identities and capture timestamps remain unchanged
while playback uses an inverse timing transform. Study, Preparation, persistence,
and SRS are unchanged. The contract and limits are in Phase 5's timing follow-up.

## Validation

In the dedicated `codex/subtitle-timing` worktree:

- `bun run check` — pass.
- `bun test` — 458 pass, zero fail; five new timing tests.
- `bun run build` — pass, timing search emitted as a separate worker.
- `bun run test:browser` — 43 pass, zero fail; Chromium, Firefox, and mobile
  Chromium. Six new timing journeys.
- `git diff --check` — pass.

Pure tests recover +3.7s at scale 1.001 and -4.2s at scale 25/24, reject silent
and ambiguous periodic activity, handle offset PCM views/little endian, preserve
kana-containing translated text on export, and retain content-derived keys.

A synthetic 80-second VP8/Vorbis video contains sixteen irregular 440 Hz bursts.
Subtitles are deliberately 3.3 seconds early. Each browser runs the actual WASM
decoder and timing worker, finds the offset within 0.3s, keeps it on identical
Japanesified cue boundaries, checks adjusted subtitle playback, edits timing,
downloads sixteen corrected cues, resets for a different timeline, and records
zero non-GET requests. Cancellation during lazy loading can retry; insufficient
signal keeps a manually chosen offset. Existing MKV repair and capture journeys
remain green, including independent stereo channel playback.

This establishes the pipeline and timing rules on authored fixtures. Natural
soundtracks with music or scene edits may need manual adjustment; a single
offset/scale cannot repair inserted/deleted scenes. The analyzer does not
recognize words, so translations must preserve original cue boundaries.
