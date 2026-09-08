# Phase 4 — Preparation Plan and staged learning

**Status:** Implementation complete; external Kaishi, sense, grammar, provider, and licence gates pending · 4.1
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)  
**Product source:** [`../V2.md`](../V2.md)  
**Last updated:** 2026-09-08

## Goal

Turn one complete, learner-corrected Preparation Gap into a durable Preparation
Plan without creating duplicate Cards or a second pacing system. Preparation
produces an immutable Plan Draft from its own evidence. Study accepts that draft
through one atomic, idempotent operation, reuses or creates Cards, records why
they belong to the plan, and places unseen Cards behind the learner's existing
shared New Cards per Day allowance.

At the end of this phase, the learner can see which Cards block each episode,
when those Cards are expected to enter study, and whether an episode is ready.
Pausing, resuming, replacing, or deleting a plan never deletes a Card, review,
schedule, or support-ready fact.

## Phase boundaries

### In scope

- An immutable Plan Draft derived only from a complete, current Preparation run.
- An explicit, reversible default selection of included required and helpful
  findings; incidental, deferred, dismissed, known-for-set, and globally known
  findings are not selected by default.
- A blocking list for selected ambiguous Vocabulary findings and invalid Card
  content before any Study write occurs.
- One Study-owned `startPlan` transaction that creates/reuses Cards, records
  plan membership and evidence summaries, and registers staging sources.
- Idempotent start/replacement under retries, double-clicks, and lost responses.
- Deterministic priority across planned, manual, and future capture sources.
- One shared New Cards per Day allowance and admission history.
- Estimated first-introduction dates and per-episode readiness derived from
  current Study state, plan order, and the learner's preference.
- Pause, resume, replace, and delete semantics that preserve Cards and progress.
- A plan review/readiness browser journey and deterministic multi-day tests.

### Out of scope

- Video or audio playback, subtitle selection, or Subtitle Capture.
- Automatic completion from merely encountering a subtitle.
- A separate plan pace, daily review limit, deadline optimizer, or promise that
  the learner will open Gafu or answer correctly.
- Paid reanalysis for plan selection, Study changes, preference changes, or
  readiness refreshes.
- Editing Card identity from the plan screen. Identity corrections remain a
  Preparation action before the draft is started.

## Decisions frozen by this phase

### Default selection is useful, explicit, and reversible

The first Plan Draft selects findings whose disposition is `include`, whose
classification is `required` or `helpful`, whose relation is `missing` or
`existing`, and which are not known for this Subtitle Set. Incidental findings
remain inspectable and can be reclassified or explicitly included in
Preparation. Deferred and dismissed findings stay outside the draft.

The review screen lists the selected total, type/classification breakdown, and
every blocker. Starting is disabled while any selected missing Vocabulary
finding is ambiguous, lacks a stable sense ID, or lacks required Card content.
No top-N cap is applied. The learner changes the selection through existing
Preparation corrections, then asks for a new draft; the app does not maintain a
second contradictory selection store.

Grammar findings are identity-resolved by their declared canonical form.
Vocabulary findings require lemma, reading, broad part of speech, meaning, and
one learner-confirmed or provider-proposed stable sense label. The label is an
identity claim within the versioned Preparation authority; it is not described
as dictionary attestation.

### Plan Draft is the narrow Preparation-to-Study seam

Preparation exposes one additional behavior:

```ts
type Preparation = {
  // Phase 3 behaviors omitted
  planDraft(id: SubtitleSetId): Result<PlanDraft, PreparationFailure>;
};
```

The immutable draft contains:

- a deterministic draft digest and the Subtitle Set/source/run identity;
- a display title and ordered episode summaries;
- all selected targets in deterministic staging order;
- the identity claim and complete proposed Card content for missing targets;
- an attached Card ID for locally matched existing targets;
- classification, priority, rank reasons, and first-needed episode; and
- opaque cue evidence references needed for audit and readiness, never raw
  subtitle text.

It does not contain SQL rows, schedule internals, provider payloads, or mutable
Preparation state. Study validates the whole draft again before opening a
transaction. Preparation does not call `createCard` item by item.

