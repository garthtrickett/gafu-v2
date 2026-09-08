# Gafu V2 Implementation Plan

**Status:** Phase 3 implementation complete; external provider, Kaishi, sense, grammar, and licence gates pending · 1.7
**Product source:** `V2.md`
**Domain language:** `CONTEXT.md`
**Last updated:** 2026-09-08

## Purpose

Build Gafu V2 as a replacement for V1, not as a compatibility layer around it.
The implementation starts from the V2 product model and copies legacy code only
when a tested behavior is still required and the module remains a good fit.

The first usable release must complete this loop:

> Import a series' subtitles, find the useful gap in the learner's Japanese,
> create and stage the missing Cards, study them with validated `i`/`i+1`
> material, then capture a missed word from the subtitles while watching.

## Phase map

| Phase | Ends with |
|---|---|
| 0. Prove the risky seams | Evidence for Japanese analysis, validation, storage, and agent topology |
| 1. Card and SRS core | Durable typed Cards and deterministic offline study |
| 2. AI-generated study | Varied, validated `i`/`i+1` presentations |
| 3. Subtitle Set analysis | Multi-file or ZIP input becomes one trustworthy Preparation Gap |
| 4. Preparation Plan | Gap Cards are created, staged, studied, and reflected in episode readiness |
| 5. Watch | Selectable subtitles and deliberate shortcut-based Vocabulary Card capture |
| 6. Replacement | Audited V1 import, recovery, realistic scale, and cutover |

## Delivery rules

1. Build one vertical phase at a time. `main` must remain runnable at every
   phase boundary.
2. A phase is complete only when its exit gate passes through the same public
   interfaces used by the app.
3. Expand the next phase into implementation-sized work immediately before it
   starts. Later phases intentionally stay high-level until earlier evidence is
   available.
4. No V1 or `jp-player` source is copied wholesale. Reuse begins with a behavior
   test; code is copied only if it satisfies the V2 interface more cleanly than
   rewriting it.
5. Failed imports, agent calls, generation, and writes must be retryable without
   duplicate Cards or partial plans.
6. Product limits are explicit. The app must never silently substitute a
   top-three, top-fifteen, context-window-sized, or daily-sized result for the
   complete useful Preparation Gap.

## Architecture direction

V2 adopts the parts of the Notes architecture that made it easy to reason
about, without forcing a complex application into one giant file or one global
state machine.

### Small kernel

- Strict TypeScript with `noUncheckedIndexedAccess`.
- A small `Result<T, E>` type for expected failures.
- Discriminated error unions owned by the module that can produce them.
- Exhaustive handling at the place that decides recovery or presentation.
- Unknown exceptions are converted to typed errors at impure seams; they do not
  travel through domain logic.
- Dependencies are created once in the composition root and passed in.
- Clocks, ID generation, AI calls, storage, and filesystem/browser input are
  injected wherever determinism matters.
- No Effect runtime, dependency-injection framework, generic repository layer,
  or class hierarchy is planned.

### Deep modules

The starting module map is deliberately small:

| Module | Owns | Does not expose |
|---|---|---|
| **Study** | Cards, learner state, schedules, review answers, Known Word Bank, committed Preparation Plans, readiness, New Cards per Day admission | database tables, scheduler internals |
| **Learning Material** | AI requests, structured output, target validation, `i`/`i+1` validation, recent-material variation, validated fallback | provider payloads, prompts |
| **Preparation** | Subtitle Set import, linguistic evidence, Preparation Gap, ranking, corrections, immutable Plan Drafts, staging proposal and forecast | ZIP mechanics, agent batching, persistence layout |
| **Watch** | local playback state, subtitle display, text selection, keyboard capture | player-library details, Card writes |

The modules collaborate through narrow interfaces. Preparation asks Study for a
read-only knowledge snapshot and submits one immutable Plan Draft to
Study's `startPlan` operation. Study commits the plan membership, source
evidence, new Cards, and schedules in one transaction; Preparation never queries
or mutates Study's persistence directly. Watch submits one Subtitle Capture
request to Study and receives a created/existing result.

