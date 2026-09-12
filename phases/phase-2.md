# Phase 2 — AI-generated study material

**Status:** Implementation complete — external closure gates pending · 2.2  
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)  
**Product source:** [`../V2.md`](../V2.md)  
**Last updated:** 2026-09-08

## Goal

Turn an admitted Card into a complete teach-before-test study interaction using
fresh AI-generated Learning Material. The generator proposes material, but only
Gafu's local validation authority may make it displayable or issue the one-use
Presentation Permit that lets Study record an answer.

At the end of this phase a learner can configure an OpenAI API key in normal
settings, start Study, learn a new Grammar or Vocabulary Card, answer honestly, grade comprehension, and repeat the Card with materially different Japanese.
Malformed, unsafe, repetitive, unavailable, or unsupported material never
advances SRS.

## Phase boundaries

### In scope

- One provider-independent Learning Material workflow and typed failure union.
- An OpenAI Responses adapter and a deterministic scripted fake.
- In-memory server custody for the API key, supplied by the server environment
  and verified on first use.
- Structured teaching and review material for both Card types.
- Local validation of structure, readings, target identity and span, supporting
  vocabulary, declared supporting grammar, and recent-copy distance.
- A persisted pool of validated, not-yet-shown material for short provider
  outages.
- A teach acknowledgement before the first graded review of a new Card.
- A target-bound, expiring, one-use Presentation Permit accepted by Study.
- A minimum Study browser flow: start, teach or recall, answer, and grade.
- Safe development inspection of the exact provider request without the API
  key or provider response body appearing in ordinary logs.

### Out of scope

- Subtitle-derived targets, Subtitle Sets, Preparation Gaps, or Plans.
- Audio generation or recording.
- Watch, media playback, or subtitle capture.
- Multiple production AI providers, hosted accounts, or durable credential
  storage.
- Universal Japanese grammar recognition or independent dictionary-quality
  word-sense disambiguation.
- Fixed authored sentences as a production fallback.

## Decisions frozen by this phase

### One presentation lifecycle

The application shell coordinates Study and Learning Material through this
sequence:

1. Ask Study for the due queue and choose its first Card matching the session
   mode: the first untaught new Card for learn, the first other due Card for
   review, or simply the first due Card for a mixed start.
2. Read one Study-owned knowledge snapshot.
3. Ask Learning Material to `prepare` the Card using those immutable values.
4. If the Card's schedule is `new` and it has not been taught, return a
   `teach` presentation without a permit.
5. When the learner marks the teaching seen, persist that acknowledgement and
   end the encounter. The Card goes back in the queue; there is no chained
   review after first exposure.
6. A later start serves the taught Card as a `review` presentation, generated
   live when it is due. A review presentation is displayed front-first. Revealing it exposes the
   answer and grade controls but does not change Study.
7. The chosen grade and opaque permit are sent to Study. Study verifies and
   consumes the permit in the same transaction as its Review Event and FSRS
   transition.

Generation, validation, teaching acknowledgement, answering, and grading are
separate events. Refreshing, retrying, double-clicking, or losing an HTTP
response cannot manufacture a Review Event. A failed generation leaves the
Card due.

The first teaching acknowledgement is durable because a process restart must
not force the learner through the same introductory step forever. It records
only that this Card has been explicitly taught; it is not a review and cannot
earn support readiness.

### Validation authority

The provider is an untrusted proposal source. A strict JSON schema reduces bad
shapes but does not establish correctness. Gafu decodes and validates every
candidate again after receipt. The local validation chain checks:

1. every required field and enum;
2. NFKC Japanese reconstruction from reading segments;
3. a valid UTF-16 target span and exact surface match;
4. target lemma, reading, and broad part of speech for Vocabulary Cards, or the
   declared canonical construction and target span for Grammar Cards;
5. all non-target content words against the Known Word Bank;
6. all detected non-target grammar against support-ready Grammar Cards; and
7. exact and near-copy signatures against recently shown and queued material
   for the same Card.

Only a successful result is stored in the validated pool. Only a stored review
result can receive a Presentation Permit. Raw, rejected provider output is
neither displayed nor persisted.