The draft digest covers the source revision, analysis run, selection,
corrections, Card identity/content proposals, existing attachments, evidence
references, and deterministic order. The current Study comparison digest is
recorded for audit but does not force paid analysis. Study resolves every
identity claim again at commit time, so a newly created matching Card is reused
even when the draft's comparison snapshot is stale.

### Start and replacement are one atomic, idempotent Study operation

Study exposes:

```ts
type Study = {
  startPlan(command: StartPlan): Result<PlanSnapshot, StudyFailure>;
  listPlans(): Result<readonly PlanSummary[], StudyFailure>;
  plan(planId: PlanId): Result<PlanSnapshot, StudyFailure>;
  setPlanState(command: PlanStateCommand): Result<PlanSnapshot, StudyFailure>;
  deletePlan(planId: PlanId, confirmation: "delete"): Result<void, StudyFailure>;
};
```

`StartPlan` carries one client operation key plus the Plan Draft. Study validates
the complete draft before writing. One immediate SQLite transaction then:

1. returns the prior outcome when the operation key was already committed;
2. finds an existing plan for the same Subtitle Set or creates one;
3. resolves each attached Card and immutable identity claim against current
   Study state;
4. creates each genuinely missing Card exactly once;
5. replaces plan membership and evidence summaries with the draft revision;
6. registers one active staging source per staged member; and
7. records the operation outcome and committed draft digest.

Any invalid member, incompatible attached Card, identity conflict, or database
failure rolls back every step. An operation key reused with a different draft is
rejected. Repeating the same draft with a new operation key returns the same
plan and Cards without duplicate membership. A newer compatible draft updates
the existing plan while preserving all global Card state.

Plan membership is evidence and intent, not ownership of a Card. One Card may
belong to several plans and may also have been created manually. Membership
records the draft item, classification, priority, rank reasons, first need, and
cue references as committed facts for that plan revision.

### Staging has sources; admission remains global

A staged Card can have one or more **Staging Sources**. Phase 1 manual Card
creation registers a manual source. Phase 4 plan membership registers a plan
source. Phase 5 Subtitle Capture will register a capture source. This is stored
inside Study and is not a new public module.

Study admits a staged Card only when at least one source is active. Its effective
priority is the greatest active-source priority, followed by earliest source
creation and Card ID as stable tie-breakers. Plan priority is ordered by:

1. first-needed episode;
2. classification (`required` before `helpful`);
3. higher Preparation priority;
4. dependency readiness, with prerequisite Grammar Cards before dependent
   Vocabulary only when an explicit dependency exists; and
5. type, canonical identity, and finding key as deterministic tie-breakers.

No dependency is invented from subtitle co-occurrence. The initial draft has no
explicit dependency graph, so the first three signals plus stable tie-breakers
govern Phase 4.

Calling `studyQueue` still owns the one admission transaction. It counts all
Admission Events for the pinned local day and admits at most the remaining New
Cards per Day allowance across every source. Starting a plan never admits a
Card directly and changing the setting never rewrites prior Admission Events.

### Readiness is support readiness, not exposure or graduation

An episode is **ready** when every required plan member evidenced in that
episode is either globally known or support-ready. A required Card that is
staged, newly admitted, active but not support-ready, or suspended still blocks
readiness. Helpful Cards contribute to coverage and forecast but do not block
the ready state. Incidental findings are outside the plan unless reclassified.

This uses the existing support-ready rule: explicit learner confirmation, or two
successful recalls on different local days at least 20 hours apart. It avoids
inventing a second mastery threshold for media. A later episode can remain
blocked after an earlier one becomes ready. Overall series readiness is true
only when every episode is ready.

Coverage reports separate required ready/total and helpful ready/total rather
than combining them into a misleading percentage. Suspended blockers and Cards
with no active staging source are called out explicitly.

### Forecasts are deterministic estimates