Dependency direction is one-way:

```text
application shell ─┬─> Preparation ──Plan Draft──> Study
                   ├─> Learning Material <──Card + knowledge snapshot
                   └─> Watch ──Subtitle Capture──> Study
```

Study imports neither Preparation nor Watch. Shared values crossing these seams
are small, immutable domain contracts, not database records or module state.
Learning Material receives the target Card and a knowledge snapshot as input;
it does not reach back into Study during generation.

### Real seams and adapters

- **Persistence:** production storage plus an isolated in-memory or local test
  adapter. Each deep module owns its stored representation. Study alone owns the
  transaction that turns a Plan Draft into a committed plan and Cards.
- **AI provider:** configured production provider plus a deterministic fake.
  Provider-specific request and error shapes end at this seam.
- **Japanese analysis:** a production tokenizer/analyzer plus fixed test
  fixtures. Introduce a replaceable adapter only after the Phase 0 spike proves
  that more than one implementation or a test double is necessary.
- **Media playback:** browser media is isolated inside Watch. Tests use a small
  controllable adapter only for behavior that browser automation cannot drive
  reliably.

Do not create interfaces around code that has only one implementation and no
meaningful need for substitution. Internal helpers remain private to the deep
module that owns the rule.

### State and side effects

- Domain transitions are synchronous and deterministic.
- Impure actions return typed results; they do not mutate UI state from promise
  callbacks.
- Each workflow has one explicit state owner. Async completions return events to
  that owner, so stale results can be rejected.
- Multi-record invariants use one storage transaction. Database uniqueness is
  the final duplicate defense, not an optimistic UI check. Cross-workflow
  atomicity belongs to the module owning the use case, never to the UI.
- The UI renders module snapshots and sends intents. It does not reproduce
  scheduling, gap, generation, or deduplication rules.

## Cross-phase invariants

These must hold from the first phase in which the relevant behavior exists:

- A Card has exactly one type: Grammar Card or Vocabulary Card.
- One learner has at most one schedule for a canonical Card.
- Generated Learning Material never owns progress.
- Invalid or unvalidated AI output is never shown as study material.
- A generated presentation is `i` or `i+1`; the target is the only possible
  unknown.
- Kaishi 1.5k begins in the Known Word Bank and is not turned into 1,500 Cards.
- New Cards from every source share one New Cards per Day allowance.
- Study is the sole authority for Card learner state, admission, review history,
  and schedules. Preparation and Watch can request transitions but cannot write
  them independently.
- Subtitle and media provenance cannot reset or delete Card progress.
- Raw video and audio are never sent to an AI provider.
- Selection alone never triggers lookup, capture, or remote work.
- Every destructive or batch operation is atomic or explicitly resumable.

## Phase 0 — Prove the risky seams

**Detailed execution contract:** [`phases/phase-0.md`](phases/phase-0.md). It is
authoritative for Phase 0 where this outline is less specific.

### Outcome

A runnable skeleton and evidence that the two hardest language operations are
feasible before the data model hardens around them.

### Work

- Establish the minimal Bun, Vite, TypeScript, test, formatting, and browser-test
  setup.
- Add the Result kernel, typed error conventions, logging boundary, composition
  root, and one trivial rendered route.
- Spike and decide the first-release data topology: local/browser persistence or
  an owned server database, how backups work, and which side owns writes. Do not
  build a sync system while multi-device use remains a deferred requirement.
- Spike and decide AI topology and API-key custody: direct provider access where
  browser security permits it, or a minimal owned proxy where it does not. The
  decision must support entering an API key directly and must not require JSON
  export/import for normal operation.
- Create representative Japanese fixtures containing inflection, homographs,
  compounds, names, dialogue noise, and recurring grammar from real-world-style
  subtitles without committing copyrighted episode text.
- Spike Japanese analysis from surface text to spans, lemma, reading, part of
  speech, candidate sense, and canonical grammar matches.
