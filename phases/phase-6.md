# Phase 6 — Migration, Reliability, and Replacement

**Status:** Refined implementation contract · 6.0  
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)  
**Product source:** [`../V2.md`](../V2.md)  
**Last updated:** 2026-09-08

## Goal

Make Gafu V2 safe to adopt with the learner's real history. Phase 6 provides an
auditable one-way bridge from the final V1 sync contract, proves whole-database
backup and replacement restore, exercises realistic local scale, adds
privacy-safe operational diagnostics, verifies the supported browser surface,
and publishes a reversible cutover runbook.

The implementation may finish without access to the owner's production data,
credentials, or devices. The product is not declared cut over—and V1 and
`jp-player` are not archived—until the owner runs the documented real-data
parallel gate. That external gate is a release decision, not something tests may
simulate or silently waive.

## Evidence from V1 and V2

V1's authenticated `/api/sync/pull` response is the smallest existing
learner-scoped export seam. It exposes the shared grammar/vocabulary catalogue,
the learner's `srs_card` projection, and New Cards/time-zone preferences. It
does not expose passwords, provider credentials, raw subtitle media, or a
complete immutable review log.

V1 and V2 do not share scheduler semantics. V1 stores an FSRS-lite projection
(`difficulty`, `stability`, repetitions, interval, last review, next review),
while V2 stores the complete `ts-fsrs` state used by its scheduler. Phase 6 must
not invent missing lapses, grades, or review events and label them historical
truth.

V2's one SQLite file contains Study and Preparation state. Study's serialized
backup already captures that complete file, but replacement restore, integrity
validation, pre-restore safety copy, and operator instructions do not yet exist.

## Phase boundaries

### In scope

- A versioned learner-scoped V1 Snapshot captured from the existing sync pull.
- Token custody through a process environment variable during snapshot fetch.
- Pure snapshot validation and deterministic reconciliation before writes.
- Dry-run and apply modes against an explicit V2 SQLite path.
- Idempotent import ledger, per-source mapping, and hashed quarantine evidence.
- Conservative Card, state, preference, and approximate schedule mapping.
- Whole-file backup inspection and offline destructive restore with a mandatory
  safety copy and explicit confirmation.
- Privacy-safe structured diagnostics and local health reporting.
- Explicit local release budgets with deterministic scale fixtures.
- Chromium primary journeys plus Firefox and mobile critical-surface journeys.
- A cutover/rollback runbook and maintenance/archive checklist.

### Out of scope

- Connecting V2 directly to V1 PostgreSQL.
- Importing users, passwords, sessions, JWTs, OpenAI keys, TTS credentials, or
  any other credential.
- Two-way sync, live dual writes, or mutating V1 from V2.
- Fabricating V1 review grades/events absent from the sync contract.
- Claiming an approximate V1 schedule is native V2 review history.
- Importing V1 generated exercises, raw media, subtitle bodies, local browser
  caches, encounter credit, or adaptive-media candidates.
- Automatically archiving either repository before the real-data gate passes.
- Expanding Phase 5's playback codec or subtitle-format envelope.

## Decisions frozen by this phase

### The V1 Snapshot is versioned, learner-scoped, and credential-free

`gafu-v1-sync-snapshot-v1` wraps one complete initial sync pull with:

- capture timestamp and source origin label;
- knowledge-point and grammar catalogue projections;
- only the authenticated learner's SRS progress rows;
- learner New Cards per Day and time zone; and
- no token, password, provider key, raw subtitle, exercise, or media payload.

The fetch command reads `GAFU_V1_BEARER_TOKEN` only from the process
environment. It accepts HTTPS origins or explicit loopback HTTP, performs the
epoch handshake, validates the response before writing, creates the snapshot
with owner-only permissions, and never logs the token or response bodies.

The importer also accepts an already-created snapshot file, so the migration is
repeatable after V1 is unavailable. Snapshot bytes are bounded and hashed. The
source hash—not learner content—is used for idempotency and diagnostics.

### Reconciliation is complete before apply

