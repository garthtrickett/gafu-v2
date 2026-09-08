# Phase 1 — Card and SRS core, offline

**Status:** Implementation complete — production Kaishi source pending · 1.1
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)
**Product source:** [`../V2.md`](../V2.md)
**Last updated:** 2026-09-08

## Goal

Build Study as the sole authority for durable Cards, learner-owned study state,
the Known Word Bank, admission, scheduling, and review history. At the end of
this phase, those rules work offline through one small module interface and
survive a process restart in the local SQLite database selected in Phase 0.

Phase 1 deliberately proves learning state without inventing a fixed-sentence
product mode. Tests may inject prevalidated Learning Material to exercise a
review, but the browser cannot start a real review until Phase 2 can supply
fresh, validated AI-generated material.

## Phase boundaries

### In scope

- Canonical Grammar and Vocabulary Card identity.
- Editable Card content, immutable identity claims, and deterministic duplicate
  results.
- One learner-local study state and at most one schedule per Card.
- FSRS scheduling behind Study's interface.
- A shared, local-calendar New Cards per Day admission allowance.
- Typed review answers and append-only review history.
- Explicit known, suspend, restore, and support-readiness transitions.
- The Known Word Bank and an idempotent Kaishi baseline seed seam.
- SQLite migrations, transactions, restart recovery, and downloadable backup.
- Manual Card creation and minimum Card-bank/settings UI.
- Deterministic tests using injected clocks, IDs, scheduler parameters, and
  prevalidated presentation permits.

### Out of scope

- AI generation, provider calls, or a production review screen.
- Accepting arbitrary or permanently stored sentence material for study.
- Automatic Japanese analysis or dictionary search.
- Subtitle files, Preparation Gaps, Preparation Plans, readiness, or Watch.
- V1 import, accounts, sync, or multi-user authorization.
- Destructive restore. Phase 1 creates a verifiable backup; restore is proven in
  the replacement phase after the data contract has survived later phases.

## Decisions frozen by this phase

### Card and identity

- A Card has a generated immutable `CardId` and exactly one type.
- Semantic deduplication is enforced by immutable **Identity Claims**. An
  Identity Claim is a versioned, normalized assertion that a Card represents a
  particular grammar construction or vocabulary sense. Each claim can belong
  to only one Card.
- A Grammar Card's first claim is derived from its NFKC-normalized canonical
  form. Whitespace is collapsed and surrounding whitespace is removed; Japanese
  punctuation and meaningful internal characters are not discarded.
- A Vocabulary Card's first claim is derived from its NFKC-normalized lemma,
  hiragana-normalized reading, broad part of speech, and a required primary
  English sense. A Card still represents one meaning, not every dictionary
  sense for that spelling.
- The initial manual claim is named `gafu-manual-v1`. Later dictionary
  authorities may add their own claim to the same Card instead of replacing the
  Card ID or schedule. Phase 3 must leave an unresolved sense ambiguous rather
  than minting a guessed claim.
- Display content can be corrected without removing an earlier claim. The
  corrected normalized form is attached as another alias for future duplicate
  matching. If that alias already belongs to another Card, the whole correction
  is rejected; a correction that actually identifies a different construction
  or sense must become a different Card rather than silently moving history.
- Repeating the same create command returns `existing`, including after a
  retry or restart. It does not reset state, reorder admission, or add another
  schedule.

This claim model keeps Study independent of one external dictionary while
leaving a safe seam for a trusted sense authority. It does not claim that
normalizing two English glosses can prove semantic equivalence; only an exact
manual claim or a later authoritative claim is deduplicated automatically.

### Learner state and support readiness

Every Card has one learner-owned **Card State**:

- `staged`: unseen and waiting for the shared daily allowance;
- `active`: admitted and scheduled for learning or review;
- `known`: explicitly marked known and omitted from review;
- `suspended`: temporarily omitted from admission and review while preserving
  the state to which it will be restored.

State commands follow one table:

| Command | Allowed from | Result |
|---|---|---|
| `markKnown` | staged, active | known; remember the prior state and set support readiness |
| `markNotKnown` | known | restore the remembered staged/active state and clear support readiness |
| `suspend` | staged, active, known | suspended; remember the complete prior state |
| `restore` | suspended | restore the remembered state without changing admission or due time |

Repeating a command that already has the requested meaning is idempotent.
Commands whose meaning is ambiguous—for example `markNotKnown` on an active
Card—return `invalidStateTransition`. Suspending is a queue-management action
and does not itself revoke support readiness; the learner uses `markNotKnown`
to correct a mistaken knowledge assertion.

`supportReadyAt` is separate from Card State. It records that the Card may be
used as already-known supporting language in generated material. It is set by:

1. an explicit `markKnown` action; or
2. two non-`again` answers on different learner-local calendar days, with at
   least 20 hours between the answers.

Once earned, support readiness is monotonic until the learner explicitly marks
the Card as not known. A later lapse changes the FSRS schedule but does not make
previously usable language disappear from generation without warning.

A support-ready Vocabulary Card contributes its identity to the Known Word Bank.
A support-ready Grammar Card contributes to the learner's known grammar set.
Baseline Known Word entries have no Card and no schedule. The learner can
disable or re-enable a mistaken baseline entry independently.

### Scheduling and answers

- Study uses FSRS through a private scheduler adapter pinned to a specific
  implementation version and persisted parameter set. No FSRS shape crosses
  Study's public interface.
- The learner answers `again`, `hard`, `good`, or `easy`.
- Every accepted answer appends a Review Event containing the answer, review
  time, previous scheduling state, resulting scheduling state, and scheduler
  version. Existing history is never recomputed when code or settings change.
- All instants are persisted in UTC with millisecond precision. Calendar-day
  admission uses one persisted IANA time-zone preference.
- A time-zone change applies immediately to review-day recording. The current
  admission window remains pinned to its original zone until that local day
  rolls over, then the next window uses the new zone. Existing admission events
  keep their original local-day key and are never reclassified, so changing a
  setting cannot reset today's allowance.
- The injected clock is read once per Study command. No transition depends on
  wall-clock reads hidden inside helpers.

### Shared daily admission

- New Cards per Day defaults to 15 and accepts whole numbers from 0 through 100.
- Creating a Card stages it; it does not consume an allowance by itself.
- The first queue request for a local day atomically admits at most the unused
  allowance. Repeated or concurrent queue requests cannot admit more.
- Review Cards due at or before `now` are never limited by New Cards per Day.
- Admission ordering is deterministic: higher staging priority first, then
  earlier staging time, then Card ID. Manual Cards use neutral priority. Later
  phases may supply preparation priority through the same Study operation.
- Changing the setting affects only subsequent admissions. It never ejects an
  already admitted Card and never rewrites an admission or review event.
- The queue orders overdue reviews before learning Cards and newly admitted
  Cards, then by due time and Card ID. A Card occurs at most once.

## Study module

Study is a deep module. Callers know its domain inputs, snapshots, and typed
failures, but not table names, SQL transactions, FSRS records, baseline seed
mechanics, or backup locking.

```ts
type Study = {
  createCard(input: CreateCard): Result<CreateCardOutcome, StudyFailure>;
  listCards(query?: CardQuery): Result<readonly CardSummary[], StudyFailure>;
  updateCard(command: UpdateCard): Result<CardSummary, StudyFailure>;
  setCardState(command: SetCardState): Result<CardSummary, StudyFailure>;
  status(): Result<StudyStatus, StudyFailure>;
  studyQueue(): Result<StudyQueue, StudyFailure>;
  answer(command: AnswerCard): Result<AnswerOutcome, StudyFailure>;
  knowledgeSnapshot(): Result<KnowledgeSnapshot, StudyFailure>;
  preferences(): Result<StudyPreferences, StudyFailure>;
  setPreferences(change: PreferenceChange): Result<StudyPreferences, StudyFailure>;
  setBaselineWordEnabled(key: string, enabled: boolean): Result<KnowledgeSnapshot, StudyFailure>;
  exportBackup(): Result<StudyBackup, StudyFailure>;
  close(): void;
};
```

The concrete names may tighten during implementation, but the external seam
must remain behavior-oriented. The UI does not receive schedule internals and
does not coordinate a multi-step transaction.

### Dependencies created at the composition root

- SQLite database path;
- clock;
- Card ID generator;
- scheduler adapter and persisted scheduler version;
- Known Word baseline seed; and
- logger.

Production uses SQLite, system time, cryptographically random IDs, and the
selected FSRS adapter. Tests use a temporary or in-memory SQLite database,
mutable clock, sequential IDs, the same scheduler adapter, and synthetic seed
entries. The persistence seam is real because both database modes exercise the
same Study interface; there is no generic repository abstraction.

## Persistence contract

The initial forward-only schema owns these concepts:

- schema migration ledger;
- Cards and type-specific content;
- unique identity claims;
- Card State, suspended return state, and support readiness;
- one FSRS schedule per Card;
- staging priority and admission events;
- append-only Review Events;
- Study preferences and time-zone history;
- baseline Known Word entries and learner corrections; and
- seed version ledger.

The schema uses foreign keys and database constraints as the final defense for
type, uniqueness, and one-schedule invariants. Operations that change more than
one record use one immediate transaction. Constraint conflicts are translated
to domain outcomes or typed failures; SQLite messages do not escape Study.

