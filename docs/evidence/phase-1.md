# Phase 1 evidence — Card and SRS core

**Result:** Implementation complete; the private Kaishi path was resolved by
owner approval on 2026-09-09 without redistributing its content.
**Branch:** `codex/phase1-card-srs-core`
**Runtime:** Bun 1.3.2
**Date:** 2026-09-08

## Implemented result

Study is the single module that owns durable Cards and learning state. Its
interface creates and deduplicates Grammar and Vocabulary Cards, lists and
updates display content, transitions learner state, returns non-mutating status
and knowledge snapshots, admits a daily queue, records an answer, manages Study
preferences and baseline corrections, and exports a backup. Callers do not see
SQLite records or `ts-fsrs` types.

SQLite schema version 1 persists:

- Cards and unique `gafu-manual-v1` Identity Claims;
- staged, active, known, and suspended learner state with reversible return
  state;
- one schedule and admission event per Card;
- append-only, permit-unique Review Events with before/after schedules;
- New Cards per Day, time zone changes, and a pinned admission window;
- versioned baseline words and learner corrections; and
- forward-only schema and seed ledgers.

All multi-record Card, admission, answer, preference-history, and seed writes
use immediate SQLite transactions. A forced Card insert failure leaves no claim
or progress fragment. Two Study instances sharing one database cannot consume
the same final admission slot.

## Scheduler evidence

`ts-fsrs` 5.4.2 (MIT) reports `v5.4.2 using FSRS-6.0`. Study pins its first
parameter set as `gafu-parameters-v1`:

- requested retention: 0.9;
- maximum interval: 36,500 days;
- fuzz: disabled for reproducibility;
- learning steps: 1 minute and 10 minutes; and
- relearning step: 10 minutes.

The adapter persists only Gafu's `StoredSchedule` and translates all four
answers. A bounded 160-transition test checks finite difficulty/stability,
monotonic review counts, and no due time in the past. Existing Review Events
retain the scheduler version and exact before/after state; future upgrades do
not reschedule history.

## Identity and state evidence

- NFKC and whitespace-equivalent grammar forms resolve to one claim.
- Katakana/hiragana reading variants and superficial English case/final
  punctuation resolve to one manual vocabulary claim.
- The same spelling with a different reading, part of speech, or primary sense
  remains a different Vocabulary Card.
- A duplicate create returns `existing` and preserves Card ID, staging, state,
  schedule, and history across restart.
- Display-content updates retain earlier Identity Claims and add the corrected
  normalized form as an alias. A claim already owned by another Card rejects the
  entire update, while learner state remains unchanged.
- Mark known/not known and suspend/restore are reversible. Suspension preserves
  due time and support readiness.
- Explicit known status is support-ready immediately. Otherwise the second
  successful answer on a different local day and at least 20 hours after the
  first sets support readiness once.

## Admission and time evidence

New Cards per Day defaults to 15 and is one limit across both Card types. A
bounded test creates 12 Cards for each limit from 0 through 10 and observes
exactly the configured number admitted. Lowering the limit never removes an
admitted Card; raising it can consume only the remaining allowance.

The admission window is pinned to the time zone in which it began. Changing the
time-zone preference cannot reset that window or admit an extra Card; once the
pinned local day rolls over, the next window uses the new preference. Review
events use the current preference and keep their original local-day/time-zone
pair permanently.

## Recovery and browser evidence

- Closing and reopening a file database preserves Cards, preferences, learner
  state, admissions, schedules, support readiness, and Review Events.
- A database whose migration ledger is newer than the application is rejected
  as `unsupportedSchema`.
- A forced schema-v1 migration conflict leaves version 1 unapplied.
- A serialized backup opens as SQLite and reconciles its Card count and schema
  version.
- The browser creates both Card types, reports a duplicate as existing, changes
  state and preferences, searches the Card bank, reloads without loss, and
  downloads a non-empty backup.
- The default route exposes no answer controls or fixture Learning Material.
  The Phase 0 proof remains isolated behind its diagnostic link.

## Validation

Run from the repository root with the exact Bun runtime declared by
`packageManager`:

```bash
bun run check
bun test
bun run build
CI=1 bun run test:browser
git diff --check
```

Observed result:

- static check: pass, 80 files;
- unit/fixture/module tests: pass, 86 tests and 5,899 assertions;
- production browser build: pass;
- browser journeys: pass, 3 tests;
- whitespace check: pass.

## Closure gate and limitations

The official Kaishi repository distributes a deck but does not include an
explicit content licence. Gafu's own licence selection cannot authorize copying
that dataset. Production therefore uses an explicit `unavailable` Kaishi seed;
it does not claim that zero words is the 1.5k baseline. The idempotent versioned
seed and enable/disable correction path pass against a synthetic manifest.

Closure requires either written permission/a redistributable Kaishi word
manifest or an owner-approved import path that does not copy third-party content
into Gafu. No Kaishi sentence, audio, image, or deck payload is committed.

The owner approved that private import path on 2026-09-09. PR #19 added a
validated compiler for the learner-owned compact pool and automatic loading from
a gitignored manifest; it did not add Kaishi content to the repository. The
production baseline gate is therefore resolved for this private deployment,
while public redistribution remains prohibited absent a content licence.

Other deliberate limitations:

- manual vocabulary deduplication proves only the same normalized manual claim;
  a trusted dictionary authority is still required for automatic sense
  resolution;
- the first release currently models one local learner and no sync;
- FSRS uses defaults rather than learner-optimized parameters;
- destructive restore remains Phase 6 work; and
- production review remains disabled until Phase 2 can issue validated Learning
  Material permits.

The two Phase 0 closure gates also remain independent: the paid OpenAI smoke
needs a developer-supplied key, and the Gafu repository licence needs owner
selection.

## Phase 2 handoff

Phase 2 should inject a real permit verifier backed by validated Learning
Material, then expose study without expanding Study's persistence interface.
Generation may retry or fall back before a permit exists; once Study accepts an
answer, the permit ID, Review Event, support-readiness change, and FSRS schedule
must still commit atomically.