The importer joins each learner progress row to exactly one catalogue item by
V1 knowledge-point ID. Catalogue items without learner progress are skipped;
this avoids turning V1's whole curated catalogue into unseen V2 Cards.

Each progress row is assigned one disposition:

1. `mapped`: a new V2 Card can be created honestly;
2. `merged`: canonical identity or an earlier V1 source claim already maps to a
   V2 Card;
3. `skipped`: the row intentionally creates no V2 learner state;
4. `quarantined`: content or progress cannot be mapped without guessing; or
5. `invalid`: the snapshot violates its versioned structural contract.

The report totals every input row, gives stable reason codes, records no raw
learner content by default, and satisfies:

```text
progress rows = mapped + merged + skipped + quarantined
```

Any `invalid` snapshot blocks both dry run and apply. Quarantined rows do not
block unrelated valid rows, but the report makes them visible before apply.
Dry run opens an existing V2 database read-only and performs no migration,
preference, ledger, Card, or file write.

### Card and progress mapping is conservative

V1 vocabulary maps only when lemma, reading, part of speech, sense key, and
meaning are present. V1's stable sense key is retained as an additional
`gafu-v1-vocabulary-v1` Identity Claim; V2 canonical identity is still resolved
at apply time. Different senses are not merged by spelling.

V1 grammar contains canonical form and meaning but no formation. Its Card is
retained with an explicit `Formation unavailable in V1 snapshot` placeholder.
If V1 says `stable` or `known`, the Card maps to known because the learner had
already graduated it. Otherwise it is imported suspended and quarantined for a
formation edit; it cannot enter generated Study with invented grammar content.

V1 progress maps as follows:

| V1 fact | V2 result |
|---|---|
| `learning_state` is `stable` or `known` | known and support-ready |
| active vocabulary with finite valid FSRS-lite fields | active with an explicitly labelled V1-derived schedule |
| archived participation | suspended, retaining the mapped return state |
| vocabulary with no reviews and no introduction | staged with one migration Staging Source |
| malformed or impossible schedule/content | quarantined; no invented review history |

An imported active schedule retains due time, difficulty, stability,
repetitions, interval, and last-review time. Missing V1 fields take neutral
scheduler defaults only where the report labels the schedule approximate.
No V2 `review_event` is created: no V1 grade or Presentation Permit exists.

Existing V2 progress wins over imported active/staged progress. V1 known may
promote an existing staged/active Card to known, but import never downgrades
known or suspended state, deletes a schedule, or overwrites V2 review events.
The V1 source ID is attached to the resolved Card for future idempotency.

New Cards per Day and time zone are imported only when valid and only on the
first successful source apply. V1's review limit and mastery gate have no V2
equivalent and are reported as skipped. Provider credentials are never in the
contract and must be re-entered in V2.

### Apply is one transaction with a durable audit

Study schema 5 adds an import ledger, per-source reconciliation rows, and
quarantine rows. Apply revalidates and rebuilds the dry-run plan against the
current V2 database, then performs Card, identity, progress, schedule,
preference, and audit writes in one immediate transaction.

The same import key plus source digest returns the stored report and writes
nothing. Reusing an import key for different bytes is a typed conflict. A
forced failure leaves neither imported Cards nor a success ledger. The stored
report includes counts, reason codes, source IDs, resolved Card IDs, schema
versions, and source digest; quarantine stores only a record digest and reason,
not the raw source record.

### Restore is deliberately offline and replace-safe

Restore accepts only an explicit source backup, explicit destination database,
and `--confirm-replace`. It validates size, SQLite header, integrity check,
foreign-key check, exact supported Study schema, and supported Preparation
schema before touching the destination.

The local Gafu server must be stopped. Restore writes and validates a temporary
copy in the destination directory, creates a timestamped pre-restore copy of
the current destination when one exists, atomically renames the validated copy,
and then reopens it through Study and Preparation. Failure before replacement
leaves the destination unchanged; failure after replacement reports the safety
copy path for manual rollback.