Phase 0 proved this rule over a declared 22-construction grammar envelope, not
over all Japanese. Phase 2 therefore supports a Grammar Card as a target only
when its canonical form is in that envelope and returns
`unsupportedGrammarTarget` otherwise. Expanding the envelope requires frozen
positive and adversarial fixtures before enabling another form.

IPADIC supplies no trustworthy sense inventory. For a Vocabulary Card, Phase 2
can independently bind the observed token to the Card's lemma, reading, and
broad part of speech and require the structured answer to repeat the Card's
specific meaning. It cannot prove from Japanese alone that an ambiguous word is
used in precisely that English sense. That limitation is reported in evidence;
it is not described as dictionary-grade semantic validation. A trusted
dictionary claim can strengthen this seam later without changing Card IDs.

### Teaching and review material

Both modes contain:

- a short English situation that provides context without translating the
  answer;
- one natural Japanese sentence;
- complete reading segments whose written text reconstructs the sentence;
- the target surface and normalized target span;
- a concise prompt, answer, explanation, and usage note; and
- an explicit target kind and mode.

Vocabulary material also carries the requested lemma, reading, broad part of
speech, and specific meaning. Grammar material also carries canonical form and
a formation hint. These repeated target fields are checked against the Card;
they are not trusted merely because the provider emitted them.

In `teach` mode the browser initially shows the target, reading, meaning or
function, example, and explanation. In `review` mode it shows the situation
and the Japanese sentence with the target word coloured. An Explanation
button opens the answer, explanation, and usage note; only then do Correct
(`good`) and Incorrect (`again`) appear, and the scheduler never sees a
third option.

### Variation and fallback

One successful provider call requests three candidates for the same Card and
mode. Each is independently validated and deduplicated before it enters the
local pool. Serving a presentation atomically records it as shown.

Variation uses two versioned local signatures:

- `exact-v1`: SHA-256 of normalized Japanese; and
- `near-v1`: normalized Japanese character bigrams with the target surface
  replaced by a marker and punctuation and whitespace removed. Masking the
  target prevents a long construction from making every valid example look
  near-identical merely because it correctly repeats the target.

A candidate is rejected when its exact signature has appeared before for that
Card, or when bigram Jaccard similarity is at least `0.82` against any of the
last five shown or currently queued presentations for that Card. This is a
concrete lexical near-copy rule, not a claim of semantic similarity. Its
threshold and signature version are persisted so later changes do not rewrite
history.

`prepare` first serves an already-validated unshown candidate. For `review`,
if none exists, it calls the provider with recent Japanese and variation
instructions. It may make at most three provider attempts. A successful batch
normally leaves two validated candidates in reserve. On timeout, rate limit,
provider rejection, or offline failure, an unshown reserve candidate may be
served; invalid output does not trigger reuse of a rejected candidate. If no
safe reserve remains, the workflow returns `temporarilyUnavailable` and the
Card stays due.

For `teach` there is no provider call at all. First exposure shows only the
teaching presentation stored when the Card was made, served from the same
validated reserve. A new Card with nothing stored returns
`teachingNotPrepared` immediately — a fast, explicit onboarding gap rather
than a long provider wait that cannot succeed. Teaching is imported with the
cards CLI, which validates each sentence through the same validator before
storing it.

No validation-bypassing fallback exists. A Card carries a teaching
presentation written when it was made, so first exposure shows a sentence
chosen for it rather than waiting on the provider; it is stored only after
passing the same validator as generated material, and only for `teach`.
Review always generates, because varying the sentence is the point of a
review. Authored is not unvalidated: nothing reaches a learner that the
validator would have refused.

### Provider and credential boundary

The production adapter uses the OpenAI Responses API with strict structured
output. Requests set `store: false` and dispatch with `background: true`, so
the response id returns as soon as the request is queued and generation is
read over short polls; `timeoutMs` bounds one HTTP call while
`completionTimeoutMs` bounds the whole generation. Response output is located
by type rather than by array position; incomplete, failed, refused, malformed,
timed-out, rate-limited, unauthenticated, and forbidden responses become
distinct local failures. A poll that finds the dispatch gone from
provider-side retention is an offline failure, not a transport failure.

