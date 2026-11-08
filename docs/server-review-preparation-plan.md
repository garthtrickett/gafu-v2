# Server preparation of due Learning Material

**Status:** Reviewed implementation plan; three fresh-agent passes completed.
No runtime changes or automatic spending enabled.
**Date:** 2026-11-08
**Scope:** Gafu V2's existing private, single-learner Railway deployment.
**Sources:** [V2](../V2.md), [domain language](../CONTEXT.md),
[implementation architecture](../v2-impl.md), and
[one-writer deployment](adr/0007-private-railway-deployment-keeps-one-writer.md).

## 1. Outcome

When automatic server preparation is enabled, the server prepares fresh,
validated Learning Material for every eligible, already-admitted due Card,
whether a browser is open or the phone is locked. Opening the existing web app
serves those reserves through the normal authenticated study flow. No PWA,
browser background permission, push notification or new mobile app is required.

For 95 eligible due Cards with no reserves, the initial requests contain
20 + 20 + 20 + 20 + 15 targets. Each group is one LLM request, not twenty
single-target requests. Validation retries may add requests for the remaining
failed targets, bounded as described below. Ready Cards are usable while the
rest finish. A generation is never an admission, teaching acknowledgement,
presentation shown, Review Event, or schedule update.

This is a plan and review task. Implementation, production schema migration,
enabling the feature and paid generation are later work.

## 2. What exists and what must change

| Existing code | Current behavior | Planned use/change |
| --- | --- | --- |
| `src/study/browser.ts`, `prepareWhileHidden` | Hidden tab requests batches and polls until settled. Browser visibility and suspension control progress. | Browser displays preparation status; it no longer drives paid execution. |
| `src/study/server.ts`, review-batch routes | POST records a batch; GET advances it and may dispatch/poll paid provider work. | POST submits an intent; GET reads progress only. One server runner executes both foreground and automatic work. |
| `src/study/session-split.ts` | Shared review-before-teaching ordering, reserve-aware selection and stuck-Card rotation. | Reuse these rules; do not maintain a second queue policy in the runner. |
| `src/study/study.ts`, `studyQueue` | Reading this queue also admits staged Cards using the daily allowance. | Add a genuinely read-only due/preparation snapshot. Automatic preparation must not call this admitting operation. |
| `src/learning-material/learning-material.ts` | SQLite batches, provider response IDs, reserves, variation, validation, permits and 24-hour failure cooldown exist. Dispatch is persisted after the remote call. | Reuse stored material and batch concepts; add execution ownership, dispatch uncertainty, replay-safe settlement and current-context checks. |
| `src/learning-material/openai-provider.ts` | Whole-batch dispatch and polling use provider response IDs. No documented idempotent dispatch contract is exposed. | Preserve adapter; distinguish definitely-unsent failures from uncertain dispatch. Do not assume exactly-once remote billing. |
| `src/study/server.ts`, composition root | Owns the modules, server lifecycle and exclusive database lock. | Create/start/stop the runner here, injecting clock, wake/sleep and provider dependencies. |
| `src/recovery/backup.ts` | Exact schema inspection and offline restore. | Include new durable state in verification and define safe startup after restore. |

Two existing gaps must be fixed before enabling autonomous preparation:
reserve existence alone does not establish current validity, and browser locks
cannot coordinate browser requests with a server loop.

## 3. Product rules

### Eligible work

- Start from active, admitted Cards due now, using Study's existing due order,
  timezone rules and stuck-Card rotation. Reviews come before first exposures.
- Include both review and teaching material for already-admitted Cards. Never
  generate for staged, suspended, known-state or future-due Cards. The worker
  neither creates Cards nor spends tomorrow's admission allowance.
- Admission belongs to an explicit learner Study-start/Prepare action, not a
  read. Move every status/bank projection, including the legacy
  `GET /api/study/status` and its shared `statusSnapshot`, to the non-admitting
  snapshot. Those currently call admitting `studyQueue`; changing only the
  new runner would leave a hidden-tab admission path. Manual session-start or
  manual Prepare POST retains admission authority, then wakes the runner for
  the Cards it admitted. Crossing midnight or reopening status alone does not
  admit staged Cards; the UI explains how to start today's new Cards.
- Work only on a Card missing usable material for its current teach/review mode.
  An acknowledged/servable teaching presentation, an unshown reserve, and a
  currently issued presentation must be distinguished; do not buy replacement
  teaching merely because its first presentation was marked shown.
