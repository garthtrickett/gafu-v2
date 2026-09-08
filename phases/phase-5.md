# Phase 5 — Watch and Subtitle Capture

**Status:** Refined implementation contract · 5.0
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)  
**Product source:** [`../V2.md`](../V2.md)  
**Last updated:** 2026-09-08

## Goal

Provide the smallest reliable local viewing experience that completes Gafu's
prepare → study → watch loop. The learner chooses a local video and Japanese SRT,
sees time-synchronized selectable subtitles in normal and full-screen playback,
copies text normally, and deliberately captures one selected Vocabulary target
with a configurable Gafu shortcut.

At the end of this phase, ordinary selection is inert. The shortcut resolves an
inflected selection against its complete cue, asks for the minimum semantic
confirmation Kuromoji cannot supply, and submits one atomic Subtitle Capture to
Study. Study creates or reuses the Vocabulary Card and registers the same shared
staging intent used by every other Card source. Playback remains usable through
ambiguous, duplicate, invalid, and failed captures.

## Phase boundaries

### In scope

- Browser-local video chosen through a file input and played through the native
  HTML media element without uploading bytes.
- One browser-local `.srt` file with strict decoding and trustworthy cue timing.
- Play/pause, seeking through native controls, current-time cue activation, and
  subtitle rendering inside the full-screen element.
- Selectable multiline Japanese subtitle text with native clipboard behavior.
- One configurable shortcut, default `Ctrl/Cmd+Shift+G`, disabled while typing.
- Localhost-only capture resolution using the selected surface and full active
  cue context.
- Lemma, reading, broad part of speech, normalized span, and candidate choice.
- Learner confirmation of meaning/sense before a new semantic identity is
  committed when no trusted dictionary sense is available.
- One atomic Study command returning created or existing.
- Capture provenance without fixed sentence Learning Material or progress.
- Characterization of the small `jp-player` behaviors retained in V2.

### Out of scope

- Automatic mining, lookup on selection, hover lookup, or passive encounter
  credit.
- Grammar Card capture.
- ASS/SSA, VTT, embedded subtitle tracks, subtitle alignment, manual drift,
  transcoding, audio repair, multiple subtitle tracks, or remote media URLs.
- Sending video, audio, or subtitle files to the AI provider.
- Jisho or another remote dictionary. A future dictionary adapter must have a
  licensing, availability, sense-identity, and privacy decision first.
- Persisting video or subtitle bytes in SQLite or browser storage.
- Treating the captured cue as permanent Learning Material.

## Decisions frozen by this phase

### Local media is ephemeral and browser-owned

The Watch page creates an object URL for the selected video and revokes it when
replaced or unloaded. Video bytes never cross `fetch`, enter SQLite, or reach an
AI adapter. Native browser codec support is the Phase 5 playback envelope. An
unsupported codec produces a clear local error with suggested MP4/WebM codecs;
V2 does not silently transcode or claim MKV compatibility.

The SRT is read in the browser, bounded to 4 MiB, strictly decoded as UTF-8 (with
or without BOM) or BOM-labelled UTF-16, parsed locally, and discarded on unload.
The browser derives content-based episode and cue keys using Web Crypto with the
same Phase 3 identity inputs. Filenames and positional cue numbers are display
metadata only. SRT text is never persisted merely because the learner watched.

The Watch page accepts exactly one video and one SRT for this phase. This is a
deliberate first-release surface, not an inference that ASS, alignment, or audio
repair is unimportant. Those behaviors are deferred until the prepare/study/
capture loop has real usage evidence.

### The full-screen element owns video and subtitles

The full-screen request targets a `video stage` containing both the native video
and the subtitle layer. The subtitle layer is absolutely positioned within that
stage, uses a Japanese-capable system font stack, scales with the viewport, and
remains visible in `:fullscreen`. It permits text pointer interaction instead of
the `pointer-events: none` behavior used by display-only overlays.

Rendering is keyed by active cue identity so `timeupdate`, seeking, and rapid cue
changes do not rebuild an unchanged selection. Several simultaneous cues render
as separate block lines with enough vertical line height; newline characters are
preserved. Rendering uses DOM/text bindings, never subtitle `innerHTML`.