Restoring into a clean destination is supported. Restoring into `:memory:`, a
directory, the same source path, a symlink target, or a running installation is
rejected. Provider credentials remain absent and must be re-entered.

### Diagnostics expose operations, never private bodies

The Migration module accepts the existing small Logger port. Events identify
operation, outcome, duration, schema versions, source digest prefix, and counts.
They exclude Card content, learner email, V1 IDs, subtitle/cue text, file bytes,
tokens, paths by default, and all credential values. Errors exposed to the CLI
are typed, actionable, and do not dump input records.

The local health command reports SQLite integrity, supported schema versions,
counts by Card state/type, pending/failed preparation batches, and provider-key
configured/not-configured. It does not expose generated material or source text.

### Release budgets are explicit

Reference budgets on CI-class Linux hardware are:

- validate and reconcile 5,000 V1 progress rows in under 2 seconds;
- list/status a 5,000-Card V2 database in under 1 second per operation;
- parse and activate a 10,000-cue SRT in under 2 seconds;
- render the local shell usable within 3 seconds in Chromium; and
- keep complete backup/restore memory below 512 MiB for a 128 MiB supported
  database.

Deterministic tests enforce the first three with generous CI-safe ceilings and
record exact durations as evidence. Paid provider latency is observed at the
adapter boundary but has no false deterministic SLA; timeout, throttle, retry,
and accepted-but-uncertain behavior remain the Phase 2/3 contracts.

### Browser support is a small tested matrix

Chromium runs every browser journey. Firefox runs the Study/Prepare/Watch
critical-surface smoke, including selectable Japanese and capture shortcut
configuration but excluding codecs not natively shared. A mobile Chromium
viewport proves navigation, Card controls, and Watch controls remain reachable
without horizontal overflow. Keyboard-only traversal and visible focus are
checked on the capture and restore/cutover surfaces.

## Module interface

```ts
type V1Migration = {
  inspect(snapshotBytes: Uint8Array, destinationPath: string):
    Result<MigrationReconciliation, MigrationFailure>;
  apply(command: ApplyMigration):
    Result<MigrationReconciliation, MigrationFailure>;
};

type BackupRecovery = {
  inspect(sourcePath: string): Result<BackupInspection, RecoveryFailure>;
  restore(command: RestoreBackup): Result<RestoreReceipt, RecoveryFailure>;
};
```

These interfaces hide JSON decoding, canonical reconciliation, SQLite rows,
temporary-file mechanics, source hashes, import ledgers, and audit storage.
Neither browser UI nor CLI writes Study tables directly.

## Patch plan

### Patch 6.1 — Refined migration and cutover contract

Freeze the real V1 sync evidence, mapping table, audit/quarantine semantics,
restore safety, diagnostics privacy, release budgets, browser matrix, and
external cutover gate in this document and the glossary.

**Gate:** every V1 field is mapped, skipped, or quarantined; nothing ambiguous
is described as lossless.

### Patch 6.2 — V1 Snapshot and reconciliation

Implement bounded snapshot parsing, authenticated epoch-aware fetch, pure
deterministic reconciliation, source hashing, and a dry-run CLI.

**Gate:** corrupt/oversized/wrong-version/cross-reference failures write
nothing; a mixed fixture accounts for every progress row and contains no
credential.

### Patch 6.3 — Atomic idempotent apply

Add Study migration 5 and apply the reconciliation with canonical identity
recheck, conservative state/schedule mapping, preference mapping, import ledger,
source claims, and hashed quarantine.

**Gate:** first apply maps/merges/quarantines as reported; exact retry is a
no-op; changed retry conflicts; forced failure rolls back every row.

### Patch 6.4 — Backup inspection and restore

Implement bounded integrity/schema inspection, offline confirmed replacement,
pre-restore copy, atomic rename, post-restore reopen, and CLI receipts.

**Gate:** exported mixed Study/Preparation data restores into a clean path and
reconciles exactly; corrupt/foreign/newer backups leave the destination byte-for-byte
unchanged.

### Patch 6.5 — Reliability, diagnostics, and scale