Migrations:

- are ordered, immutable after merge, and recorded only after success;
- run before Study accepts commands;
- leave the database at the previous schema version if a migration fails;
- reject a database whose schema version is newer than this application; and
- are tested from an empty database and from the preceding committed fixture.

The backup operation takes one consistent SQLite snapshot and returns a
downloadable file with schema and creation metadata. It excludes API keys by
construction because Phase 0's provider-key store is process memory, not the
learner database. A backup failure cannot modify learner data.

## Kaishi baseline constraint

The Kaishi project publishes its deck without an explicit content licence in its
repository. Choosing Gafu's own repository licence cannot grant rights to that
third-party content, so Gafu does not copy Kaishi words, example sentences,
media, or deck files into this repository.

Phase 1 implements and tests an idempotent, versioned `KnownWordSeed` seam. The
production Kaishi seed is a closure gate: it must come from an owner-approved,
redistributable word/reading/sense manifest or an owner-approved import path.
Synthetic tests prove that seed entries become enabled Known Word Bank entries
without becoming Cards. The app must visibly report an unavailable baseline; it
must not silently pretend an empty bank is Kaishi 1.5k.

## Typed failures and recovery

Study owns a finite discriminated failure union. At minimum it distinguishes:

- database open, migration, read, write, and backup failures;
- invalid Card content or preference values;
- Card not found and illegal state transitions;
- presentation missing, invalid, or for the wrong Card;
- Card not currently answerable;
- clock or time-zone failure; and
- unsupported newer schema.

Duplicate creation is a successful `existing` outcome, not a failure. An
already-applied state command is idempotent when its meaning is unchanged.
Expected failures contain safe detail for presentation and a stable kind for
exhaustive handling. Unknown exceptions become typed failures at the SQLite,
clock, scheduler, or HTTP seam.

## Review permit

`answer` requires a short-lived **Presentation Permit** issued for the target
Card by the Learning Material seam. In Phase 1, only tests can inject a
prevalidated permit source. A permit contains no schedule and cannot answer a
different Card or be reused after an answer.

The verifier returns the permit ID, target Card ID, issue time, and validation
contract version. Study consumes the permit ID in the same transaction that
appends the Review Event and updates the schedule. A replay therefore returns a
typed `presentationAlreadyUsed` result even after an HTTP response is lost.
Permits expire after ten minutes, but an answer that began while the Card was due
does not become invalid merely because its due instant passed during the
presentation.

The production browser exposes Card management, settings, queue counts, and
backup only. It contains no fixture sentence, hidden review bypass, or endpoint
that manufactures a permit. Phase 2 connects the validated Learning Material
module and exposes study.

## Browser slice

The browser route provides:

- Card-bank list and type/search filters;
- manual Grammar and Vocabulary Card forms;
- explicit created-versus-existing feedback;
- editable display content with a clear warning that the immutable Identity
  Claim and existing progress do not silently move to a different sense;
- mark known, mark not known, suspend, and restore controls;
- New Cards per Day and IANA time-zone settings;
- queue counts that distinguish due, learning, and staged Cards;
- Known Word baseline availability and enabled count; and
- a backup download with clear success or typed failure feedback.

The browser renders snapshots and sends intents to the local server. It does not
duplicate canonicalization, state transition, admission, or scheduling rules.

## Patch plan

### Patch 1.1 — Domain contract and executable invariants

Define branded IDs, Card inputs/snapshots, identity normalization, Card State,
answers, Study failures, knowledge snapshots, and the injected-clock scenario
harness. Add property-style tests for canonical claims and illegal transitions.
Record only the hard-to-reverse identity and scheduling choices as ADRs.

**Gate:** both Card types produce stable claims; same semantic input normalizes
to the same claim; different vocabulary senses do not; all unions are handled
exhaustively.

### Patch 1.2 — SQLite ownership, migrations, and backup

Implement the Study database open path, forward-only migration ledger,
constraints, transaction wrapper internal to Study, restart tests, newer-schema
rejection, failed-migration rollback, and consistent backup.

**Gate:** an empty and previous-version database migrate to the same schema; an
injected multi-record failure leaves no partial Card; a backup opens as a valid
database and contains the committed learner state.

### Patch 1.3 — Cards, states, and Known Word Bank

Implement create/existing outcomes, list/search, display-content correction,
mark known/not known, suspend/restore, knowledge snapshots, and idempotent
versioned baseline seeding. Surface the missing production Kaishi seed honestly.

**Gate:** duplicate attempts reuse one Card and state; baseline entries never
create Cards; state changes survive restart; invalid transitions are typed.

### Patch 1.4 — Scheduler and shared admission