The retained `jp-player` behavior is characterized rather than copied:

- the full-screen ancestor includes the subtitle overlay;
- active cues include start/end boundaries and stay ordered;
- object URLs are revoked;
- selection and clipboard work over the rendered Japanese; and
- subtitle typography remains readable at normal and full-screen sizes.

Its monolithic player state, ASS positional IDs, auto-alignment, local FFmpeg,
audio repair, and settings architecture are not imported.

### Selection is inert; only an exact shortcut creates an intent

Selecting, dragging, double-clicking, right-clicking, or pressing `Ctrl/Cmd+C`
causes no lookup, network request, dialog, or write. Watch handles a keydown only
when it exactly matches the configured capture chord, the event is not repeated,
the focus is not in an input/textarea/select/contenteditable control, and a
non-collapsed selection is wholly inside the current subtitle layer.

The default is `Ctrl+Shift+G` on Windows/Linux and `Cmd+Shift+G` on macOS. The
learner can record another chord containing `Ctrl` or `Meta`, at least one of
`Shift` or `Alt`, and one non-modifier key. Plain letters, copy/cut/paste/select
all, browser reload, tab/window, devtools, and playback keys are rejected. The
validated chord is stored in browser local storage because it is a device input
preference, not authoritative learner state. Reset restores the default.

The shortcut prevents its browser default only after all capture preconditions
pass. Failed preconditions leave the page and native selection untouched.

### Capture resolution is context-bound and short-lived

The browser sends one localhost request containing:

- source version, episode key, cue key, cue start/end;
- normalized complete active-cue text;
- selected surface text and its UTF-16 span within that cue; and
- no video/audio bytes, filename, learner schedule, or provider credential.

The Watch module validates bounds, normalization, Japanese content, cue duration,
and input size, then runs the injected Japanese analyzer over the full cue. It
returns only content tokens whose spans overlap the selection. Particles,
auxiliaries, copulas, symbols, whitespace, and punctuation cannot become
Vocabulary Cards. Inflected surface forms resolve to the analyzer's lemma.

One exact candidate advances directly to confirmation. Several content tokens
produce a compact candidate picker. Zero candidates or a selection spanning
disjoint/non-content text is a typed failure. Watch does not guess which word the
learner meant.

Resolution returns an opaque Pending Capture token bound to the normalized
request and candidates for ten minutes in server memory. Commit supplies the
token, chosen candidate key, meaning, and sense label. A restart or expiry asks
the learner to invoke the shortcut again; no partial Card exists.

IPADIC supplies morphology, not dictionary-grade senses. Therefore Phase 5
requires the learner to confirm a concise meaning and a stable local sense label
before commit. The UI suggests a deterministic local label derived from lemma,
reading, POS, and normalized meaning, while making its non-dictionary status
clear. A future dictionary may turn this into a choice, but the semantic identity
is never guessed from the selected spelling alone.

### Watch has one deep capture interface

```ts
type Watch = {
  resolve(command: ResolveCapture): Promise<Result<CaptureResolution, WatchFailure>>;
  commit(command: CommitCapture, study: Study): Result<CaptureOutcome, WatchFailure>;
};
```

The interface hides normalization, selection validation, analyzer evidence,
Pending Capture storage, token expiry, candidate filtering, sense-label
validation, and translation into Study's immutable command. The browser never
constructs a Card directly. The production analyzer and deterministic test
analyzer are the existing real seam.

Playback-time lookup and SRT parsing/rendering remain separate internal browser
parts of Watch rather than one player file:

- `subtitles` parses and identifies cues and finds active cues;
- `playback` owns object URL/media-time/full-screen behavior;
- `selection` validates chord and DOM selection intent; and
- `browser` owns the page workflow and renders snapshots.

These are internal modules, not additional public interfaces.

### Study owns atomic capture and shared staging

Study exposes one additional behavior:

```ts
type Study = {
  captureVocabulary(command: SubtitleVocabularyCapture):
    Result<CaptureCardOutcome, StudyFailure>;
};
```