- Spike structured agent output over a multi-episode fixture and prove it can be
  batched without losing a unified result or evidence links.
- Spike deterministic validation that detects the requested target and unknown
  supporting vocabulary. Measure the remaining difficulty of validating
  non-target grammar rather than claiming it is solved by prompting.
- Set a go/no-go gate: if target identity and `i`/`i+1` cannot be validated with
  credible precision on the fixture suite, stop and revise the product contract
  explicitly. Do not weaken the invariant inside implementation.
- Record only hard-to-reverse architecture choices as ADRs after the spikes
  provide evidence.

### Exit gate

A fixture Subtitle Set can be analyzed into stable vocabulary and grammar
evidence; known vocabulary can be subtracted; malformed and ambiguous results
are typed failures; and a provider fake can run the same workflow offline. The
data and AI topology decisions are recorded with working spikes rather than
assumptions. There is a credible measured path to validating both vocabulary
and grammar support; otherwise the phase stops with evidence. The repo passes
type-check, unit tests, and one browser smoke test.

### Not in this phase

Real SRS scheduling, persistent Cards, production agent calls, ZIP upload,
series planning, or playback.

### Phase 0 implementation result

The executable proof is complete. Kuromoji/IPADIC reconstructs the selected
held-out Japanese spans without trusted fallback; conservative subtraction has
zero held-out false-known exclusions; the independent material validator
rejects all 1,200 frozen invalid presentations; complete-only batching resumes
without silently repeating completed or uncertain work; and the browser
diagnostic composes these boundaries offline. A local Bun server with SQLite is
the selected writer, provider keys/calls remain server-side, and both choices
are recorded in ADRs.

Phase 1 remains planned rather than ready until two closure gates are cleared:
the three-run paid provider smoke needs a developer-supplied
`OPENAI_API_KEY`, and the owner must select the repository licence. The code
does not depend on either being silently assumed.

Phase 1 may rely on these facts:

- analyzed spans index NFKC-normalized text in UTF-16 code units;
- analyzer failure and ambiguity remain typed and cannot subtract knowledge;
- the selected analyzer supplies surface, lemma, reading, broad part of speech,
  and conjugation but no trustworthy sense identity;
- `i`/`i+1` validation is independent from the generating provider and covers
  the declared 22-construction grammar envelope;
- Study will own one SQLite transaction for Cards, schedules, plan membership,
  and evidence; and
- the browser never owns provider keys or authoritative learner progress.

Before Phase 1 freezes Vocabulary Card identity, select a dictionary/sense
authority consistent with the glossary's “one lemma or fixed expression in one
meaning” definition. IPADIC alone cannot supply that identity, and an unknown
sense must stay unresolved rather than being guessed.

## Phase 1 — Card and SRS core, offline

**Detailed execution contract:** [`phases/phase-1.md`](phases/phase-1.md). It is
authoritative for Phase 1 where this outline is less specific.

### Outcome

A learner can create Grammar and Vocabulary Cards, study them, reload, and keep
one correct schedule per Card without any AI or subtitle input.

### Work

- Define canonical Card identity, Card content, learner state, review event, and
  schedule persistence.
- Resolve and document the scheduling algorithm, answer grades, state
  transitions, time-zone behavior, and the learner-state thresholds that add a
  Vocabulary Card to the Known Word Bank or permit supporting grammar.
- Seed Kaishi 1.5k as Known Word Bank entries, separately from Cards.
- Implement deterministic duplicate handling for vocabulary lemma/sense and
  grammar canonical form.
- Implement the scheduler and one shared New Cards per Day admission rule across
  Grammar and Vocabulary Cards.
- Add manual Card creation, a minimal study queue, answer recording, and the
  setting for New Cards per Day.
- Exercise the schedule with injected, prevalidated fixture presentations. They
  are test scaffolding, not a fixed-material study mode exposed as V2 behavior.
- Add the minimum Card-bank management needed to browse, search, correct, mark
  known, suspend, and restore Cards without editing storage by hand.
- Make multi-record writes transactional and schema upgrades forward-only and
  tested.