Add the pinned FSRS adapter, persisted schedules, deterministic staging,
local-day allowance, review events, support-readiness threshold, preferences,
and injected-clock tests across several days and a time-zone change.

**Gate:** no command or concurrent transaction can over-admit; reviews remain
available after the new limit is exhausted; changing the limit affects only
future admission; restart produces the same queue and schedule outcomes.

### Patch 1.5 — Local server and Card-bank browser slice

Expose narrow same-origin Study endpoints from the local Bun server, translate
every Study failure exhaustively, and replace the Phase 0 diagnostic home with
the Card bank/settings/backup UI. Keep the Phase 0 proof reachable as a
development diagnostic.

**Gate:** browser automation creates both Card types, sees an exact duplicate as
existing, changes settings, manages state, filters the bank, reloads without
loss, and downloads a non-empty backup. No study presentation is exposed.

### Patch 1.6 — Integrated offline study proof and closure

Through the same Study interface used by the server, inject validated permits,
admit Cards under a limit, answer across an injected clock, cross the support
threshold, close, reopen, and verify schedules and history. Publish Phase 1
evidence and update the parent plan.

**Gate:** the complete exit journey passes from a clean checkout. The only
permitted open closure item is the explicitly reported production Kaishi source;
all code paths and synthetic conformance tests for it must already be complete.

## Refinement scenarios

The implementation and tests must answer these without caller-side workarounds:

1. The same grammar is entered with full-width spaces and ordinary spaces.
2. Two Vocabulary Cards share spelling and reading but have different meanings.
3. The same create request is retried after its HTTP response is lost.
4. A Card is staged, the daily limit is lowered to zero, and the app reloads.
5. Two queue requests race for the final daily admission slot.
6. A learner crosses midnight in their configured zone while UTC remains on the
   same date.
7. The learner changes time zone after Cards were admitted that day.
8. A due review exists after today's new-card allowance is exhausted.
9. A permit is used for another Card or submitted twice.
10. A Card is suspended while staged, restored tomorrow, and then admitted.
11. A Card is suspended while active and later restored with its due time intact.
12. A known Card is marked not known and must return to study without losing
    history.
13. A corrected gloss leaves Card ID, schedule, and Review Events unchanged.
14. A failed transaction inserts neither the Card nor its claim/state/schedule.
15. Baseline seeding is interrupted and retried.
16. A baseline word is disabled and remains disabled after a newer seed version.
17. The application opens a database written by a newer incompatible version.
18. Backup fails while Cards remain readable and unchanged.

## Exit gate

Phase 1 is implemented when all of the following are true:

- one Grammar Card and one Vocabulary Card can be created through Study and the
  browser;
- repeated canonical create attempts return the same Card with one state and at
  most one schedule;
- the Cards can be admitted and reviewed with injected prevalidated permits
  across multiple learner-local days;
- the support threshold changes the correct knowledge snapshot once and does
  not turn Learning Material into the progress owner;
- closing and reopening the process preserves Cards, admissions, schedules,
  preferences, support readiness, and Review Events;
- New Cards per Day affects future admissions only and is shared across types;
- synthetic baseline words are known without being Cards, and production Kaishi
  availability is truthful;
- a downloadable backup can be opened and reconciled against the source counts;
- no production route can study fixed fixture material; and
- all required checks pass from a clean checkout.

Phase 1 is closed only when the owner-approved Kaishi source also supplies the
production baseline. If that source remains unavailable, the implementation is
reported as complete with one explicit data/licensing closure gate; it is not
mislabelled as a fully seeded product.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The evidence report records exact versions, commands, test counts, migration
fixtures, scheduler version/parameters, backup reconciliation, browser journey,
known limitations, and the Phase 2 handoff.

## Completion checklist

- [x] Card and Identity Claim contracts are explicit and executable.
- [x] SQLite schema v1 migrates atomically and rejects a newer schema.
- [x] Grammar and Vocabulary Cards create, deduplicate, update, and persist.
- [x] Known, not-known, suspended, and restored transitions preserve history.
- [x] Synthetic baseline seeding is atomic, idempotent, and correctable.
- [ ] An owner-approved production Kaishi 1.5k source is installed.
- [x] FSRS 6 schedules all admitted Cards behind the Study interface.
- [x] New Cards per Day is shared, deterministic, and resistant to time-zone
  reset.
- [x] Review permits are target-bound, expiring, and single-use.
- [x] Support readiness requires explicit knowledge or delayed recall.
- [x] Backup, restart, duplicate, migration, and bounded property gates pass.
- [x] The browser manages Cards/settings without exposing fixture study.
- [x] [`../docs/evidence/phase-1.md`](../docs/evidence/phase-1.md) records the
  result and Phase 2 handoff.