The model is a server-side configuration value with an explicit default and is
shown in settings. The API key is a deployment value: it is read from the
server environment at startup, retained only in process memory, and verified
against the provider on first use rather than at boot, so an unusable key is
reported where it is acted on instead of preventing the server from starting.
Settings report which provider and model are configured and whether the
environment supplied a key; there is no route, form, or session copy that could
disagree with the environment. Changing the key is a deployment operation. The
key never appears in JSON responses, SQLite, backups, model prompts, errors, or
logs.

Development inspection returns the exact redacted request body that would be
sent, including target and known-language constraints, but never returns
headers or credentials. It is disabled unless `GAFU_DEVELOPER_INSPECTION=1`.
The settings copy states that Card content and the supporting-language allowlist
are sent to OpenAI, response storage is disabled by Gafu, and the provider's
retention and abuse-monitoring policies still apply.

## Learning Material module

Learning Material is a deep module. Its caller supplies a target Card and a
Study snapshot; it does not query or mutate Study persistence.

```ts
type LearningMaterial = {
  prepare(input: PrepareMaterial): Promise<Result<PreparedMaterial, MaterialFailure>>;
  acknowledgeTeaching(input: AcknowledgeTeaching): Result<void, MaterialFailure>;
  providerStatus(): ProviderStatus;
  inspectLastRequest(): Result<RedactedProviderRequest, MaterialFailure>;
  permitVerifier: PresentationPermitVerifier;
  close(): void;
};
```

`PreparedMaterial` is either a teaching presentation without a permit or a
review presentation with an opaque permit. Provider payloads, prompts, database
rows, validation diagnostics, retry counters, and signatures remain private.

### Injected dependencies

- provider adapter;
- Japanese analyzer and declared grammar detector;
- clock and ID/token generators;
- SQLite database path;
- provider-key custody;
- retry and variation policy; and
- logger.

Tests use the real validator, SQLite tables, mutable clock, sequential IDs, and
a scripted provider. No test-only bypass is exposed by the production server.

## Persistence contract

Learning Material owns a separate forward-only migration ledger in the same
SQLite file and these concepts:

- validated presentation payload and target binding;
- exact and near-copy signatures with their versions;
- generated, shown, and most-recently-shown instants plus display count;
- durable first-teaching acknowledgement; and
- provider/model/prompt/validation versions used to create the material.

It does not persist API keys, rejected provider bodies, permits, review grades,
or schedules. The Study backup includes validated local material because all
learner-owned SQLite tables share one consistent file; it excludes credentials
by construction.

Permits are short-lived in process memory. Their opaque token is unpredictable,
bound to Card and validated material IDs, and expires under Study's existing
ten-minute rule. Study remains the final single-use authority because the
permit ID has a unique constraint in Review Events.

## Typed failures and recovery

Learning Material distinguishes at least:

- `cardNotDue` and `cardNotFound` at the application workflow boundary;
- `unsupportedGrammarTarget` and `unsupportedVocabularyPartOfSpeech`;
- `providerNotConfigured`, `authentication`, `permission`, `rateLimit`,
  `offline`, `timeout`, `cancelled`, `refusal`, and `incompleteResponse`;
- `malformedResponse` and `validationRejected` with safe reason kinds;
- `tooSimilar` and `noValidCandidate`;
- `teachingNotAcknowledged`, `teachingNotPrepared`, `presentationNotFound`, and
  `presentationAlreadyShown`; and
- migration, read, and write failures.

The browser maps these exhaustively to one action: configure credentials,
retry, acknowledge teaching, import a missing teaching presentation with the
cards CLI, correct an unsupported Card, or try again later.
Messages never contain request bodies, generated private text, or credentials.

## Server and browser flow

The local server adds narrow endpoints for provider status/key intents, starting
or continuing the first due study item, acknowledging teaching, and grading
through Study. It re-reads the authoritative
queue and Card before each transition; the browser cannot nominate a staged,
known, suspended, or not-due Card for a review.