- Add export/backup of V2 learner data before the first irreplaceable progress
  can be created.

### Exit gate

Create one Grammar Card and one Vocabulary Card, attempt both duplicates, study
the originals with validated fixtures across an injected clock, reload, and
observe the same schedules. Changing New Cards per Day changes future admissions
without rewriting history. Kaishi words are usable as known vocabulary but do
not appear as study Cards. No production fixed-material study path exists.

### Not in this phase

AI generation, automatic language analysis, subtitle import, Preparation Plans,
or playback.

### Phase 1 implementation result

The offline Study module, local server, and Card-bank browser are implemented.
SQLite owns Cards, unique versioned Identity Claims, reversible learner state,
FSRS 6 schedules, append-only Review Events, support readiness, one shared
time-zone-safe admission allowance, preferences, baseline corrections, and
backup. The integrated injected-clock journey and browser management journey
pass through the same Study seam used by the application.

Phase 1 has one explicit closure gate: the official Kaishi project does not
publish an explicit content licence, so its 1.5k entries are not copied into
this repository. The versioned production seed seam reports `unavailable`
instead of silently treating an empty bank as Kaishi; synthetic conformance
proves the seed behavior. See [`docs/evidence/phase-1.md`](docs/evidence/phase-1.md).

Phase 2 must preserve these facts:

- Learning Material receives a Card and knowledge snapshot; it never writes a
  schedule or Review Event.
- Only a validated, target-bound Presentation Permit can authorize an answer.
- Study consumes a permit in the same transaction as the FSRS transition.
- Display corrections do not change a Card's immutable Identity Claims.
- A trusted dictionary may attach an additional claim to a Card; unresolved
  senses remain ambiguous.
- No production fixed-material review route exists to fall back to.

## Phase 2 — AI-generated study material

**Detailed execution contract:** [`phases/phase-2.md`](phases/phase-2.md). It is
authoritative for Phase 2 where this outline is less specific.

### Outcome

Every admitted Card can be taught and reviewed with varied, validated material
whose only possible unknown is the target Card.

### Work

- Define one Learning Material request and result independent of any provider.
- Implement the configured AI-provider adapter and deterministic fake.
- Let the learner enter, replace, remove, and verify the provider API key through
  normal settings. Secrets must be redacted from logs, errors, exports, and
  browser-visible diagnostics.
- Generate material from the target Card, Known Word Bank, and known Grammar
  Cards; require structured output with Japanese, reading, meaning, context,
  target span, and teaching metadata appropriate to the Card type.
- Validate schema, Japanese reconstruction, target presence, target span,
  canonical match, supporting vocabulary, and supporting grammar before display.
- Reject, retry, and diagnose invalid material without consuming a review or
  corrupting its schedule.
- Track recent validated material per Card and reject exact or ineffective
  near-copies.
- Keep a small validated fallback pool so a temporary provider failure does not
  strand an already-started study session.
- Make the exact text sent to the provider inspectable during development and
  disclose provider retention implications in product settings.

### Exit gate

The same Grammar Card and Vocabulary Card can each be studied repeatedly with
materially different valid presentations. Tests deliberately return a missing
target, bad span, reconstruction mismatch, extra unknown word, extra unknown
grammar, malformed response, timeout, and provider rejection; none reaches the
learner or advances SRS. A learner can configure and verify a provider with an
API key without copying configuration JSON.

### Not in this phase

Subtitle-derived targets, Preparation Plans, synthesized audio, or Watch.

### Phase 2 implementation result

Learning Material now owns structured `gpt-5.6-luna` generation, independent
local validation, teach-before-test state, versioned exact/near-copy rejection,
validated reserves, and opaque Presentation Permits. The local settings flow
verifies, replaces, and removes a server-memory API key without JSON; Study
remains the only review and schedule writer and rejects stale second-tab
answers. The full deterministic and browser gates pass.

The paid provider smoke remains pending because this environment has no API
key. The declared 22-form grammar envelope, lack of dictionary-grade sense
attestation, production Kaishi source, and repository licence remain explicit
gates or limitations. See [`docs/evidence/phase-2.md`](docs/evidence/phase-2.md).