- One due Card is one target even if the provider proposes two candidates.
  Stop topping up once the Card has one usable reserve or a current presentation
  in the learner's session. Preserve bounded existing candidate spares; this is
  not an unlimited reserve-filling task.
- Explicit manual Prepare batch remains available, including while automatic
  preparation is off. It joins existing work rather than creating competing jobs.
- Generation uses the same target, known-language, naturalness and variation
  checks as ordinary Study. A failed review or Grammar Card stays due; a bare
  word never substitutes for its sentence. Preserve only the existing explicitly
  permitted vocabulary first-exposure fallback and label it honestly.

### Setting and spending

Introduce `automaticPreparation: off | whileOpen | server` rather than silently
expanding the old hidden-tab checkbox's spending authority:

- Existing `prepareInBackground=false` migrates to `off`; true migrates to
  `whileOpen`. The migration itself must not start unattended paid work.
- `server` explicitly means preparation continues with Gafu closed. The setting
  states that it uses the configured LLM and, when enabled, speech budget.
- `whileOpen` retains the existing meaning: an open hidden tab requests work,
  but execution belongs to the same server runner. Once submitted, a batch may
  finish if the tab closes; no further automatic groups are added without a
  qualifying client request. `off` stops new automatic dispatches.
- The new enum is authoritative. Legacy boolean true preserves an already
  selected `server` value; false disables automatic work. Conflicting new/old
  values in one request are rejected. Old clients cannot enable server mode.
- For this deployment, enabling `server` is an explicit rollout step after the
  owner accepts the implemented behavior. Keep an operator kill switch that
  prevents automatic dispatch without disabling ordinary reading or reviews.
- Reserve/readiness scans and empty polls make zero LLM or speech calls. Keep
  the current speech daily limit. With speech off, no synthesis request occurs.
- Text readiness is independent of audio readiness. Audio can finish later or
  fail without withholding a valid text review or causing text regeneration.

## 4. Architecture and module boundaries

Use one small application-level `ReviewPreparation` coordinator, composed in
the existing server process. It receives Study and Learning Material public
interfaces; neither deep module starts importing the other module's storage.
Do not introduce Redis, a generic job framework, another service, another
SQLite writer process, or an HTTP client that calls our own protected routes.

Suggested behavior-oriented operations, finalized in the first patch:

| Owner | Operation | Responsibility |
| --- | --- | --- |
| Study | `duePreparationSnapshot()` | Read admitted due Cards, current target/progress context and knowledge without admitting or modifying progress. |
| Learning Material | `preparationCoverage(context)` | Determine usable reserves, available teaching, issued material and blocked/in-flight targets under current validation rules. |
| ReviewPreparation | `requestPreparation(intent)` | Select missing targets, deduplicate, durably record or attach to work, and wake the runner. |
| ReviewPreparation | `status()` | Read counts and reasons without dispatching, validating or synthesizing. |
| ReviewPreparation | `start()` / `stop()` | Own one bounded asynchronous loop and its shutdown. |
| Learning Material | Batch claim/advance/settle | Own provider attempts, validation, reserves, execution fencing and persistence behind narrow operations. |

Prefer extracting the existing batch/reserve internals into focused parts of
Learning Material with characterization tests. Do not add more independent
state machines inside its already-large implementation file. Keep existing
typed `Result` failures and exhaustively translate them at the coordinator/UI.

### Single execution authority

- The existing deployment database lock and one replica remain mandatory.
- All paid Study generation paths participate: automatic preparation, manual
  review batches, direct `prepare` cache misses and legacy client polling.
  There must be no route that bypasses the coordinator to dispatch the same
  Card concurrently. Serving a ready reserve remains a fast path.
- A transaction claims a due target for one current preparation context; a
  unique active claim prevents two concurrent requests from buying it twice.
  At most one LLM batch is in flight per learner. Claims cover validation and
  publication as well as provider dispatch.
- An execution generation/token fences settlement. A stale asynchronous callback
  cannot publish or change a job owned by a later generation. Never hold a
  SQLite transaction open over a provider, analyzer or speech await.
- Manual work uses the same queue. Existing ready Cards can be served during
  another group; manual requests can prioritize the next group but cannot
  dispatch a duplicate or cancel a paid request just to reorder it.

## 5. Durable state and restart behavior