The browser has three explicit states:

```text
idle -> preparing -> teaching -> idle
                  \-> unavailable
idle -> preparing -> recall -> revealed -> grading
                                       \-> unavailable
```

A new Card travels the first line; its first review travels the second on a
later start, when the Card is due. Recall shows the scene and sentence;
revealing opens the explanation; grading marks correct or incorrect.

Only `grading` invokes Study's `answer`. Leaving or refreshing any earlier state
does not change SRS. The comprehension buttons disable while the grade is in
flight, and repeated submissions reuse the same permit so Study's existing
idempotent rejection protects the schedule. A Card with no stored teaching
lands in `unavailable` with an import instruction instead of holding the
session open on the provider.

## Patch plan

### Patch 2.1 — Refined contract and ownership record

Freeze the lifecycle, validation envelope, failure union, variation algorithm,
fallback rule, credential disclosure, and module seam in this document. Add the
small glossary terms and the permit-ownership ADR.

**Gate:** every product requirement has one authority, every expected failure
has one recovery owner, and no design step requires Learning Material to write
Study state.

### Patch 2.2 — Material contracts, decoding, and variation

Expand the Phase 0 presentation contract to teaching/review material for both
Card types. Implement strict local decoding, target metadata checks, versioned
exact/near signatures, and deterministic variation tests.

**Gate:** malformed, mismatched, and repetitive candidates are rejected without
storage; materially different valid candidates retain stable signatures.

### Patch 2.3 — Provider seam, key settings, and safe inspection

Implement the scripted fake and OpenAI Responses adapter with strict schema,
typed status handling, `store: false`, bounded cancellation/timeout, redacted
request inspection, and browser key management.

**Gate:** fake tests cover every provider failure; key replacement is
verify-before-swap; key removal and restart behavior are visible; no secret
appears in responses, logs, inspection, or backup.

### Patch 2.4 — Validated pool, retry, and permits

Add Learning Material's migration, persisted validated pool, teaching
acknowledgement, bounded generation attempts, reserve selection, atomic show
record, and in-memory permit authority.

**Gate:** only independently validated material is stored or permitted;
concurrent preparation cannot show one reserve twice; provider outage uses only
an unshown validated reserve; restart preserves teaching and variation history.

### Patch 2.5 — Study workflow and browser slice

Compose Study and Learning Material in the local server. Add provider settings,
start/continue Study, teach, recall, answer, feedback, and grade UI states without moving
domain rules into the browser.

**Gate:** browser automation configures a fake/test key path, teaches a new
Card, reviews it, reloads, and sees the Study schedule advance exactly once.

### Patch 2.6 — Adversarial exit proof and evidence

Run both Card types through repeated varied study. Inject all specified invalid
and provider failures, verify they never display or create Review Events, test
restart/fallback/replay behavior, publish evidence, and update the parent plan.

**Gate:** the complete Phase 2 exit gate passes through public module/server
interfaces. A paid OpenAI smoke is recorded when a developer key is available;
its absence is an explicit external closure item, never replaced by fake proof.

### Patch 2.7 — Grammar-target span containment

Teach/review generation for suffix-morphology grammar targets cannot
validate. Proven for 受身形, same detector structure in 使役形, suspected in
可能形. Two consecutive production sessions after #63 (57.5s, 65.7s, no
timeout) returned `validationRejected` on every candidate, and a local run
through the real validator, analyzer, and production knowledge snapshot shows
the pair is unsatisfiable, not unlucky:

- Target presence (`grammarContainsTarget` in
  `src/learning-material/validator.ts`) requires the model-emitted
  `targetSpan` to EQUAL a detector regex match (e.g. `れた`, 4–6, in
  昨日買われた本が高い。). The provider prompt never states this; a
  model-natural whole-word span (買われた, 2–6) yields `targetAbsent` every
  time.
- The grammar-target-component exclusion only covers tokens INSIDE that
  two-character span, but the verb stem token (買われ, 2–5, reading かわれ)
  necessarily extends left of it, and its inflected reading never equals the
  dictionary reading (かう) — so the detector-exact span yields
  `unknownVocabulary` every time.