Phase 3 must preserve these facts:

- agent output is a proposal until local evidence and identity checks pass;
- provider credentials and calls stay in the local server;
- Study is the sole Card/progress writer;
- provider failures cannot create partial learner state; and
- subtitle analysis uses its own complete, resumable batching contract rather
  than Learning Material's three-candidate reserve protocol.

## Phase 3 — Subtitle Set to Preparation Gap

**Detailed execution contract:** [`phases/phase-3.md`](phases/phase-3.md). It is
authoritative for Phase 3 where this outline is less specific.

### Outcome

One or more `.srt` files, selected directly or supplied in a `.zip`, produce one
inspectable, resumable, evidence-backed Preparation Gap across a series.

### Work

- Safely ingest individual SRT files and ZIP archives with explicit file-count,
  byte-size, encoding, and extraction limits.
- Show accepted, rejected, and duplicate files before analysis; infer episode
  names and order while allowing correction.
- Parse cues into stable source evidence without relying on positional-only IDs.
- Analyze and canonicalize vocabulary and grammar in bounded, resumable batches.
- Persist completed batch identities and normalized results so a retry neither
  pays for nor merges the same agent work twice.
- Show the learner the subtitle scope, configured provider, and estimated remote
  analysis usage before the first paid request.
- Give the agent only subtitle text and local token/grammar evidence; keep the
  complete learner-state comparison local and never send video or audio.
- Compare results with the Known Word Bank and Study knowledge snapshot. Exclude
  known targets, attach already-learning Cards, and preserve ambiguity instead
  of inventing certainty.
- Rank required, helpful, and incidental language using recurrence,
  cross-episode reuse, comprehension impact, and first important appearance.
- Keep the complete useful gap inspectable even when agent context or UI page
  size requires batching.
- Let the learner correct meaning/sense, known-for-set state, classification,
  disposition, episode order/title, and inclusion before Card creation.
- Deleting or replacing a Subtitle Set removes its analysis and evidence links
  only under an explicit policy; it cannot delete a shared Card or change Study
  progress.

### Exit gate

Direct multi-file import and equivalent ZIP import produce the same ordered
Subtitle Set and Preparation Gap. Repeated targets across episodes have one
canonical identity with multiple evidence links. Known and already-learning
items are handled correctly. Interrupting and resuming analysis neither loses
completed work nor duplicates it.

### Not in this phase

Creating the plan's missing Cards, admitting them to daily study, readiness,
or playback.

### Phase 3 implementation result

Preparation now owns bounded direct/ZIP inspection, strict SRT parsing,
content-derived provenance, durable Subtitle Sets, complete resumable analysis,
local Study comparison, evidence aggregation, deterministic ranking, correction
overlays, and deletion that cannot cross into Study. The Prepare browser covers
both direct and equivalent ZIP journeys; the deterministic restart test recovers
an accepted-but-lost batch without resubmission. The full local and browser
gates pass.

The paid provider smoke remains pending because this environment has no API
key. IPADIC sense limits, the declared 22-form grammar envelope, production
Kaishi source, and repository licence remain explicit gates or limitations. See
[`docs/evidence/phase-3.md`](docs/evidence/phase-3.md).

Phase 4 must preserve these facts:

- only a complete corrected Preparation Gap can become a Plan Draft;
- Study remains the sole Card, staging, schedule, and progress writer;
- existing Cards are reused and ambiguous Vocabulary findings require learner
  correction rather than guessed identity;
- the shared New Cards per Day setting is the only daily admission limit; and
- plan changes never require another paid subtitle analysis when the source and
  linguistic-analysis versions are unchanged.

## Phase 4 — Preparation Plan and staged learning

**Detailed execution contract:** [`phases/phase-4.md`](phases/phase-4.md). It is
authoritative for Phase 4 where this outline is less specific.

### Outcome

The learner can turn a corrected Preparation Gap into Cards, learn them at the
existing SRS pace, and see when each episode is ready to watch.