Extend Learning Material's existing `review_batch*` records; do not create a
parallel second queue for the same work. Add bounded durable fields/tables for
claims and per-request attempts where necessary:

- Origin (`manual`, `whileOpen`, `server`), intent identity, execution token,
  target ID, mode and target/progress/validation context.
- Batch membership and one shared immutable knowledge snapshot per group,
  never a full bank copied into every target or every idle scan.
- Attempt number, dispatch state/time, provider response ID when known, next
  poll/retry time, absolute deadline, and sanitized failure classification.
- Durable result staging after a terminal response is retrieved, before
  per-target asynchronous validation. Settlement can replay that response
  locally after a crash without repeating generation.
- A target's terminal disposition: banked, skipped as stale/no longer due,
  cooling down, or requiring explicit recovery.

State transitions:

| State | Next action and crash recovery |
| --- | --- |
| queued | Recheck preference, eligibility and coverage; claim only missing current targets. Safe to restart. |
| dispatching | Persist the attempt before making the remote request. No provider ID after interruption means uncertain, not automatically queued again. |
| running | Persist provider ID immediately. Resume polling that same response after restart; do not redispatch. |
| validating | Replay stored terminal response, validate and atomically publish each target's reserves plus its settlement state. |
| ready / skipped / failed | Terminal for that target/attempt; other targets proceed. |
| uncertain | Cannot prove whether the provider accepted a paid request. Block automatic repurchase of these targets; show a recovery action. |

No claim can remain busy forever just because the browser disappeared. On
startup, reconcile unfinished work before selecting fresh targets; expired
execution ownership is not evidence that a remote request never happened.
Known provider IDs are polled within their original deadlines. An expired or
unrecoverable ID becomes an explicit failed/recovery condition, not a silent
new paid request.

Exactly-once local publication is required. Exactly-once external charging is
not promised: a lost dispatch response has an unavoidable ambiguity unless
the provider offers and we verify a suitable idempotency/retrieval contract.
Do not invent request IDs that the provider does not actually honor.
An explicit retry of uncertain work must disclose possible duplicate cost;
legacy clients cannot silently confirm that retry.

## 6. Validity, consumption and concurrent study

- Add a Card material revision/epoch that changes with edits, relevant progress
  changes (including Again difficulty reset), teaching acknowledgement and
  suspension/state changes. Include mode and validator/prompt contracts in the
  preparation context. In-flight output for an obsolete context is not a ready
  reserve for the current review.
- Bind review permits to that Card material/progress epoch and to a Study-owned
  knowledge-correction epoch. Increment the latter when supporting knowledge is
  withdrawn/corrected, not merely expanded. A cached answer cannot retain
  authority after the presentation's context has been invalidated.
- Freeze input knowledge for each provider group; recheck actual target state
  and current supporting language before publishing and again before serving.
  A knowledge addition need not trigger a new LLM call: locally revalidate an
  existing reserve against the new snapshot. Revoked knowledge must not remain
  silently usable because a row says validated.
- Legacy reserves without context metadata require local current-context
  validation; quarantine those that cannot be trusted. Preserve already shown
  presentations and Review Events as history.
  Never blindly assign current authority to a legacy permit lacking context.
  Migrate it only with evidence of its issue context; otherwise keep the row
  but refuse new grades with a typed refresh-needed outcome. Authenticated
  recovery may locally validate ungraded material and issue a context-bound
  replacement where current due/mode and original issue-versus-review history
  establish eligibility; this need not buy new text. Document this compatibility
  exception and test legacy outbox recovery rather than silently trusting it.
- Coverage and the serving path use the same validity rule. An unusable reserve
  must neither suppress needed preparation nor appear as ready in the UI.
- After asynchronous validation, make a final synchronous Study context check
  immediately before the synchronous Learning Material claim/publication or
  consumption transaction, with no await between the check and write. The
  single-process exclusive writer is part of this guarantee. A changed context
  discards the attempt's current applicability without modifying Study state.
- Background preparation never sets `shown_at`, takes a reserve, issues a
  Presentation Permit, acknowledges teaching or grades. The usual authenticated
  serve operation rechecks due state, atomically takes one reserve and issues a
  fresh permit. Existing stale-answer/idempotent review rules remain intact.