Change, in `src/learning-material/validator.ts`:

1. A grammar target is present when the emitted span CONTAINS a detector
   match for the target construction (`insideSpan(match, targetSpan)`), not
   only when equal.
2. Exclude any detected construction whose every span lies inside the target
   span, whatever its form — mirroring the vocabulary-target rule for a
   target word's own morphology. The same-form-anywhere exclusion stays, and
   a partially overlapping construction (e.g. 〜ている reaching past a
   passive span) still requires support-ready.
3. Document the convention in the Responses instructions (span the whole
   target word; the construction's detected form must fall inside it) and
   assert the sentence in the provider test.

Non-goals: the vocabulary path is untouched; `formationHint` exactness is
unchanged; the analyzer-tokenisation identity class (癒やし系, モテる, …) is
a different mechanism and stays out.

**Gate:** whole-word span accepted on an otherwise-clean sentence (a
detector-exact suffix span is no longer sufficient on its own: it leaves the
verb stem exposed as supporting vocabulary, which is the correct verdict for
a span that is not the word); a span containing no match still `targetAbsent`; fully-inside different-form excluded; partially-overlapping
different-form still required (rejected when not support-ready, accepted when
it is). Then the full required validation (`bun run check`, `bun test`,
`bun run build`, `bun run test:browser`, `git diff --check`). No migration:
old accepts are a subset of new accepts, so stored reserves stay valid.

**Backfill:** 受身形 is suspended. After merge and deploy, restore it alone
and run one timed session probe; on a 200 generated result, probe 使役形 and
可能形 (never suspended) the same way. Vocabulary identity-class suspensions
are a separate piece and stay suspended.

### Patch 2.9 — No chained review after teaching

Marking teaching seen ends the encounter: the route persists the
acknowledgement and returns, and the browser drops back to idle. The Card's
first review is prepared on a later start, when it is due — generated live,
like every review. Nothing about permits, Review Events, or the scheduler
changes; they simply happen at the first review instead of inside first
exposure.

**Gate:** the study journey sees teach, marks it seen, returns to idle, then
starts again into a live-generated review with the full answer/grade flow;
module tests still cover permits, idempotency, and the outage reserve; the
full required validation passes.

### Patch 2.10 — Separate learn-new from review

One Start button mixes first exposures and reviews, so neither flow can be
framed on its own. The server splits the same due set into two owned queues:
next untaught admitted (learn) and due taught-or-reviewing (review).

- `POST /api/study/learn` serves the next untaught card's stored teaching, or
  `teachingNotPrepared` when there is none. It never generates. Untaught
  cards without stored teaching are passed over looking for the first
  teachable one, so one gap never wedges the queue; anything else returns
  immediately.
- Review serving is unchanged per card; the browser's Review button asks for
  the next due card that is not an untaught new card, and reports `nothingDue`
  when there is none.
- First-exposure content contract: the authoring agent writes the sentence
  from the subtitle cue, and the Card meaning carries that subtitle sense, so
  the first thing seen means what the show meant. The validator cannot prove
  word sense from Japanese alone (see evidence); anchoring is by author
  discipline plus the meaning claim, not by a new check.

**Gate:** unit tests for both queue filters; the journey learns one new Card
through the Learn button and reviews through the Review button; the full
required validation passes.

### Patch 2.11 — Review batch job

One request per review means a waiting spinner per card. A review session
dispatches one job for up to 20 due-review cards, then works through the
completed ones with the existing per-card answer flow.

- `POST /api/study/review-batch` selects up to N due-review cards, records a
  `pending_review_batch` row (new table, forward-only migration), and returns
  `202` immediately. No generation happens inbound.
- `GET /api/study/review-batch/:id` advances the job one card per call —
  generate, validate, store — and reports
  `{ status, completed, failed, pending }`. No daemon: like preparation
  batches, progress is client-pumped and resumable across processes. A step
  cut short by the edge is retried as a fresh generation; carrying the
  dispatched provider id across processes (the #49 treatment for material) is
  a defined follow-up, not v1.
- The browser shows batch progress, then works through completed
  presentations with the unchanged recall/answer/grade flow, one permit per
  presentation. After each grade it serves the next batched Card on its own
  through a per-card prepare route (due check included), skipping anything
  already answered elsewhere; failed batch Cards are never attempted there.
  When none remains the batch closes. Failed cards stay due and listed, not
  hidden.

**Gate:** unit tests for select/advance/skip/resume; a journey dispatches a
batch, works it through, and records each grade exactly once; failed cards
stay due; the full required validation passes. No migration of existing
tables.

## Refinement scenarios

The implementation and tests must answer these without caller-side workarounds:

1. A new Card is opened and the learner tries to grade before teaching.
2. A teaching acknowledgement is repeated after its response is lost.
3. The provider returns the target only in metadata, not in Japanese.
4. A target surface exists twice and the declared span points to the wrong use.
5. Reading segments omit punctuation or reconstruct pre-normalized text.
6. A Vocabulary target has the right spelling but wrong reading or broad POS.
7. A Grammar target is outside the declared Phase 0 envelope.
8. One support word is absent from the Known Word Bank.
9. One detected non-target grammar form is not support-ready.
10. A provider batch contains one valid and two malformed candidates.
11. All three candidates are invalid across all three attempts.
12. A candidate is byte-different but exceeds the near-copy threshold.
13. Two concurrent prepares race for the same unshown reserve.
14. The provider times out after one successful batch left reserve material.
15. The provider fails and no safe reserve remains.
16. A permit is used for another Card, after expiry, or twice.
17. The browser refreshes before answering and after answering but before
continuing.
18. The server restarts after teaching and before the first review.
19. The environment supplies a key the provider rejects, or none at all.
20. An API key-shaped value appears in a provider exception.
21. The response has output text after a non-message output item.
22. OpenAI returns failed, incomplete, refusal, 401, 403, 429, or invalid JSON.
23. The environment supplies no key during a session with reserve material.
24. Backup is taken after generation and searched for credential fragments.
25. The Card is marked known or suspended while material generation is pending.
26. A new Card with no stored teaching is opened for study.

### Patch 2.8 — Teach is display-only

Study shows first exposure; it never generates it. `prepare` in `teach` mode
serves only the validated reserve and returns `teachingNotPrepared` when the
reserve is empty, without calling the provider. The browser maps that failure
to the `unavailable` state with an instruction to import teaching with the
cards CLI. Review keeps bounded provider attempts and the outage reserve.

**Gate:** a new Card without stored teaching fails fast with the provider
never called (pinned by an empty-script provider and a null last request);
stored teaching still teaches from reserve with no permit; the browser journey
attaches teaching through the public route and sees teach instantly; the full
required validation passes.

### Patch 2.12 — Compound vocabulary targets and だ-lemmatized adjectives

Implements 2.7 for grammar (presence by containment, inside-span exclusion
for supporting grammar, prompt documents the whole-word span) and extends the
same thinking to vocabulary. A vocabulary target is present when analyzer
tokens tile its span and concatenate to its lemma and reading; one token
keeps the old part-of-speech and sense checks, while a tiling carries no
per-component sense because the Card's identity claim covers the whole. A
な-adjective stem meets its copula-lemmatized token (肝心だ against the
claimed 肝心). Tokens inside the span are the word's own morphology, never
supporting language. The cards CLI locates the target with the same tiling
rule before sending.

Out of scope: analyzer misreadings (破れる read われる) and part-of-speech
mismatches (意地悪 analyzed as a noun against an adjective claim) stay
rejected; they are card-data or analyzer defects, not span semantics.

**Gate:** whole-word passive span accepted; outside-span constructions still
required; compound tiling accepted; だ-lemma accepted; covered-but-wrong form
still `wrongTargetIdentity`; CLI builds both new shapes; prompt asserts the
span sentence; the full required validation passes. No migration: old accepts
are a subset of new accepts, so stored reserves stay valid.

**Backfill:** restore the suspended compound, な-adjective, and suffix-grammar
cards after deploy, attach teaching for the blocked staged cards through the
CLI, and probe one live review generation per class.

### Patch 2.13 — Reviews ask correct-or-incorrect

A review is a check against the explanation, not a recall ceremony. It shows
the situation and the Japanese sentence with the target word coloured; an
Explanation button opens the answer, explanation, and usage note; only then
do Correct (`good`) and Incorrect (`again`) appear, and the scheduler never
sees a third option. Colouring is per segment: segments fully inside the
target span colour exactly, anything else falls back to overlapping segments,
and sentences whose segments do not rejoin stay uncoloured rather than
mis-coloured.

**Gate:** the journey reviews with nothing to recall from, opens the
explanation, marks one Card correct and the other incorrect, and records
both; module grades are untouched; the full required validation passes.

### Patch 2.14 — Status tiles show the two session queues

Seen it writes only a teaching acknowledgement: the Card stays active and
stays due, so the four tiles (staged, active, due, known) could not move and
the learner had no evidence the click did anything. Phase 1 already asked for
queue counts that distinguish learning from due; Patch 2.10 made the split
real on the server but never surfaced it.

- The browser snapshot carries `session.learnCount` and `session.reviewCount`,
  counted from the Card listing already in hand with the same rule Learn and
  Review serve by: due, new, and unacknowledged is Learn; everything else due
  is Review. Counting admits and prepares nothing.
- The due tile is replaced by "to learn" and "to review". Staged, active, and
  known are unchanged.
- The session-mode rule lives in one place (`session-split.ts`) and both the
  serving split and the counts read it, so the numbers cannot drift from the
  buttons.

**Gate:** unit tests for the mode rule and the counts, including a failed
teaching read failing the count; the journey watches one Card move from "to
learn" to "to review" on each Seen it; the full required validation passes.

## Exit gate

Phase 2 is implemented when all of the following are true:

- the same Grammar Card and Vocabulary Card can each be taught and graded more
  than once through fresh, materially different validated material;
- a first graded answer cannot occur before explicit teaching;
- malformed structure, missing target, bad span, reconstruction mismatch,
  wrong identity, unknown vocabulary, unknown grammar, exact copy, and near copy
  never reach the learner or receive a permit;
- timeout, provider refusal/rejection, authentication, permission, and rate
  limit failures create no Review Event and leave the Card due;
- an unshown validated reserve can bridge a temporary outage without a fixed or
  unvalidated fallback;
- permits remain target-bound, expiring, and single-use through restart and
  duplicate-request scenarios;
- provider key configure, verify, replace, remove, restart, redaction, and
  disclosure behaviors pass through normal settings without JSON import;
- request inspection is opt-in, exact apart from credentials, and contains no
  secret;
- the bounded grammar and vocabulary-sense limitations remain explicit in the
  UI/evidence; and
- all required checks pass from a clean checkout.

The phase can be implementation-complete without a paid provider key only when
the real adapter is contract-tested against recorded local response shapes and
the missing paid smoke is reported as an external closure gate. It cannot be
described as production-provider proven until that smoke succeeds.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The evidence report records exact commands, test counts, provider/model/prompt
versions, validation and variation versions, fallback/retry behavior, browser
journey, known limitations, and Phase 3 handoff.

## Completion checklist

- [x] Lifecycle, ownership, variation, fallback, privacy, and failure contracts
  are explicit.
- [x] Teaching/review material contracts and strict decoder are implemented.
- [x] Exact and near-copy validation is versioned and tested.
- [x] OpenAI and scripted provider adapters satisfy one narrow port.
- [x] API key management and safe request inspection work in settings.
- [x] Validated material, recent history, and teaching acknowledgement persist.
- [x] Only validated review material can issue a Presentation Permit.
- [x] Provider and validation failures never advance Study.
- [x] Both Card types complete repeated varied browser/module journeys.
- [x] Phase 2 evidence and parent-plan handoff are published.

Implementation is complete. Production-provider proof remains open until the
paid smoke succeeds; the Kaishi source and repository licence remain the
pre-existing external closure gates. See
[`../docs/evidence/phase-2.md`](../docs/evidence/phase-2.md).