Add health reporting, redacted migration logs, deterministic large fixtures,
storage/write failures, restart/retry cases, and explicit timing evidence.

**Gate:** scale budgets pass and captured logs contain no fixture content,
tokens, credentials, raw records, subtitle bodies, or generated material.

### Patch 6.6 — Browser matrix and replacement runbook

Add Firefox/mobile critical journeys, keyboard/accessibility assertions,
operator commands, parallel-run reconciliation template, rollback procedure,
V1 maintenance notice, and the gated `jp-player` archive checklist.

**Gate:** automated supported-surface checks pass; the runbook cannot represent
the external real-data gate as complete without recorded owner evidence.

## Refinement scenarios

1. Snapshot is empty, oversized, malformed JSON, wrong version, or has unknown fields.
2. Epoch changes between V1 fetch requests or the token is absent/rejected.
3. V1 catalogue contains all points but progress references only a subset.
4. Progress references a missing, duplicate, wrong-kind, or quarantined point.
5. Grammar lacks formation; vocabulary lacks a sense key, meaning, reading, or POS.
6. Two V1 IDs canonicalize to one V2 Card; one spelling has two senses.
7. Destination already contains staged, active, known, or suspended matches.
8. V1 state is introduced, primed, encountered, learning, stable, known, or unknown.
9. V1 schedule has bad dates, NaN-like values, negative intervals, or no last review.
10. Preference limit is zero, above V2 maximum, fractional, or time zone invalid.
11. Dry run targets a missing database or an existing older/newer/corrupt database.
12. Apply is retried before/after success with the same/different source bytes.
13. Apply fails after Card, claim, progress, schedule, preference, or audit insertion.
14. Existing V2 reviews conflict with weaker V1 progress.
15. Backup is empty, truncated, huge, foreign SQLite, older, or newer than this binary.
16. Restore destination exists, is absent, is the source, is a symlink, or is in use.
17. Temp copy, safety copy, rename, post-open, or disk-space operation fails.
18. Restored database contains Study, Preparation, plans, capture evidence, and imports.
19. Provider rate limits, times out, or accepts a request before connection loss.
20. Browser restarts during analysis, capture confirmation, or after restore.
21. A 5,000-row migration and Card bank remain within release budgets.
22. Firefox differs in full screen/clipboard/codec behavior.
23. Mobile viewport and keyboard traversal expose every critical action.
24. Logs and reports are searched for tokens, emails, Card text, subtitle text, and paths.
25. Cutover fails after V2 import; rollback returns to untouched V1 and safety backup.

## Exit gate

Implementation closure requires:

- versioned V1 Snapshot fetch/file input and deterministic bounded dry run;
- complete auditable reconciliation with no guessed semantic mapping;
- atomic idempotent apply preserving stronger existing V2 learner state;
- validated confirmed restore into a clean installation with a safety copy;
- passing reliability, redaction, scale, Chromium, Firefox, mobile, and keyboard gates;
- published cutover and rollback instructions; and
- all repository checks passing from a clean checkout.

Release/cutover closure additionally requires owner-supplied evidence that a
real V1 snapshot dry-runs and imports exactly once, a representative real series
completes prepare → study → watch → capture over multiple days, the resulting V2
backup restores cleanly, and the owner accepts the reconciliation. Only then may
V1 become maintenance-only and `jp-player` be archived.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The evidence record must distinguish automated implementation closure from the
owner-only real-data release gate.

## Completion checklist

- [x] V1 evidence and every field mapping are explicit.
- [x] Dry-run, audit, quarantine, idempotency, and privacy are explicit.
- [x] Backup/restore safety and rollback are explicit.
- [x] Reliability budgets and browser matrix are explicit.
- [x] External cutover/archive authority is explicit.
- [ ] Snapshot fetch, validation, and dry run are implemented.
- [ ] Atomic import and audit are implemented.
- [ ] Backup inspection and restore are implemented.
- [ ] Reliability/scale and browser-matrix gates pass.
- [ ] Cutover documentation and implementation evidence are published.
- [ ] Owner real-data parallel run is recorded and accepted.
