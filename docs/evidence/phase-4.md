# Phase 4 evidence and handoff

**Evidence date:** 2026-09-08
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium
**Result:** implementation complete; paid-provider, Kaishi, dictionary-sense,
grammar-envelope, and repository-licence gates remain explicit

## Executive result

A complete Preparation Gap can now become one durable Preparation Plan. The
browser requests a server-rebuilt Plan Draft, displays all selected work and
identity blockers, and submits only its digest plus an operation key. Study
validates the whole server-owned draft and commits Cards, claims, membership,
opaque cue references, staging intent, and the operation ledger in one SQLite
transaction.

The default includes required and helpful findings that remain missing or
existing and whose disposition is include. Known, known-for-set, incidental,
deferred, and dismissed findings remain outside it. Forty selected fixture
findings prove there is no top-N truncation. Ambiguous vocabulary blocks start
until the learner records a sense correction; the correction is local and does
not repeat paid analysis.

## Atomicity, identity, and lifecycle evidence

- A mixed Grammar/Vocabulary draft reused one matching Card and created two
  missing Cards. Same-operation and new-operation retries returned the same
  plan, revision, Cards, and memberships.
- Reusing an operation key with another digest is a typed conflict. Invalid or
  blocked drafts leave both Card and plan counts unchanged.
- Study resolves both its canonical content claim and the Preparation sense
  claim inside the transaction. A matching Card created after comparison is
  reused instead of duplicated.
- One Card can retain manual staging while also participating in a plan.
  Replacing membership removes only that plan's staging source.
- Pause disables only plan staging sources. Resume reenables them without
  consuming admission. Confirmed delete is retry-safe and removes only plan
  rows/sources; Cards and learner state remain.
- Study schema 3 backfills a manual staging source for every pre-existing staged
  Card. A simulated schema-2 upgrade proved that an old Card still admits.

## Shared admission, readiness, and forecast evidence

With New Cards per Day set to three, one manually created Card and three plan
Cards competed in one ordered queue. Exactly three entered Study; the fourth
remained staged for the next estimated local day. No plan-specific allowance or
direct admission exists.

Readiness reads Study state. A staged or active required Card blocks its
episodes; marking the two episode-one required Cards known made episode one
ready while episode two remained blocked. Helpful Cards do not block. Forecasts
show introduction dates only for eligible staged blockers, report active
blockers as having answer-dependent readiness, and return no date at a zero
allowance or with no active staging source.

## Browser and privacy evidence

The browser journey imports and analyzes two synthetic episodes, reviews the
complete draft, starts it once, displays per-episode required/helpful coverage
and estimates, pauses it, reloads the durable paused plan, and deletes it while
retaining Cards. The server rebuilds the current draft before start, so edited
or stale browser Card payloads cannot cross the seam.

Committed plan evidence contains episode/cue keys, classification, first need,
rank explanations, and Card identity—not subtitle bodies. Plan refresh, setting
changes, start retries, pause, resume, and deletion make no provider request.

## Exact validation

Run from the repository root with the runtime declared in `package.json`:

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The final local run produced 126 passing tests and 6,164 assertions across 32
files, a successful Vite production build, six passing Chromium journeys, and a
clean whitespace check.

## Known limitations and external gates

1. The owner-approved private Kaishi import path is available; its content is
   deliberately absent from the repository.
2. Preparation sense IDs remain provider/learner claims rather than trusted
   dictionary attestation.
3. Grammar discovery remains the declared 22-form envelope.
4. The environment has no paid provider key, so no real-series cost/quality
   smoke is claimed.
5. Plan forecast predicts first introduction from the queue, never successful
   recall or a guaranteed watch date.

## Phase 5 handoff

Watch may submit one deliberate vocabulary capture to Study, but it cannot write
Cards, sources, or schedules directly. Study must resolve/create the Vocabulary
Card and register one capture Staging Source atomically. Selection and copy stay
browser-native and inert; cue evidence remains provenance only. The player must
keep parsing, clock tracking, rendering, and capture orchestration in separate
internal parts behind one Watch interface.