The forecast answers when currently staged planned Cards can first enter study;
it does not predict successful recall. It simulates the shared queue from the
current admission window and New Cards per Day setting, retaining already
admitted Cards and all active staging sources from every origin. Existing
active-but-not-support-ready Cards are reported as `in study; readiness date
unknown` because future answers are unknowable.

For each episode the UI shows:

- earliest estimated local day by which all still-staged required Cards will
  have been introduced;
- count of required blockers already in study with unknown readiness date;
- count of required Cards with no active staging source; and
- `ready now` only from actual Study state.

A zero daily allowance yields no introduction date. Preference, plan state,
membership, new Card source, admission, support-ready, suspension, and clock-day
changes recompute the projection locally. Every date is labelled an estimate.

### Pause, resume, replace, and delete preserve learning

Pausing a plan disables only its Staging Sources. A Card remains eligible when a
manual, capture, or another active-plan source still requests it. Active Cards,
schedules, reviews, known/support-ready state, and prior admissions are never
paused or rewound.

Resuming re-enables current membership sources without consuming admission.
Replacing a plan revision removes obsolete plan membership/sources and adds the
new revision atomically. Cards absent from the new draft remain in the Card
bank with all progress. Deleting marks the plan deleted and disables/removes its
memberships and sources; it never deletes Cards. A repeated confirmed delete is
idempotent. Preparation source analysis and corrections remain independently
owned and are not deleted.

## Persistence contract

Study migration 3 adds module-owned tables for:

- Preparation Plan identity, source key, title, state, current draft digest,
  source revision, analysis run, timestamps, and revision number;
- Plan start operation key and committed outcome;
- plan membership with Card ID, finding key, classification, priority, first
  need, rank explanation, and proposed relation;
- opaque plan evidence references by episode/cue; and
- Card staging sources with kind, source key, priority, active state, and
  creation time.

Migration backfills one manual Staging Source for every existing staged Card so
upgrading cannot strand Phase 1–3 Cards. No Preparation table is queried or
foreign-keyed by Study. The SQLite backup already serializes these tables.

Preparation persistence does not need a new table: Plan Drafts are pure,
deterministic projections from the latest complete run, correction overlays,
and source evidence. The committed draft is copied into Study-owned membership
and audit rows so later Preparation deletion cannot erase the reason a Card was
created.

## Typed failures and recovery

Preparation adds explicit failures for incomplete/stale analysis, empty draft,
ambiguous target, invalid proposed Card, and missing evidence. Study adds
invalid draft, operation-key conflict, plan not found, incompatible existing
Card, plan state conflict, and delete confirmation failures. Expected identity
conflicts remain typed.

The browser maps these to correction, local recompare, refresh, or retry. A
server/database error can be retried with the same operation key. No error path
re-runs subtitle analysis or loops over independent Card-creation requests.

## Server and browser flow

The Prepare view extends the completed gap journey:

```text
complete gap -> review Plan Draft -> correct blockers -> start atomically
                                         |                 |
                                         +--local only-----+
                                                           v
                     plan readiness <- pause/resume/delete/update
```

The draft endpoint is read-only and returns complete counts and blockers. Start
accepts a browser-generated operation key and the draft digest; the server
rebuilds the current draft rather than trusting client-supplied Card content.
It then passes that server-owned value to Study. This prevents stale or edited
browser payloads from creating Cards.

The plan screen shows selected required/helpful totals, created/reused outcomes,
episode readiness, blockers, forecast, current New Cards per Day, pause/resume,
and explicit deletion. It links back to Preparation corrections. The UI renders
snapshots and does not calculate identity, order, readiness, or dates.

## Patch plan

### Patch 4.1 — Refined contract and domain language

Freeze Plan Draft, Staging Source, readiness, forecast, idempotency, replacement,
and lifecycle ownership in this document and the glossary.

**Gate:** every write and every derived status has one authority; the design
does not introduce a second queue, pace, mastery threshold, or paid analysis.

### Patch 4.2 — Immutable Plan Draft projection

Add Preparation's deterministic draft projection and validation from complete
findings, corrections, source order, and evidence references.

**Gate:** incomplete runs and ambiguous selected vocabulary fail before Study;
the same durable input yields the same digest and order across restart.

