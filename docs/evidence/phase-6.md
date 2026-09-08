# Phase 6 evidence and release handoff

**Evidence date:** 2026-09-08  
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium and Firefox  
**Result:** implementation validation complete; owner-only real-data gate open

## Implemented replacement boundary

The V1 bridge consumes one bounded, versioned, credential-free projection of
the authenticated V1 sync response. Dry-run accounts for every learner progress
row before any write. Apply rebuilds that plan against the current destination
and atomically records Cards, source/canonical identity, learner state,
explicitly labelled V1-derived schedules, preferences, an import receipt, and
hashed quarantine evidence.

An exact operation retry is a no-op; changed bytes under the same import key
conflict. Existing V2 suspended/known state and native V2 reviews are not
downgraded. The bridge creates no Review Event because V1's sync projection has
no historical grades or V2 Presentation Permits.

## Recovery and operations

Backup inspection checks the file bound, SQLite header, complete integrity,
foreign keys, and exact Study/Preparation schema. Confirmed offline restore
copies and revalidates in the destination directory, makes a timestamped safety
copy of an existing destination, atomically replaces it, and reopens the Study
and Preparation tables. Corrupt and newer-schema sources leave the destination
byte-for-byte unchanged.

The health command reports operational schema, count, integrity, pending,
failed, and uncertain state without Card text, subtitles, provider output,
learner identity, credentials, or paths. Migration log tests likewise reject
fixture content and source identifiers.

## Scale and browser evidence

Deterministic local release fixtures currently complete within these measured
times, under the 5-second CI-safe enforcement ceiling:

| Operation | Fixture | Observed local time |
|---|---:|---:|
| Snapshot validation and reconciliation | 5,000 progress rows | ~0.29 s |
| Card insertion setup plus list/status assertions | 5,000 Cards | ~0.22 s |
| Watch parse and cue activation | 10,000 SRT cues | ~0.52 s |

The migration lookup is indexed in memory by source ID rather than scanning the
entire catalogue for every progress row. Backup/restore streams filesystem
copies instead of serializing a second 128 MiB buffer in application memory.

The critical browser journey passes in desktop Chromium, desktop Firefox, and
a Pixel 7 Chromium viewport. It checks shell readiness, keyboard-visible focus,
Study → Watch → Prepare navigation, selectable Japanese subtitle text,
configurable capture shortcut behavior, and absence of horizontal overflow.
Chromium continues to own the complete browser suite; Firefox/mobile run the
declared critical surface.

## Exact validation

The final closure run is:

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The final local run produced 157 passing tests and 6,268 assertions across 42
files, a successful Vite production build, ten passing browser journeys (eight
Chromium, one Firefox critical-surface, and one mobile Chromium
critical-surface), and a clean whitespace check. GitHub Actions run
[`34288678323`](https://github.com/garthtrickett/gafu-v2/actions/runs/34288678323)
repeated the complete check/test/build/browser workflow successfully on PR #16.

## Open release gates

No private V1 data or owner credentials were available to automated tests.
Consequently this evidence closes implementation only. It does not claim that a
real V1 snapshot was accepted, that a representative series worked over
multiple days, or that a production backup restore was approved. V1 remains
the rollback product and neither legacy repository should be archived until the
owner checklist in [`../cutover.md`](../cutover.md) passes.

Inherited external gates also remain open: repository licence selection,
official Kaishi data availability, dictionary-grade sense authority, broader
grammar validation, and the paid-provider smoke run.