- Enforce context at the answer boundary, not only serve/resume: after handling
  an already-recorded same-Card/same-grade replay under the existing permit
  lifetime rules, an unused permit must match the Card's current epoch and
  knowledge-correction epoch before a new Review Event can be committed.
  Check and increment the Card epoch in Study's answer transaction. A stale
  permit returns a typed refresh-needed outcome, leaves the schedule unchanged
  and cannot be revived just because the Card becomes due again. Conflicting
  grades on a used permit remain refused. Keep historical rows.
- Before taking another reserve, an authenticated serve/resume must look for
  the Card's current, unspent issued review in persistent storage. Return that
  exact payload with its existing permit after checking current due state,
  mode, material epoch and supporting language. This recovers a lost serve
  response or another browser with empty device storage immediately; existing
  `/session/resume` only filters client IDs and is not sufficient. Replay
  neither consumes a second reserve, issues a second permit, extends the
  original twelve-hour lifetime, nor calls the provider. Preserve same-grade
  idempotent replay and refusal of conflicting grades on that permit.
- Currently served Cards are protected by persisted issued-presentation state,
  not a browser-supplied exclusion list. A closed tab cannot suppress a Card
  forever: use the existing permit lifetime, retaining teaching for re-showing
  until acknowledgement. Expiry permits future preparation/serving.
- If a foreground review consumes a reserve or changes progress while a batch
  runs, other batch members finish normally. A stale completion cannot recreate
  a discarded pre-Again reserve or turn a suspended Card into ready work.

## 7. Scheduling, limits and failure policy

- Start after storage, provider configuration and recovery reconciliation are
  ready. Wake on startup, relevant settings/knowledge/Card changes, admission,
  teaching acknowledgement, review writes and material consumption. These
  wakeups coalesce; they never create a concurrent loop.
- Use a periodic check at most 60 seconds apart when enabled, shortened to the
  next due/retry time. This catches Cards becoming due without any browser.
  Idle ticks perform bounded local reads, not provider verification requests.
- Pick up to twenty missing targets; after settling a group, rescan current
  eligibility and continue until empty. The final group may be smaller. Do not
  wait to collect twenty when fewer are due.
- Keep at most three total validation rounds per target for its current work,
  with rejection reasons passed to the next request. Successful targets never
  re-enter subsequent rounds. A failed target waits 24 hours for automatic
  retry; it does not block later targets. Manual retry can bypass that cooldown,
  but not dispatch uncertainty or active-work deduplication.
- Provider authentication/permission failure pauses automatic dispatch until
  configuration changes. Rate-limit responses defer the whole provider lane
  with Retry-After (or bounded exponential backoff), not twenty Card failures.
  Transient poll failures retry the same provider ID within its deadline.
  Ambiguous dispatch failures follow the uncertainty rule above. Storage errors
  stop new paid dispatch while preserving work for recovery.
- Keep a 15-minute absolute generation deadline per request, short bounded
  transport calls and capped poll frequency. A poll never resets its deadline.
  Shutdown stops selection first, drains or aborts bounded local requests,
  leaves durable work resumable and closes the database last.
- Speech is a separate bounded, resumable best-effort follow-up to banked text,
  keyed by exact text and voice settings. No speech when disabled; no text
  repurchase because a clip failed. Uncertain speech dispatch must not create
  an unattended synthesis retry loop.
- Turning automatic preparation off stops new automatic dispatch, including
  retry rounds, but reconciles already-paid requests and retains valid results.
  It does not cancel manual work or affect due dates. Changing voice settings
  does not discard valid text. A process-wide emergency switch stops new paid
  automatic calls; already accepted provider work may still incur cost.

## 8. Existing web app and compatibility

Keep the protected web app and existing study endpoints. Add a read-only
preparation status projection, e.g. `GET /api/study/preparation-status`:

- due Cards partitioned into ready text, actively preparing, awaiting work,
  and blocked/failed, without subtracting failures from the SRS due count;
- current group size/progress and sanitized blocked reasons;
- automatic mode, last successful check and next retry/check time;
- audio readiness separately where useful.

Opening Study fetches stored coverage and serves ready material immediately;
it does not wait for all 95 Cards. Preserve explicit Prepare batch as a way to
open the next study session from ready material while attaching missing work
to the runner. Authenticated status polling reads existing state and cannot
start a remote job. Poll while visible and preparing; refresh on focus without
requiring a permanently open hidden tab.