### Work

- Resolve the PRD's default-selection question before implementation, then make
  required and helpful selection behavior explicit and reversible in the plan
  review UI.
- Submit the corrected Plan Draft to Study's `startPlan` operation. In one
  transaction it reuses existing Cards, creates each selected missing Card once,
  retains evidence, commits plan membership, and establishes a deterministic
  staging order.
- Stage by first-needed episode, comprehension value, recurrence, and dependency
  readiness. Do not create a separate plan-specific daily limit.
- Admit staged Cards through Study's shared New Cards per Day rule alongside
  manual and Subtitle Capture Cards.
- Forecast time to first introduction and readiness from the queue, existing
  reviews, and current setting. Recompute after setting, progress, or plan
  changes; label forecasts as estimates.
- Show overall and per-episode coverage, remaining required Cards, current
  learning Cards, and the reason each Card is included.
- Preserve learner corrections and Card progress when subtitles are reanalyzed
  or files are added, removed, or reordered.
- Support pause, resume, and deletion of a plan without deleting shared Cards or
  their progress.

### Exit gate

A multi-episode fixture produces a plan containing both Card types. Starting it
is atomic and idempotent. With New Cards per Day set to three, no fourth unseen
Card from any source enters that day's study. Completing required study changes
the correct episode—not necessarily the whole series—to ready.

### Not in this phase

Video playback, automatic encounter credit, subtitle selection, or V1 import.

### Phase 4 implementation result

Preparation now projects a deterministic, complete Plan Draft with explicit
identity/evidence blockers and no top-N cutoff. Study validates and commits that
draft atomically, resolves identity again at write time, creates or reuses each
Card once, retains source evidence, and records one durable plan revision.
Manual and plan Staging Sources compete in the existing shared New Cards per Day
transaction. Support readiness drives per-episode readiness; queue position
drives clearly labelled introduction estimates. Pause, resume, replacement, and
delete change plan staging intent without deleting Cards or progress. See
[`docs/evidence/phase-4.md`](docs/evidence/phase-4.md).

Phase 5 must preserve these facts:

- selection alone and ordinary copy perform no network or Study write;
- Subtitle Capture adds a capture Staging Source and never bypasses shared
  admission;
- Watch submits one vocabulary intent and never writes Study persistence;
- subtitle provenance is evidence, not fixed Learning Material or progress; and
- playback state must remain usable after ambiguous, duplicate, or failed
  capture.

## Phase 5 — Watch and Subtitle Capture

### Outcome

The learner can watch local media with selectable subtitles, copy arbitrary
subtitle text normally, and deliberately add one missed word to SRS with a
keyboard shortcut.

### Work

- Build the minimum local media and subtitle experience required for reliable
  playback, seeking, cue timing, full-screen subtitle display, and selectable
  Japanese text.
- Keep parsing, playback time, subtitle rendering, and capture orchestration
  inside separate internal parts of the deep Watch module rather than one
  player file.
- Preserve native selection and `Ctrl/Cmd+C`; selection alone performs no lookup,
  network request, or write.
- Bind a dedicated, configurable shortcut that does not collide with copy,
  browser, or player controls.
- Resolve the selected surface form using its cue context. Ask for a compact
  choice when lemma or sense is ambiguous.
- Submit one atomic Vocabulary Card addition to Study and report created,
  already-existing, or typed failure without interrupting playback.
- A created Card enters the same staged New queue as every other Card. Subtitle
  Capture never bypasses New Cards per Day or marks the word learned.
- Record subtitle provenance as evidence only. It never becomes fixed Learning
  Material or a second schedule.
- Port a `jp-player` behavior only after a characterization test proves V2 still
  needs it. Do not import its architecture or repository history.

### Exit gate

In normal and full-screen playback, copying a complete Japanese sentence leaves
the clipboard correct and performs no SRS write. Selecting an inflected word and
using the Gafu shortcut creates the intended Vocabulary Card once. Repeating it
does not duplicate the Card; ambiguous and failed captures leave selection and
playback usable.

