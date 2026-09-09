# Phase 5 evidence and handoff

**Evidence date:** 2026-09-08  
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium  
**Result:** implementation complete inside the declared native-codec and strict-SRT envelope

## Executive result

The Watch page accepts a browser-local video and one Japanese SRT, renders the
active cues over the video stage, and keeps that overlay inside the HTML
full-screen element. Subtitle text remains selectable. Selection and ordinary
copy run no application action; only the exact configurable capture shortcut
calls the localhost Watch API.

The capture path analyzes the complete active cue, resolves inflected content
words, exposes ambiguity, and requires the learner to confirm the intended
meaning and a local sense label. Study—not Watch—then creates or reuses one
Vocabulary Card under the same staging and daily-admission rules as every other
Card.

## Behavior and privacy evidence

- Strict UTF-8 and BOM-labelled UTF-16 SRT decoding is bounded to 4 MiB, 20,000
  cues, and 4,096 characters per cue. Malformed, non-Japanese, and reversed-time
  cues fail as typed input errors.
- Cue activation has tested seek/boundary behavior. Episode and cue identities
  use the same content/neighbourhood derivation as Preparation rather than
  positional SRT indices.
- The browser journey copies `泳いだ` to the clipboard and observes zero Watch
  requests. `Ctrl+Shift+G` then resolves it as `泳ぐ`; the copy chord itself is
  rejected as a configurable capture shortcut.
- Full screen targets the stage containing both native video and the selectable
  overlay. The browser journey proves the subtitle remains visible while that
  stage is the document's full-screen element.
- Only the selected cue enters localhost resolution. Video and subtitle files
  are object URLs/local memory and never enter a request. Durable evidence keeps
  source/cue keys, selected surface, and offsets—not complete cue text, subtitle
  bytes, video, or audio.

## Atomicity and lifecycle evidence

Study schema 4 adds an operation ledger and deduplicated capture evidence. One
immediate SQLite transaction resolves both canonical Card identity and the
capture sense claim, creates the Card and progress when absent, records evidence
once, and adds a capture Staging Source only while the Card is staged. A forced
identity conflict or write failure rolls the transaction back through Study's
typed boundary.

An exact retry returns the original outcome after a response loss. A changed
retry under the same token or operation key is rejected. Repeating the capture
through a new resolution returns `existing`, preserves progress, and adds no
duplicate Card. Pending resolutions expire after ten minutes and live only in
bounded server memory.

The focused journey proves a captured Card starts staged and can enter Study
only through `studyQueue`. Existing active, known, or suspended Cards are never
reset by capture, and no capture has a direct admission or progress operation.

## Exact validation

Run from the repository root with the runtime declared in `package.json`:

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The final local run produced 135 passing tests and 6,193 assertions across 36
files, a successful Vite production build, seven passing Chromium journeys,
and a clean whitespace check.

## Known limits and deferrals

1. Playback uses the browser's native codec support. Phase 5 adds no
   transcoding, audio repair, ASS parsing, or automatic subtitle alignment.
2. IPADIC supplies morphology but no dictionary-grade sense identity. Meaning
   and the local sense label therefore require learner confirmation.
3. Watch captures Vocabulary Cards only; Grammar Card capture and passive
   encounter credit remain out of scope.
4. Paid-provider smoke, the broader grammar envelope, and repository licence
   remain external gates inherited from earlier phases. The private Kaishi path
   was resolved after this phase without committing its content.

## Phase 6 handoff

Migration must enter through Study operations or an equally invariant-preserving
import boundary. It may preserve legitimate Cards, schedules, reviews, and
opaque provenance, but it cannot infer learning from subtitle evidence, create
a second schedule, or treat a spelling match as a vocabulary-sense match. A
cutover is not safe until backup/restore and real-data dry-run reports prove the
mapping is honest and repeatable.