Keep old batch response fields during the migration. Old POST requests attach
to the coordinator; old GET progress requests become read-only. The server
continues their submitted work so old tabs do not hang. An old tab cannot
enable server mode or bypass blocked/uncertain spending rules. Remove the old
hidden execution loop after the updated UI handles status and `whileOpen`
intent submission. Ordinary Firefox and mobile browsers remain supported.
Classify legacy `unpreparedOnly: true` POSTs as automatic and non-admitting;
manual session/Prepare intents may invoke Study admission. All GET status/bank
routes must be non-admitting even when called by an old hidden tab. Do not
rely on a new browser visibility check to enforce this on the server.

All work and status remain behind the existing private-access boundary.
The internal runner is not an unauthenticated HTTP/cron endpoint. Provider
secrets remain server-only; do not log Japanese bodies, knowledge snapshots,
raw provider payloads, permits or credentials. Diagnostics use counts, opaque
work IDs, durations and typed failures. Health distinguishes a healthy web
server from a paused or stuck preparation runner without making provider
outages block basic app startup.

## 9. Persistence, retention and deployment

- Keep the existing single Bun process and Railway volume. Explicitly disable
  sleeping/scale-to-zero for the enabled server-preparation deployment and keep
  one replica. A browser installation cannot compensate for a sleeping server.
  During a server/provider outage no new material is promised; restart resumes.
- Migrate Learning Material and Study versions as necessary. Update exact schema
  verification, backup/restore tests and startup compatibility together. Never
  erase Cards, schedules, review history, presentation history or permits to
  simplify an upgrade.
- Preserve old in-progress response IDs. Jobs from the old post-dispatch-ID
  protocol without a durable ID are treated as potentially uncertain on upgrade,
  not automatically re-bought. Completed existing reserves are revalidated.
- Restoring a backup uses an explicit preparation pause on first startup. Its
  historical queued/running/dispatching state cannot authorize fresh paid
  requests automatically; inspect known response IDs and reconcile or discard
  stale work before re-enabling. Never poll/reuse IDs under a different provider
  identity or credential configuration without confirmation.
  Implement this for every supported restore/bootstrap path by durably writing
  a pause marker beside the database **before** replacement; that marker is
  outside the SQLite backup and survives an interrupted restore. The runner
  checks it before automatic dispatch. Only an authenticated explicit re-enable
  after reconciliation clears it. Ordinary restarts without a restore marker
  resume normally. Raw volume-file replacement requires the same documented
  pause procedure; arbitrary external copying cannot be detected reliably
  from a restored database alone. Keep the existing offline/exclusive lock.
- Retain unfinished/uncertain work until explicitly reconciled. Finished batch
  metadata keeps the existing one-hour grace for browser references; prune only
  terminal unreferenced attempts/results afterwards. Delete shared snapshots
  only when no batch references them. Do not repeatedly store large knowledge
  banks on each tick. Keep one execution/summary row per active scope rather
  than an ever-growing idle heartbeat log.

## 10. Reviewable implementation patches

1. **Characterize and define the seams.** Freeze tests for foreground serving,
   teaching re-show, reserve consumption, whole batches and existing recovery.
   Add a non-admitting Study snapshot and typed coverage/context contracts;
   move legacy status/bank reads off admission and keep admission in explicit
   Study-start/manual Prepare actions;
   include a 5,000-Card bounded-query fixture. No worker or provider behavior
   changes in this patch.
2. **Make reserves and settlement current and replay-safe.** Introduce context
   metadata, current-language validation, atomic per-target settlement and
   consumption and answer-authority checks, including authenticated replay of
   an already-issued current review without waiting for expiry. Split focused
   Learning Material internals as needed;
   preserve opaque permits and review-write invariants. Add version migrations
   and backup inspection changes with their upgrade fixtures.
3. **Unify durable execution.** Add unique active claims, ownership fencing,
   dispatch intent/uncertainty and persisted terminal responses. Route all
   foreground generation through one execution authority. Batch GET becomes
   read-only only once a server executor completes submitted manual work.
4. **Add opt-in server scheduling.** Implement settings migration, startup
   recovery, coalesced wakes, 20-target draining, clocks/backoff, provider-wide
   failure pauses, shutdown and emergency stop. Keep automatic server mode off
   by migration default. Make speech independent of text completion.
5. **Connect the existing UI.** Add status and mode controls, remove hidden-tab
   execution ownership, preserve legacy protocol behavior, open ready sessions
   immediately and explain failed/uncertain work with actionable recovery.
