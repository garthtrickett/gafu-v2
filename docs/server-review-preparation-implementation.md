# Server preparation implementation

Implements the [reviewed plan](server-review-preparation-plan.md). Server mode is
an explicit opt-in; migration preserves the prior off/background-tab choice.

## Ownership and execution

- Study provides a non-admitting due snapshot and Card/knowledge correction
  revisions. GET status and bank requests never consume the daily allowance.
  Explicit **Admit new Cards** and manual study starts retain admission.
- `learning-material/review-preparation.ts` coordinates one execution lane,
  coalesced wakeups and bounded periodic checks. Server mode drains groups of up
  to twenty without a client. While-open clients submit intent to the same lane.
- `batch-execution.ts` persists dispatch intent before the provider call, then
  its response ID and terminal output. Unique claims prevent competing work;
  per-target transactions make staged output replayable after interruption.
- Missing dispatch IDs and unavailable identified requests require recovery.
  At the 15-minute deadline, retrieve a known ID before deciding it is stuck:
  completed output is validated without another purchase. A request still
  confirmed queued can be cancelled and retried after one minute, only after
  the provider confirms cancellation. Three queue cancellations exhaust that
  batch's automatic retry allowance and apply the normal failure cooldown.
  Ambiguous cancellation and overdue in-progress work require recovery;
  abandoning an ID and buying again requires explicit duplicate-cost confirmation.
  Provider authentication pauses the lane; Retry-After defers it.
- `material-reserves.ts` owns current-context validation, reserve consumption
  and permit issuance. Warming neither marks material shown nor changes Study
  progress. Foreground serving replays an existing current review and its
  original permit before consuming another reserve.
- Answer authority checks Card and knowledge correction revisions inside the
  review transaction. A saved same-grade answer remains idempotent. Legacy
  permits without context cannot grade; locally validated ungraded legacy
  material can receive a replacement retaining the original expiry.
- `material-speech.ts` follows text independently, with one durable attempt per
  presentation/voice, daily limits and explicit recovery for uncertain speech.
  Disabling speech produces no new synthesis. Stale automatic speech is skipped;
  failed audio does not hide or regenerate valid text.

## Web and compatibility

`GET /api/study/preparation-status` and existing batch GETs only read local
state. Existing POST batch intents join shared work. Every production Study
serve path uses cache-only material access; a miss submits preparation intent.
The app opens ready material on entry, refreshes visible progress, and exposes
`off`, `whileOpen` and `server` settings plus recovery controls. Optional audio
appears independently. A study batch opens at most twenty Cards.
An active retry counts as preparing even if an earlier attempt's cooldown is
still present. A validated reserve takes precedence over either state.

Vocabulary identity accepts IPADIC's `名詞/副詞可能` words as their noun
identity as well as their adverbial use; arbitrary adverbs do not become nouns.
`Particle + の` also detects noun modifiers such as `からの`, `への`, and
`との`. Imported spelling or part-of-speech errors are corrected through
Study's Card update boundary, retaining the same Card, progress, and schedule.
A successful content correction clears that Card's generation cooldown and
wakes preparation; other Cards' failure pauses remain intact.

## Deployment and recovery

Study schema is **15**, Learning Material schema is **12**. Backup inspection
requires the new durable tables. Upgrade preserves pending work from older
parentless batches and retains provider IDs; unidentified legacy work stays
blocked instead of being bought again.

Offline restore and bootstrap durably write
`<databasePath>.preparation-paused` before data replacement. The runner retains
identified work but cannot start fresh generation/speech dispatches until an
authenticated reconciliation. This marker is outside the SQLite backup.

Use one process, one replica, the existing exclusive database lock and a
persistent volume. Disable Railway sleeping before enabling server mode.
`GAFU_AUTOMATIC_PREPARATION_DISABLED=1` stops new automatic dispatches; update
non-secret `GAFU_PROVIDER_CONFIGURATION_ID` when changing credentials. See the
[deployment runbook](railway-deployment.md#server-preparation-of-due-study-material).

## Verification

Acceptance fixtures use local providers, including 95-target draining,
closed-page browser completion, dispatch ambiguity, stored-ID restart, staged
response replay, authentication/rate-limit pauses, settings changes during
execution, stale answer authority, legacy permit recovery and backup markers.
The required type, unit, build and browser gates must pass before rollout.
No paid generation is part of these fixtures.