The command contains an operation key, complete Vocabulary Card content, a
versioned capture identity claim, and opaque provenance fields. One immediate
SQLite transaction:

1. returns the original result for the same operation and payload;
2. rejects an operation key reused for a different payload;
3. resolves current canonical and capture identity claims;
4. creates the Card only when neither claim exists;
5. attaches the capture claim to the one Card;
6. records deduplicated cue/span provenance; and
7. registers an active capture Staging Source when the Card is still staged.

The operation returns `created` or `existing`. Existing active, known, or
suspended Cards keep their state and schedule. A staged existing Card gains an
active capture source but is not admitted until the next normal `studyQueue`
transaction. Any failure rolls back Card, claims, evidence, source, and operation.

Repeating the same capture from the same cue/span never duplicates evidence.
Capturing the same sense in another cue adds evidence to the same Card. Different
senses may create separate Cards only after distinct confirmed sense labels and
meanings.

### Playback never depends on capture success

Capture UI is a non-modal side panel/dialog layered outside the video stage.
Opening it pauses nothing automatically. The learner may close it and continue.
The current selection remains until the browser naturally changes it; Gafu does
not clear it on typed failure.

Analyzer unavailable, stale/expired token, invalid candidate, identity conflict,
write failure, and duplicate result all produce concise messages. None changes
media current time, playback rate, volume, loaded object URL, cues, or subtitle
timing.

## Persistence contract

Study migration 4 adds:

- a capture operation ledger keyed by operation key and payload digest;
- capture evidence keyed by Card/source/cue/span, with selected surface and
  timestamp but no complete cue text; and
- capture Staging Sources using the Phase 4 table.

Watch stores no database rows. Pending Capture tokens live only in bounded
server memory, expire after ten minutes, and are consumed after successful
commit. Browser local storage contains only the validated shortcut chord. Object
URLs, media bytes, subtitle bytes, cue text, selection, and candidate dialogs are
ephemeral.

## Typed failures and recovery

Watch distinguishes invalid source/cue/span/selection, no Japanese, no content
candidate, ambiguous candidate choice, analyzer failure, expired/missing Pending
Capture, invalid meaning/sense, and Study failure. Study adds capture operation
conflict and invalid capture evidence.

Failures include no cue body, media name, subtitle filename, or provider data in
logs. The browser maps them to select again, choose a candidate, enter semantic
confirmation, retry the same operation, or continue playback.

## Server and browser flow

```text
choose local video + SRT -> play/seek/full-screen/select/copy
                                      |
                             exact capture shortcut
                                      v
                         local resolve -> choose/confirm
                                      v
                         atomic Study capture -> created/existing
                                      |
                              shared staged queue
```

The navigation adds `Watch` beside Study and Prepare. The screen states clearly
that files stay in the browser and that capture requests go only to the local
Gafu server. The capture panel names the selected surface, lemma, reading, POS,
meaning, sense label, and final created/existing outcome.

## Patch plan

### Patch 5.1 — Refined contract and behavior characterization

Freeze local file scope, strict SRT/cue identity, full-screen containment,
selection/shortcut rules, contextual resolution, semantic confirmation, atomic
Study capture, and privacy in this document and glossary.

**Gate:** every byte, state transition, and error has one owner; no interaction
other than the exact shortcut can cause a capture request.

### Patch 5.2 — Browser subtitle and playback internals

Implement strict browser SRT parsing/content keys, active cue lookup, object URL
lifecycle, native media/full-screen stage, and selectable safe rendering.

**Gate:** authored fixtures render the correct multiline cue at start/end/seeks
in normal/full-screen layout; invalid/oversized files are typed; no file bytes
cross the server.

### Patch 5.3 — Watch resolution and shortcut intent

Implement exact chord validation, DOM selection mapping, context-bound analyzer
resolution, Pending Capture tokens, candidate choice, and semantic confirmation.

**Gate:** copy/selection produces zero requests; inflection resolves to its lemma;
multi-token and no-content selections do not guess; expiry is recoverable.