6. **Pilot and enable.** Rehearse upgrade/restore on isolated data with fake
   providers, deploy with automatic dispatch disabled, verify health and old
   client compatibility, then explicitly enable this learner's server mode.
   Run a bounded real-provider smoke using the existing authorized credentials
   only when implementation/pilot authorization covers that spend. Validate
   closed-browser completion and inspect counts/cost before broader use.

Every runtime patch must pass `bun run check`, `bun test`, `bun run build`,
`bun run test:browser` and `git diff --check`. A Markdown-only plan does not
require builds, migrations, paid requests or production changes.

## 11. Required acceptance cases

1. **95 due:** five initial calls of 20/20/20/20/15; all successful Cards become
   servable with every client closed. Already prepared Cards make no new call.
2. **Empty and future:** repeated idle ticks use zero provider/speech requests;
   the next newly due Card is noticed within 60 seconds of normal enabled
   operation. Due counts remain honest when generation fails.
3. **Admission:** day rollover with staged Cards and a positive new-card limit
   does not admit them in the worker. Existing Study admission still shares one
   daily allowance; its admitted Cards can then be prepared automatically.
   Repeat with a pre-upgrade hidden tab's actual status/bank/batch request
   sequence across rollover; none of its automatic requests admits a Card.
4. **Races:** two tabs, a manual press, a direct cache miss and a worker tick
   select one target once; ready Cards remain immediately servable. Issued but
   ungraded Cards do not prompt paid reserve top-ups; abandoned permits expire.
   Lose a serve response, then serve again from a browser with no saved session:
   recover the same payload/permit immediately, spend nothing, retain its
   original expiry and record at most one Review Event across both clients.
5. **Crash matrix:** terminate before dispatch, during ambiguous dispatch, after
   a persisted provider ID, after result staging and during target settlement.
   Known jobs resume, uncertain jobs do not auto-resubmit, and local publication
   does not duplicate or lose successfully settled targets.
6. **Concurrent changes:** suspend/edit/grade Again/acknowledge teaching or revoke
   known language during generation and immediately before serving. Old context
   never becomes a current reserve or defeats the one-target rule. Adding known
   vocabulary can reuse locally revalidated text without a fresh LLM request.
   Submit an obsolete permit directly to `/api/study/session/answer` without
   serving/resuming first, including after another permit's answer and a later
   due time. It cannot create a new Review Event. A retry of the already-saved
   same-grade answer still returns its original result within permit rules.
7. **Failures:** partial invalid candidates retry only unresolved targets for
   at most three rounds; other groups proceed. Authentication pauses globally;
   429 respects provider delay; poll failures resume the same ID; storage failure
   and deadlines terminate visibly rather than leaving infinite preparing.
8. **Settings and audio:** off/whileOpen/server and kill-switch behavior, including
   changes mid-request, follow the stated spending policy. Speech off makes zero
   synthesis calls; failed audio does not hide valid text or regenerate it.
9. **Existing browser:** desktop Chromium/Firefox and mobile open ready material
   before the full queue finishes; reload and old tabs do not start duplicate
   jobs. Server progress continues while browser polling is entirely stopped.
10. **Recovery:** old schema upgrade and complete backup/restore preserve Cards,
    schedules, Review Events, reserves and permits; restored dispatch state
    cannot silently start a second paid workload. No credentials or private
    learning bodies appear in ordinary diagnostics.

## 12. Refinement record

1. **First independent pass:** fixed issued-review recovery after a lost serve
   response or empty client storage, and removed the legacy status/bank
   admission path. Added explicit compatibility and rollover acceptance cases.
   Also made the supported restore pause mechanism concrete rather than relying
   on implicit restore detection.
2. **Second independent pass:** bound answer authority to current Card and
   knowledge-correction epochs, with transactional checks on new Review Events.
   Added direct stale-permit submission and legacy-permit recovery cases;
   preserved idempotent replay of already-recorded answers.
3. **Third independent pass:** checked the revised plan against current queue,
   session, material, provider, settings and recovery code. Found no substantive
   issues and no optional wording changes worth another revision. Review loop
   complete; implementation remains a separate task.

Stop only when a new reviewer finds no unresolved correctness, spending,
recovery, architecture or user-workflow issue; optional wording or equivalent
naming preferences alone do not justify another implementation scope.