### Patch 4.3 — Atomic Study plan commit and staging sources

Add migration, `startPlan`, identity re-resolution, membership/evidence audit,
operation ledger, source-aware staging, and lifecycle transitions.

**Gate:** injected failures roll back all rows; same-key and new-key retries are
idempotent; existing Cards and schedules are byte-for-byte preserved.

### Patch 4.4 — Readiness and forecast projection

Project actual readiness and queue-based introduction estimates behind Study's
plan interface.

**Gate:** with a shared limit of three, a fourth Card from any source is not
admitted; completing required Cards changes only affected episode readiness.

### Patch 4.5 — Plan browser journey and closure evidence

Add draft review/start, plan details, pause/resume/delete, readiness/forecast UI,
browser coverage, evidence, and parent-plan handoff.

**Gate:** the complete multi-episode public journey passes all required checks
and a reload performs no provider call.

## Refinement scenarios

The implementation and tests must answer these without caller-side logic:

1. A complete run has required, helpful, incidental, deferred, dismissed, known,
   existing, and missing findings.
2. One selected Vocabulary finding is ambiguous or lacks a sense ID.
3. The learner corrects the blocker without re-running analysis.
4. A Plan Draft is regenerated before and after restart.
5. Study creates a matching Card after the draft but before start.
6. An attached existing Card has been corrected, known, suspended, or deleted
   before start.
7. Start fails on the first, middle, or last member write.
8. The learner double-clicks start or loses its successful response.
9. The same operation key is reused with changed input.
10. A new operation key submits the identical draft.
11. A later draft adds and removes members after some Cards have reviews.
12. One Card belongs to two plans and also has a manual staging source.
13. A plan is paused before admission, after partial admission, and after every
    member is active.
14. A paused plan is resumed on the same day after the allowance is exhausted.
15. A plan is deleted twice; its Cards and reviews survive.
16. Manual, plan, and capture-source Cards compete for a daily allowance of
    three with deterministic ordering.
17. The daily setting changes from three to one after three admissions, then to
    five on the same day.
18. The time zone changes without creating a second same-day allowance.
19. Episode one and two share a required Card; another Card blocks only episode
    two.
20. Required Cards are staged, active, support-ready, known, or suspended.
21. Helpful Cards remain unlearned while the episode becomes ready.
22. New Cards per Day is zero, and a required Card has no active source.
23. Existing active required Cards have no predictable success date.
24. Preparation analysis is deleted after the plan starts.
25. Ordinary logs and failures are searched for cue text and provider content.

## Exit gate

Phase 4 is complete when:

- only a complete corrected gap produces a deterministic Plan Draft;
- selected unresolved Vocabulary identity blocks every Study write;
- one atomic `startPlan` reuses current Cards, creates missing Cards once,
  retains evidence, and commits plan membership/order;
- retry, double-click, and replacement never duplicate Cards, membership,
  schedule, or admission;
- staged Cards from every source use one deterministic queue and shared New
  Cards per Day allowance;
- readiness depends on actual required Card support readiness, not exposure;
- forecasts are local, labelled estimates, and recompute without provider work;
- pause/resume/delete affect plan staging intent only and preserve all Cards and
  progress;
- deleting Preparation data after start does not erase committed plan audit;
  and
- all required checks pass from a clean checkout.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

Evidence records exact commands and counts, migration/backfill coverage,
atomicity/idempotency cases, shared-admission arbitration, readiness/forecast
scenarios, browser behavior, privacy inspection, and the Phase 5 handoff.

## Completion checklist

- [x] Default selection and blocker rules are explicit.
- [x] Plan Draft and Study transaction seam are explicit.
- [x] Staging-source arbitration and shared admission are explicit.
- [x] Readiness threshold and forecast limits are explicit.
- [x] Pause/resume/replace/delete ownership is explicit.
- [x] Deterministic Plan Draft projection is implemented.
- [x] Atomic Study plan commit and staging sources are implemented.
- [x] Readiness and forecast are implemented.
- [x] Plan browser journey and closure evidence pass.