### Patch 5.4 — Atomic Study capture

Add migration 4 and `captureVocabulary`, including claims, provenance,
operation idempotency, and capture Staging Source.

**Gate:** forced invalid/conflicting inputs write nothing; retry creates one
Card/evidence/source; the shared allowance remains the only admission path.

### Patch 5.5 — Watch browser journey and closure evidence

Compose the page, candidate/confirmation panel, created/existing feedback,
keyboard configuration, full-screen/copy browser assertions, documentation, and
Phase 6 handoff.

**Gate:** public browser behavior proves copy inertness and one deliberate
capture while all repository checks pass.

## Refinement scenarios

1. Video is replaced, the page unloads, or the codec errors.
2. SRT is empty, oversized, malformed, invalid UTF-8, UTF-8 BOM, or UTF-16 BOM.
3. Cues overlap, share boundaries, contain newlines, tags, and repeated text.
4. Seeking backward/forward changes active cues immediately.
5. Full-screen is entered and exited with subtitles visible and selectable.
6. A subtitle contains markup-looking text; it renders as text, not HTML.
7. The learner drags, double-clicks, right-clicks, or copies a selection.
8. The learner presses the shortcut with no selection, an external selection,
   a collapsed selection, or selection across two cues.
9. The shortcut repeats while held or is pressed inside a form control.
10. The learner tries to configure copy, reload, devtools, a plain letter, or
    an incomplete modifier chord.
11. The selection is an inflected verb, one kanji within a compound, a particle,
    punctuation, or several words.
12. Analyzer output is empty, degraded, unavailable, or outside the selection.
13. One and several content candidates overlap the selection.
14. Pending Capture expires or the server restarts before commit.
15. Meaning or local sense label is empty, huge, or normalized-equivalent.
16. A matching Card exists staged, active, known, or suspended.
17. The same capture is double-submitted or its successful response is lost.
18. The operation key is reused with a different candidate or meaning.
19. The same sense is captured in another episode; another sense shares spelling.
20. Capture insertion fails after Card, claim, evidence, or source write.
21. The daily allowance is already exhausted when capture succeeds.
22. A plan and capture both stage the same Card, then the plan is paused/deleted.
23. Capture fails while video is playing, paused, seeking, or full-screen.
24. Logs, failures, backup, network requests, and SQLite are inspected for video,
    audio, complete cue text, subtitle bytes, and credentials.

## Exit gate

Phase 5 is complete when:

- local video and strict SRT playback work with safe, readable, selectable
  subtitles in normal and full-screen stages;
- selection and native copy are proven inert and preserve clipboard text;
- only an exact validated configurable shortcut initiates localhost resolution;
- one inflected selected word resolves from full-cue analyzer evidence;
- ambiguous/multi-token resolution requires an explicit choice and semantic
  identity is confirmed rather than guessed;
- one atomic Study operation creates or reuses the intended Vocabulary Card,
  records evidence once, and registers shared staging intent;
- repeat, stale, invalid, and failed captures do not duplicate or partially
  write learner state and do not break playback;
- captured Cards cannot bypass New Cards per Day;
- video/audio/subtitle files and complete cue text remain ephemeral and are not
  sent to remote services; and
- all required checks pass from a clean checkout.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

Evidence records exact checks and counts, retained `jp-player` behavior
characterization, parser/selection/analyzer cases, atomic/idempotent Study rows,
clipboard/network assertions, full-screen evidence, privacy inspection, and the
Phase 6 handoff.

## Completion checklist

- [x] Local file, codec, and subtitle-format envelope is explicit.
- [x] Full-screen/selectable rendering and shortcut behavior are explicit.
- [x] Contextual resolution and sense-confirmation limits are explicit.
- [x] Atomic Study capture and shared staging are explicit.
- [x] Persistence, privacy, recovery, and deferrals are explicit.
- [ ] Browser subtitle/playback internals are implemented.
- [ ] Watch resolution and pending capture are implemented.
- [ ] Atomic Study capture is implemented.
- [ ] Watch browser journey and closure evidence pass.