### Not in this phase

Automatic mining during playback, passive encounter credit, Grammar Card
capture, automatic subtitle alignment, transcoding, or every V1 player setting.

## Phase 6 — Migration, reliability, and replacement

### Outcome

V2 can safely replace the current Gafu for the learner's real data and realistic
series-sized workloads.

### Work

- Freeze the V2 import contract only after the Card and scheduling model has
  survived the earlier phases.
- Build an idempotent, one-way V1 importer with a dry-run report for mapped,
  merged, skipped, ambiguous, and invalid records.
- Preserve legitimate learner progress and review history where semantics match;
  quarantine records that cannot be mapped honestly instead of guessing.
- Never import provider credentials or API keys from V1; the learner configures
  them again through V2 settings.
- Test backup followed by destructive restore into a clean installation.
- Exercise large archives, long-running agent batches, provider throttling,
  browser restarts, storage exhaustion, duplicate requests, and schema upgrades.
- Add useful structured diagnostics at module seams without logging subtitle
  bodies, API keys, or private learning content by default.
- Measure study start latency, generation latency, analysis cost, and series-plan
  scale against explicit release budgets.
- Run accessibility, keyboard-only, Firefox, Chromium, full-screen, and mobile
  checks for the supported surface.
- Publish the cutover instructions, mark V1 maintenance-only, archive
  `jp-player`, and rename repositories only after V2 has passed a real-data
  parallel run.

### Exit gate

A backup of real V1 data passes a dry run, imports exactly once, and produces an
auditable reconciliation. A real learner can prepare a representative series,
complete study over multiple days, watch and capture a missed word, export V2,
restore it cleanly, and repeat the workflow without V1.

### Not in this phase

Silent in-place conversion of the V1 database, two-way V1/V2 synchronization,
or indefinite maintenance of both products.

## Quality gates for every phase

- Type-check and formatting/lint checks pass.
- Focused unit tests cover pure rules and every typed error branch.
- Module-interface integration tests cover persistence and external adapters.
- Property tests cover scheduler invariants, canonical deduplication, and staged
  admission; bounded fuzz tests cover SRT and ZIP parsing.
- At least one unhappy-path test is written before the happy-path gate for each
  destructive, remote, or batch workflow.
- Browser tests cover only high-value user journeys and regressions that require
  a browser.
- Schema changes include migration, rollback/recovery notes, and upgrade tests.
- Logs identify the workflow and failure kind without exposing secrets or raw
  subtitle content.
- `git diff --check` passes and the phase documents any deliberate deferral with
  a concrete trigger for revisiting it.

## Risk register and retirement phase

| Risk | Retired by |
|---|---|
| Japanese canonicalization is too inaccurate for trustworthy gap subtraction | Phase 0 fixture gate, then Phase 3 corrections |
| `i`/`i+1` grammar validation cannot be made reliable | Phase 0 measurement and Phase 2 adversarial gate |
| Agent context limits silently omit series targets | Phase 0 batching spike and Phase 3 resumability gate |
| Duplicate identity corrupts schedules across episodes or retries | Phase 1 uniqueness and Phase 4 idempotency gates |
| A large generated plan overwhelms daily study | Phase 1 shared admission rule and Phase 4 forecast gate |
| Subtitle selection breaks copying or full screen | Phase 5 browser gate |
| V1 states do not map cleanly to V2 Cards | Phase 6 dry-run reconciliation |

## Deferred until evidence requires them

- Multi-user tenancy and cross-device synchronization.
- A plugin or public API surface.
- Multiple AI providers beyond the configured provider and test fake.
- Hosted video, audio upload, and remote media storage.
- Automatic alignment, transcoding, and browser-WASM FFmpeg.
- Automatic Card creation from passive playback.
- Grammar capture from selected subtitles.
- Generated or synthesized audio.
- Native mobile applications.

Each deferral must be reconsidered only when a product requirement, measured
failure, or second real adapter creates the need—not because the architecture
could theoretically support it.
