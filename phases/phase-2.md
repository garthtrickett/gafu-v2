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
- Audio recording. (Spoken sentences arrived later as Patch 2.18.)
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
record, and in-memory permit authority (permits moved to the database in
Patch 2.25).

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
  when there is none. (Superseded by Patch 2.19: reviews run only through the
  batch.)
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

### Patch 2.14 — Status tiles partition the deck

Seen it writes only a teaching acknowledgement: the Card stays active and
stays due, so the four tiles (staged, active, due, known) could not move and
the learner had no evidence the click did anything. Phase 1 already asked for
queue counts that distinguish learning from due; Patch 2.10 made the split
real on the server but never surfaced it. The old row also overlapped: due
was a subset of active, so the numbers did not add up to the deck.

- The browser snapshot carries `session.learnCount`, `session.reviewCount`,
  and `session.laterCount`, bucketing the active Cards from the listing
  already in hand with the same rule Learn and Review serve by: due, new, and
  unacknowledged is Learn; everything else due is Review; not yet due is
  later. The three sum to the active count. Counting admits and prepares
  nothing.
- The tiles read staged, not due yet, to learn, to review, known. Every Card
  is in exactly one, so the row sums to the deck.
- The session-mode rule lives in one place (`session-split.ts`) and both the
  serving split and the counts read it, so the numbers cannot drift from the
  buttons.

**Gate:** unit tests for the mode rule and the buckets, including that the
three buckets cover exactly the active set and that a failed teaching read
fails the count; the journey watches one Card move from "to learn" to "to
review" on each Seen it; the full required validation passes.

### Patch 2.15 — Seen it serves the next Card to learn

Every Seen it dropped the learner back to the buttons, so working through a
day's new Cards was one Learn press per Card. Seen it now records the
acknowledgement and, in the same run, asks Learn for the next untaught Card
and shows it. Patch 2.9 stands: the taught Card is never chained into its
own review; only the next first exposure follows.

- When Learn has nothing teachable left (`teachingNotPrepared`), the chain
  ends on the buttons with "Nothing more to learn right now." That is the
  end of the session, not a failure.
- Any other failure after the acknowledgement surfaces as an error with the
  buttons back; the acknowledgement itself is already durable.
- The button reads "Seen it — next Card".

**Gate:** the journey presses Learn once and teaches two Cards through Seen
it alone, watching the tiles move each time, then lands on the buttons with
the end-of-session message; the full required validation passes.

### Patch 2.16 — Teach card reads as one sentence

Two presentation fixes on the teach card, from the operator's screen.

- Nothing sits between the pill and the sentence on a teach card. The
  context line was only "`<target>` in use.", and the prompt line repeated
  the answer box heading (target, reading, meaning), so both pushed the
  sentence down without adding anything. Review cards keep their context,
  which is the situation the sentence is read in.
- The coloured target word in the sentence is no longer bold. On a machine
  without a bold Japanese face the browser substituted a different font for
  just that word, so it rendered at a fraction of the size of its
  neighbours. Colour alone marks the target now.

**Gate:** the browser journeys pass unchanged; the full required validation
passes.

### Patch 2.17 — Highlight a word for Jisho

Carried over from V1. Dragging over a word in the sentence, on a teach or a
review card, opens a dictionary dialog for it. The browser cannot call
jisho.org directly (no CORS headers), so the server proxies one search.

- Selection is read by cloning the range and removing `rt` annotations:
  `Selection.toString()` interleaves furigana with the base text. The
  listener sits on the document, because a drag ends outside the sentence,
  and the range decides whether the highlight is in scope. A collapsed
  selection (a click) never raises a lookup.
- The term is reduced on both sides: whitespace collapsed, edge punctuation
  stripped, at most 24 characters, at least one Japanese character. Anything
  else is refused before it reaches jisho.org.
- `GET /api/dictionary/jisho?keyword=` sits behind private access like every
  API route, so the proxy is not an open relay. A 6-hour, 500-entry cache
  keeps repeated highlights off a free community API; failures are never
  cached. jisho.org's unversioned payload is treated as untrusted: an
  unreadable entry is dropped, an unreadable payload is "no entry".
- One lookup at a time; completion is term-guarded so a slow answer cannot
  land on a later highlight. Escape closes and clears the selection.
- Under the fake AI a deterministic dictionary answers, so journeys never
  reach the network.

**Gate:** unit tests for term reduction, payload reduction, and the proxy's
cache and failure behaviour; the journey highlights the target in a teach
sentence, sees the dialog, and closes it with Escape; the full required
validation passes.

### Patch 2.18 — Spoken sentences

Carried over from V1, where a Google voice said every review sentence and a
Listen button replayed it. V2 says sentences through the same OpenAI key that
generates them, because Railway holds no Google service account. Everything
above the provider is provider-agnostic.

- A generated review sentence is spoken when it is banked, concurrently for
  the candidates of one generation, so a later serve is instant. A
  presentation taken without a clip (an authored teach sentence, or a reserve
  banked before this patch) is spoken on first serve. Either way the clip is
  stored once per presentation and served from
  `GET /api/study/presentations/:id/audio` as an immutable private resource.
- Audio is an extra. No provider, the daily ceiling reached, or a failed
  synthesis leaves `audioUrl: null` and the sentence still serves. Material
  never waits on audio to fail.
- The daily ceiling (`GAFU_SPEECH_DAILY_LIMIT`, default 200) is an atomic
  conditional upsert per UTC day; cache hits do not count.
  `GAFU_SPEECH_DISABLED=1` turns clips off. Voice and model come from
  `GAFU_OPENAI_SPEECH_VOICE` and `GAFU_OPENAI_SPEECH_MODEL`; the provider's
  identity and a synthesis version are stored with each clip, so a voice
  change is visible per row and regeneration is a version bump, not a purge.
- The browser says the sentence once when a presentation with a clip is
  shown, including chained ones, and offers "🔊 Listen" with the `R` key. A
  refused autoplay is the browser's policy, not a fault.
- The fake speech provider returns a short silent WAV, so journeys exercise
  the whole clip path with no network.

**Gate:** unit tests for the OpenAI speech request, MP3 validation, and
failure mapping, and for the material module's eager and lazy synthesis, the
ceiling, and audio-less serving; the journey sees Listen on a teach card and
on a generated review, and fetches the clip; the full required validation
passes.

### Patch 2.19 — Review batch is the review

The single Review button generated one sentence per press with nothing on
screen but dimmed buttons, and a ready batch still asked for a Review press to
begin. Both go.

- The Review button and `POST /api/study/session/review` are removed. Review
  batch is the one way to review: dispatch, pump, then the first banked Card
  is served without another press, and grading chains the rest as before.
  Patch 2.10's Review button and the Review half of Patch 2.11's work-through
  are superseded here; their server routes for learn, batch, and per-card
  prepare are unchanged.
- While a session request is in flight the study panel names the wait with an
  elapsed-seconds counter: opening the next Card to learn, teaching seen,
  saving an answer, starting a batch, opening the first review. The batching
  line says why each Card takes 20 to 60 seconds: a fresh sentence is
  generated, checked, and spoken.

**Gate:** the journey dispatches a batch, sees the first review arrive on its
own with the wait named while its serve is held, then grades through; the
full required validation passes.

### Patch 2.20 — The bank says which Cards have no teaching

Learn walked past five due Cards with "This Card has no teaching yet" and no
way to tell which five. The snapshot now carries `taught` (acknowledged) and
`teachable` (a teach presentation is banked) per Card. The bank flags each
active or staged Card with neither, and the Learn message names the due Cards
it walked past, so the fix is a specific sentence to author.

**Gate:** the journey sees the flag on untaught Cards and not on taught ones,
and the Learn message names the Cards; the full required validation passes.

### Patch 2.21 — Teaching stays servable until it is seen

Taking a teach presentation set `shown_at`, and Learn only served unshown
reserves. A tab closed before Seen it therefore stranded the Card: no reserve,
no acknowledgement, `teachingNotPrepared` for ever. Four production Cards were
found in that state, two of them ones the operator had seen on screen.

Teaching is display-only (Patch 2.8), so re-showing it is harmless. When a
Card's unshown teach reserve is empty, Learn serves its most recently shown
teach presentation again; only a Card with no teach presentation at all fails
fast. `canTeach` (any teach presentation exists) replaces the unshown-reserve
check as the bank's `teachable` flag. Acknowledgement already accepted any
shown teach presentation, so Seen it on the re-served one works unchanged.

**Gate:** unit test takes teaching, skips the acknowledgement, and is served
the same presentation again, then acknowledges and moves to review; a Card
with nothing stored still fails fast; the full required validation passes.

### Patch 2.22 — One request for the whole batch

Patch 2.11 advanced a review batch one Card per poll, each poll running a
full generation: 20 Cards took about 12 minutes of strictly serial work. V1
sent one 15-Card request and dropped any Card that came back wrong, which was
rare. V2 does the same.

- The provider gains whole-batch generation: `dispatch` sends one background
  request naming every pending Card, with the learner's knowledge attached
  once and two candidates asked for per Card; `poll` checks on it. The first
  batch advance dispatches and records the provider job (`review_batch_job`,
  forward-only migration); later advances poll; the completing advance
  validates and banks every Card's candidates, marks each ready or failed,
  and speaks the banked sentences three at a time. No browser call outlives
  the generation.
- A Card the provider returns nothing usable for, or whose candidates all
  fail validation, fails alone with its reason and stays due. A provider-level
  failure fails every pending Card with its kind, so the learner batches
  again; nothing is retried inside the batch.
- Cards already holding a review reserve are marked ready without generation.
- A provider without whole-batch generation falls back to one Card per advance.

**Gate:** provider tests for the single request's shape and for dropping a
malformed item; batch tests for dispatch-then-complete, a dropped Card, and
banked reviews serving with no further calls; the journey unchanged; the full
required validation passes.

### Patch 2.23 — Refused sentences get two more rounds

The first production run of Patch 2.22 generated seven Cards and kept two:
with two candidates per Card and no second attempt, the validator's i+1
constraint dropped far more than the per-Card flow (three attempts of three)
ever did. V1 dropped rarely because its checks were looser; V2 keeps the
checks and retries instead.

- A Card whose candidates were all refused (or which the provider omitted)
  goes back into the next whole-batch request rather than failing, up to
  three rounds in all; the completing advance of one round leaves the next
  to dispatch. Rounds and the last refusal reasons live on the batch item
  (`attempts`, `hints_json`; forward-only migration).
- Refusal reasons now name the words at fault (`unknownVocabulary: 動物, 園`,
  `unknownGrammar: 〜ても`) and travel with the retried target as
  `previousRejections`, so the model is told what to avoid rather than asked
  to guess. Progress reports the round, and the batching line says so.

**Gate:** a Card refused in round one and accepted in round two completes
with the reasons visible in the second request; a Card refused in every
round is dropped after the third with `validationRejected`; the full
required validation passes.

### Patch 2.24 — A snapshot the size of the bank

Every click refetched `GET /api/study`: a megabyte, four-fifths of it the
1,437-word baseline listed twice, plus two teaching lookups per Card for
hundreds of Cards. From a distance that alone was most of a second per click.

- Knowledge leaves the bank snapshot for `GET /api/study/knowledge`, loaded
  when the baseline panel is opened or by the cards CLI; the snapshot keeps
  only the baseline's availability and enabled count. The snapshot is about a
  fifth of its former size.
- `GET /api/study/status` returns the tile counts alone. Session actions
  (learn, teach, batch) refetch that instead of the bank; a moved staged or
  active count means admission changed Card states, and only then is the
  bank refetched. Grades still refetch the bank, whose review counts they
  change.
- Teaching flags come from two set-valued queries for all Cards, not two
  queries per Card.

**Gate:** the deployment test reads the baseline summary from the snapshot
and the words from the knowledge route; the journey asserts knowledge is
absent from the snapshot; the full required validation passes.

### Patch 2.25 — The session comes down whole; writes go up behind

Every click waited on the server. V1 felt instant because the session lived
in the browser; V2 keeps scheduling, admission, and permits on the server
and gets the same feel by handing the browser the whole session at once and
sending its writes in the background.

- `POST /api/study/session/learn-all` prepares every untaught due Card with
  stored teaching together; `POST /api/study/session/review-all` prepares
  every banked review a finished batch names, never generating. Both fill
  missing clips and return the presentations as one list.
- The browser walks the list. Seen it and each grade go to an outbox and the
  next Card shows at once; the clip after the current one is fetched ahead.
  The outbox sends in order, retries transport failures with backoff, and
  records a refused write rather than resending it (the Card stays due).
  "Syncing N" shows while anything is queued, a failed write is named, and
  leaving the page with writes queued asks first. When the queue drains the
  bank is refetched, since grades change it.
- Permits now live in the database and last twelve hours, because a session
  can outlast ten minutes and a deploy must not strand its answers. They stay
  target-bound and single-use: Review Events hold the permit id uniquely.
  Patch 2.4's in-memory permit authority is superseded by this.
- Out of scope here, as agreed: a persisted outbox and offline study are the
  next patch; client-side scheduling stays out for good.

**Gate:** outbox tests for order, retry, give-up, and refusal; a permit
survives a restart and expires after twelve hours; the journey holds the
first acknowledgement and the first grade and sees the next Card on screen
with "Syncing 1" before either is released; the full required validation
passes.

### Patch 2.26 — The device remembers

Patch 2.25 made clicks instant while the tab lived; a reload or a lost
connection still lost the session and its queued writes. Now the device
keeps them, and a session already downloaded works with no network.

- The outbox is plain data in IndexedDB until each write is sent; a new page
  restores and sends what the old one left. When the browser reports itself
  offline the outbox stalls at once instead of retrying, and resumes on the
  `online` event or a half-minute check. A refused write is still recorded,
  never resent.
- The session in progress and the last bank snapshot are saved too. A load
  paints from the saved bank at once, resumes the saved session at its Card,
  restores the outbox, then asks the server for the latest; a load with no
  network says so and keeps what is here.
- A service worker keeps the signed-in page, its hashed assets, the analyzer
  dictionary, and every spoken clip fetched. Navigation prefers the network
  so a deploy shows up; everything else immutable is cache-first. API calls
  are never cached: the server stays authoritative.
- A grade's answer updates the bank Card in place; the bank is no longer
  refetched when the outbox drains, only the tile counts.
- The outbox delivers at least once, so Study answers a replay — the same
  grade for the same Card on a permit already spent — as the first time did
  and records nothing; a different grade on a spent permit is still refused.
  Study's own permit lifetime, formerly a separate ten minutes, is the shared
  twelve hours.

**Gate:** outbox tests for stall-and-resume and for restoring a queue from
the store; the journey grades with the network gone, reloads from the worker
with the second Card and the queued grade intact, and sees the grade sent
when the network returns; the full required validation passes.

### Patch 2.27 — Known Cards graduate into rotation

The 296 Cards a V1 dismissal left in `known` were never going to be seen
again, which was not the operator's intent: they are known well enough to
review rarely, not never. Patch 1.7's backfill plan (flip to staged with
taught markers, absorbed under the daily allowance) is superseded.

- `graduateKnown({ spreadDays, dryRun })` moves every `known` Card to
  `active` with a synthesised graduated schedule: FSRS review phase, past its
  learning steps, three repetitions, no lapses, default difficulty, and a
  stability equal to the interval it is given. Intervals run from one day to
  `spreadDays`, evenly in bank order, so the first reviews arrive a few a
  day rather than all at once; each later review is FSRS's own.
- Admission is dated to the day the Card was staged, so graduating hundreds
  leaves today's new-Card allowance alone. Support readiness is kept: these
  Cards' language counts as known. A grammar form the generator cannot serve
  is skipped and reported, never activated into a queue it would jam.
- `POST /api/study/known/graduate` runs it; `bun run known:graduate` downloads
  a backup first, prints the plan per day, and writes only with `--commit`.

**Gate:** a unit test graduates six of seven Cards over three days, two a
day from tomorrow, leaves the seventh (unsupported) in place, keeps today's
allowance and queue empty, and answers a graduated Card two days later
through FSRS; the full required validation passes.

### Patch 2.28 — Ruby only over the kanji

A reading segment can be a whole phrase, and the splitter trimmed only the
kana the two ends agreed on, stopping at punctuation: 噂だけでなく、 carried
うわさだけでなく、 over the lot. The reading is now aligned to the writing:
every non-kanji run must appear literally in the reading (katakana and
hiragana taken as the same syllables), and what each kanji run captures is
its furigana. Kana before, between, and after kanji stand as themselves. A
reading the writing cannot explain falls back to the old trimming, so nothing
renders worse than before. The cards CLI preview uses the same alignment.

**Gate:** unit tests for edge punctuation, kana between kanji runs, katakana
writing, the fallback, and text recoverability; the full required validation
passes.

### Patch 2.29 — The scene must not give the word away, and the card says its kind

"You are putting items into a box." above 箱に詰める。 left nothing to recall:
the context paraphrased the target. The generation instructions (single and
whole-batch; prompt version `study-v3`) now ask for a one-sentence scene —
who, where, mood — that must not state, paraphrase, translate, or hint at
the target's meaning or action, such that the context alone cannot give the
target away, and never restates the Japanese in English. The validator
cannot check this semantically; it is asked for, and reserves banked under
`study-v2` keep their old contexts until they are shown.

Every teach and review card now carries a second pill naming its kind,
vocabulary or grammar, so the learner knows what is being asked before
reading the sentence.

**Gate:** provider tests assert the instruction in both request shapes; the
journey sees the kind pill on a taught card; the full required validation
passes.

### Patch 2.30 — Grade by key

`e` opens a review's explanation; `c` and `i` then grade it as Correct or
Incorrect, only while the explanation is open; `r` hears the sentence again. The buttons
show their keys; the accessible names stay "Correct" and "Incorrect".
Letters typed into a field are never taken as shortcuts.

**Gate:** the journey grades one review by button and one by key; the full
required validation passes.

### Patch 2.31 — V1's voice, when its key is present

The operator heard the difference: V1 spoke through Google's `ja-JP-Neural2-B`,
a native Japanese neural voice; V2 had OpenAI's general voice speaking
Japanese with an accent, slowed after the fact, which blurs.

- A Google Cloud Text-to-Speech provider over REST with an API key
  (`GAFU_GOOGLE_TTS_API_KEY`), V1's settings exactly: `ja-JP-Neural2-B`, MP3,
  speaking rate 0.95. When the key is set it speaks; otherwise OpenAI stands
  in at natural speed.
- Each stored clip records the voice that made it. A clip from another
  provider, voice, or synthesis version is re-spoken by the current voice the
  next time its sentence is served, so a voice change reaches banked material
  without a purge; a failed re-synthesis keeps the old clip.

**Gate:** provider tests for the request, key handling, status mapping, and
MP3 checking; a material test re-speaks a clip under a new voice once and
keeps it; the full required validation passes.

### Patch 2.32 — The target is coloured by its span

The target colour was applied per reading segment, and a model may hand
back one segment for the whole sentence, so the entire line turned yellow.
Colouring now follows the target's character span: plain text is cut at the
span's edges, a kanji run with a reading is coloured whole if it overlaps the
span, and segments that do not rejoin into the sentence colour nothing.

Spaces a model puts between words in a reading are ignored when aligning,
and a ruby run that dwarfs the target span — the whole-sentence fallback —
is never coloured, since that would paint the line rather than the word.

**Gate:** unit tests for a single-segment sentence, a segmented one, a
straddling kanji run, a spaced reading, a kana-only target, the
whole-sentence fallback, and non-rejoining segments; the full required
validation passes.

### Patch 2.33 — Reviewing starts as Cards land

The batch waited for every Card, including retry rounds, before the first
review opened. Now each poll hands over whatever has become ready: Cards
that already held a reserve on the first poll, the rest as each round lands.
A landing opens the session if the learner is waiting, or is appended to the
running session. Finishing the Cards in hand while more are still being
prepared says so, and the next landing opens on its own; the batch closes
once everything has landed and been worked through.

**Gate:** the journey unchanged (under the fake AI the batch lands whole);
the full required validation passes.

### Patch 2.34 — A lapse is seen again tomorrow

FSRS ran with short-term steps: 1 and 10 minutes for new Cards, 10 minutes
after a lapse, so an Incorrect brought the Card back within the day. The
spacing literature puts the useful gap at a fraction of the retention
interval, days not minutes; the feedback shown with the answer is the repair,
and same-day re-tests add little that survives to the next day. Short-term
steps are off (`gafu-parameters-v2`): a first success and a lapse are both
scheduled by stability, tomorrow at the earliest. (Patch 2.52 restores the
steps for new Cards; the lapse rule here stands.) Teaching remains the
separate first exposure before any review. Existing schedules and review
history are untouched; the new rule applies from the next answer.

**Gate:** scheduler tests for a first success landing in review tomorrow or
later and a lapse returning after at least a day; the full required
validation passes.

### Patch 2.35 — Jisho on Alt, and "I don't know this word" in the dialog

Every drag over the sentence opened the dictionary, which got in the way of
plain reading. Now a highlight does nothing until Alt is pressed (Option on
a Mac; browsers report both as `Alt`). The hint under the sentence says so.

The dialog also says whether the word counts as known: one of the learner's
own Cards, an enabled or disabled Known Word baseline entry (matched on the
term, or any form or reading Jisho returned), or neither. A baseline entry
carries the switch — "I don't know this word" or "Restore as known" — so a
word the validator has been allowing can be turned off where it was met.

**Gate:** the journey highlights the target, sees no dialog, presses Alt,
sees the dialog and that the word is one of its Cards; the full required
validation passes.

### Patch 2.36 — A failed Card says why

"1 failed and stay due" named neither the Card nor the cause, and the
reasons the validator gave were kept only until the next round overwrote
them. The final round's reasons are now stored with the failure, returned
with the batch progress, and listed under it by Card: the word the sentence
leaned on, the identity check it missed, or the provider failure kind.

**Gate:** batch tests see the reasons on a dropped Card; the full required
validation passes.

### Patch 2.37 — The known tile goes

The `known` state is a retirement nothing enters any more, and its tile shared
a word with support readiness, the flag that actually decides which language
generated sentences may lean on. The tile is gone; the row is staged, not due
yet, to learn, to review. The state itself remains in the data model for the
migration and "Mark not known" until they are retired with it.

**Gate:** the journey unchanged; the full required validation passes.

### Patch 2.39 — Backups grow with the database

The backup export refused a database over 128 MiB, and production crossed
that line once spoken clips were stored beside the material. The cap is a
memory bound shared by export and restore, not a policy; it is 512 MiB.

**Gate:** the full required validation passes.

### Patch 2.40 — The known state is retired

With its Cards graduated (Patch 2.27) and its tile gone (Patch 2.37), the
`known` state had no remaining entrance and one remaining exit. It is
removed: `CardState` is staged, active, suspended; `markNotKnown` and the
graduation command, route, and script go with it; status and health counts
drop it. Study schema version 7 rebuilds `card_progress` without the state
or `known_return_state`; any straggler becomes staged with a staging source,
and a suspended Card that would have returned to known returns to staged.
The V1 migration maps a dismissal to staged and support-ready. Support
readiness alone now decides which language generated sentences may lean on.

**Gate:** migration and status tests use the three states; the V1 migration
test asserts no Card is outside them; the full required validation passes.

### Patch 2.41 — A batch carries its knowledge once

The learner's knowledge snapshot — the 1,437-word baseline and every Card —
was copied into every review batch item, some 700 KB each, twenty times a
batch, and finished batches were never removed. In two days that was 168 MB
of a 235 MB database; the spoken clips were 5 MB. Learning Material schema
version 7 adds `review_batch`, holding the knowledge once per batch; items
carry their Card only, and items written before this still read the copy
inside them. Beginning a batch clears any batch finished more than an hour
earlier. Space already taken is reused by SQLite; the file does not shrink
without a vacuum, which is left for a quiet moment.

**Gate:** a batch item is under two kilobytes and the batch row holds the
knowledge; a finished batch is gone two hours later and reports not found;
the full required validation passes.

### Patch 2.42 — Compaction on request

Patch 2.41 stopped the growth but left the space taken; SQLite reuses freed
pages and never returns them without a vacuum. `POST
/api/study/maintenance/compact` clears every finished batch at once, then
vacuums, and reports the file size before and after. It holds the database
while it runs and is for a quiet moment, run by hand.

**Gate:** a study test frees a scratch table's pages and sees the file
shrink; the batch test sees maintenance leave a pending batch alone; the
full required validation passes.

### Patch 2.43 — The English fields are English

A review arrived with its scene, answer, and explanations written in
Japanese: a card the learner could not read yet. The instructions (prompt
version `study-v4`) now say which fields are English prose, with Japanese
in them only as the target word or a short quoted form; and the validator
refuses a candidate whose context, answer, or explanation does not read as
English — Latin letters present and at least as many as Japanese characters
— or whose usage note has no English at all (it may quote a cue at length),
naming the field in the reason.

**Gate:** validator tests for English with the target quoted, Japanese
prose, and an empty field; provider tests assert the instruction; the
authored-teaching tests still pass with cue-bearing usage notes; the full
required validation passes.

### Patch 2.44 — The target's own meaning, always

The answer box showed only the model's prose, and what that prose said
varied: sometimes the target's meaning, sometimes the sentence's, once the
Japanese sentence repeated verbatim. The box now opens with the target's own
meaning — lemma, reading, and meaning for a Vocabulary Card; form, meaning,
and formation for a Grammar Card — taken from the presentation metadata the
validator holds equal to the Card, so it is there whatever the model wrote.
The sentence gloss follows it.

Patch 2.29's "never restate the Japanese sentence in English" was written
about the context and read as covering the answer, which is how the Japanese
came back verbatim. The instructions (prompt version `study-v5`) now say what
each English field is for: the answer is what the whole sentence means.

**Gate:** the journey sees the target's lemma, reading, and meaning on a
teach card, and sees the line appear on a review only with the explanation;
provider tests assert the instruction; the full required validation passes.

### Patch 2.45 — A known word written either way is known

The Known Word Bank was matched by comparing a token's written form and its
reading as a pair. But `token.reading` is the reading of the *surface*, so an
inflected 分かる arrives as `分かる` paired with `わかっ` and never equalled
the entry's `わかる`; and a word the model wrote in kana never matched its
kanji entry at all. Both made known words look new, and the validator then
refused the sentence for leaning on language the learner already has.

Measured over four episodes of ordinary conversational Japanese, against the
learner's own bank: 879 of 5,277 content tokens were called new when they
were known, 213 distinct words among them, する alone 96 times. Sentences in
which every content word is known — the ones the validator would accept —
doubled from 6.0% to 12.0% once fixed.

Written forms are compared instead, a kana-written token is also compared
against the entry's reading, and a な-adjective's copula lemma (清潔だ for
清潔) is the same word. Parts of speech must still agree, and sense scoping
is unchanged.

**Gate:** classifier tests for an inflected word, a kana spelling either
way, a copula lemma, and non-matches across parts of speech and to a
different word; the full required validation passes.

### Patch 2.46 — The batch prepares first exposures too

A Card with no stored teaching could never be learned: Learn skipped it and
said so, and the only way to give it one was the cards CLI with a sentence
written by hand. Preparing a series that way meant writing hundreds of
sentences before the first episode.

Teaching is now prepared the way a review is. The batch asks each due Card
which mode it wants — a first exposure while it is new and unseen, a review
once taught — and generates, validates, banks and speaks whichever it is.
One rule decides the mode, shared by the batch and the serve, so what is
banked is what the serve takes. Untaught Cards are batched first, because a
Card cannot be reviewed before it has been taught.

Patch 2.11's review-only batch and the authored-teaching requirement are
superseded for ordinary use. The cards CLI may still carry an `example` and
that sentence is still validated the same way; it is no longer the only
path. What has not changed: a sentence is never taken from the media a Card
came from, and every sentence is built from words the learner already knows.

**Gate:** the journey unchanged, since the fake AI banks both modes; the
full required validation passes.

### Patch 2.47 — The batch serves what it prepared

Patch 2.46 taught the batch to prepare first exposures, but nothing
downstream expected them. Preparing a batch with more untaught Cards than a
batch holds took the untaught ones first and crowded the reviews out
entirely, and the serve then asked only for review reserves, so the first
exposures it had just banked were never handed over. The learner pressed
Prepare batch with thirteen Cards to review and twenty to learn and was told
nothing was left to review.

Reviews now lead, both in what a batch takes and in the order it is served:
a review is scheduled and decays while it waits, where a Card not yet met
waits at no cost. The serve asks each Card which mode it wants, by the same
rule the batch used, and hands over whichever reserve was banked.

Two things the mixed session exposed follow from it. A landing that arrives
while an earlier one is still in flight now resolves against the session as
it is when the fetch returns, so a landing bringing nothing can no longer
close a batch the learner is still working through. And a session that runs
out on a first exposure ends the same way as one that runs out on a review:
the ending is read from the session, which is restored from the device, and
not from the batch, which a reload forgets.

**Gate:** the journey works through a session mixing both modes and sees it
reported complete; the full required validation passes.

### Patch 2.48 — Learn says which gap it hit

Learn answered two different situations with one message, and that message
gave advice Patch 2.46 had already superseded: it told the learner to import
sentences with the cards CLI. With nothing at all due to learn it said the
same thing, so a learner whose daily limit was already spent was told their
Cards had no teaching.

The two are now distinguished. No untaught Card due is reported as nothing
due, and Learn says so and names the daily limit as what admits more. Due
Cards whose first exposure has not been written are still named one by one,
and the advice is now to prepare a batch, which is what writes them.

**Gate:** the journey sees the named-Card message; the full required
validation passes.

### Patch 2.49 — An inflected target is still the target

A Vocabulary Card whose target was a verb could not be reviewed. Every
generated sentence was refused as the wrong target identity, and the target
word itself was then counted among the words the learner does not know, so
the batch failed the Card round after round and left it due.

Two causes, both in how a token was matched against the Card. Kuromoji reads
the surface, so an inflected word reads as it is written — 聞き出し is
ききだし, never ききだす — and comparing that against the Card's reading
rejected every form but the dictionary one. And a conjugated word is one word
to a learner and several tokens to the analyzer, so a span over 聞き出した
tiled as 聞き出し|た and the joined lemma could never equal the Card's.

The reading is now taken from the token's dictionary form, derived by
swapping the surface's kana tail for the lemma's. Deriving it rather than
reading the lemma afresh keeps homographs apart: 開いた reads ひらい or あい
and yields ひらく or あく, where a second lookup would collapse both. The
irregular verbs, whose stem shares no writing with their dictionary form,
derive nothing and keep the old comparison rather than a wrong guess.

A span may now cover the target as it is written, inflection and all, or the
stem alone. The tail may only be the parts of speech that carry no
vocabulary of their own — the same set the policy already calls transparent
— so no second content word can hide inside a target span, and the
inflection itself is still checked as grammar.

**Gate:** a verb Card validates in its dictionary form, its plain and polite
inflected forms, and with the span on the stem alone; the target is never
reported as unknown vocabulary; the full required validation passes.

### Patch 2.50 — A reading has to explain its writing

相変わらず忙しい。 came back with the reading あいかわらいそがしい。, a ず
short of the word. Nothing refused it, so the renderer did what it could:
unable to place the reading run by run, it fell back to one ruby over the
whole sentence, kana included, and that single piece was small enough beside
the target span to be coloured — so the line carried a second line of kana
above it and the whole thing was yellow.

Both symptoms were the one reading. It is refused now: every kana the
writing shows must be said, so a reading that contradicts its own writing is
material the learner should never see. What this cannot catch is a reading
merely wrong over the kanji, which reads as well as a right one and would
need a dictionary rather than the writing to detect.

Two supporting changes. A reading is placed over kanji or not placed at all:
the edge-trimming fallback is kept only when what it lands on is kanji,
because ruby over kana teaches a kana its own sound. And は, へ and を may be
read as わ, え and お, since a model may spell either the word or the sound
and both say the same thing.

**Gate:** a reading dropping a kana its writing shows is refused; a reading
that cannot be placed is not shown, and the target under it stays coloured
alone; the full required validation passes.

### Patch 2.51 — The word being taught is never a word the learner is missing

A Card failed its batch round after round, reporting the target surface
mismatched, the target absent, and the target itself an unknown word. The
third was a consequence of the first: a token is excused from the
unknown-vocabulary check by sitting inside the target span, so a span the
model miscounted left the target word standing outside its own span, to be
reported as language the learner has not met.

That reason then travelled into the retry as a hint, which told the model
that the one word the sentence exists to teach was a word it must not use.
Each round was worse advised than the last.

The target word is now itself wherever it stands, by identity as well as by
span. The miscounted span is still refused, and refused for what it is; what
it no longer does is blame the target for it.

Left open: a span that is arithmetically wrong but points at an unambiguous
target could be repaired from the sentence rather than refused, since a model
writes the target text well and counts UTF-16 offsets badly. That would
change what the frozen adversarial manifest calls an invalid span, so it is
not taken here.

**Gate:** a miscounted span is refused without reporting the target as
unknown vocabulary; the full required validation passes.

### Patch 2.52 — Learning steps for new Cards, none for relearning

Patch 2.34 turned off short-term steps for lapses, and took the steps for
new Cards with them. The two are different problems. A learner reported
being unable to remember new words, and the schedule explained it: a new
Card was met once, in one sentence, and its first retrieval came three days
later.

The spacing effect governs the gap between *successful retrievals*, and
there had not been one. One exposure and then silence is a single massed
trial, not spaced practice; the meta-analytic optimum of a day or more
assumes the item is encoded, and the same work finds that stretching the gap
past the point of successful recall gives nothing back. Retrieval practice
is what builds retention, and an item dropped after a single correct recall
is poorly retained a week on.

New Cards are retrieved at an hour and two hours before they graduate to the
multi-day ladder (`gafu-parameters-v4`). Relearning is
unchanged and deliberately so: a Card that was learned and then failed is
still scheduled by its stability and still lands days away, which is what
Patch 2.34 was asked for.

What the learner is retrieved from is a freshly generated sentence every
time, never the one just seen — the generator is already given the Card's
last shown sentences to avoid. Repeating one sentence would train the
sentence rather than the word, and the goal is a word recognised in lines
never met before. Support readiness is untouched: it still needs two
successes on different local days at least twenty hours apart, so the
same-day retrievals cannot promote a word into the supporting vocabulary
early. Existing schedules and review history are untouched; the new rule
applies from the next answer.

The steps are set to the rhythm of a day's sessions rather than to the ten
minutes a once-a-day app has to settle for. A retrieval is worth most when
what it recalls has had time to fade, and the within-session repetition that
short steps buy has sharply diminishing returns past the first success —
what carries retention is coming back to the word in a later sitting. Each
step is shorter than the gap between sessions so it lands at the next one
rather than after it, and a step that is missed only makes the Card overdue,
which costs nothing.

**Gate:** scheduler tests for a new Card retrieved again the same day but no
sooner than an hour, for it graduating to a multi-day interval, and for a
lapse on a learned Card still landing at least a day away; the full required
validation passes.

### Patch 2.53 — A first review is a retrieval, and a stuck Card says so

Two things the same learner found by asking how many times a day a Card
comes back.

**Teaching left nothing between exposure and review.** A taught Card stayed
due, so its first review was served by whatever batch was prepared next —
minutes after the answer had been on screen. That is not a retrieval, it is
a re-reading, and the learning steps added in Patch 2.52 had no say in it
because the gap was decided by when a button was pressed. A first exposure
now moves its review out by `firstReviewAfterMinutes`, thirty by default,
and only the due time moves: nothing was graded, so nothing has been learned
about the Card's stability. The gap is a preference because the right value
is the learner's own rhythm — shorter than the gap between sittings, so the
review lands at the next one. Zero restores the old behaviour.

**A Card that keeps failing said nothing.** Every Again returns a new Card
to the first learning step, which is shorter than the gap between sittings,
so a Card being failed comes back every session for as long as that lasts —
correctly, but silently. FSRS is no help in noticing: it records a lapse
only from the review state, so a new Card failed twenty times running
registers none of them, and `lapses` stays at nought for exactly the Cards
worth looking at. Answers of Again in a row are counted here instead, reset
by any other answer, and a Card at six is flagged in the bank as stuck.

Nothing is suspended automatically. A Card fails either because it is too
hard for where the learner is or because it is wrong in a way the validator
cannot see — a sense that does not match the word, a meaning that belongs to
another entry. Which of the two it is, only a person can tell, and the Cards
this project has had to repair were mostly the second kind.

**Gate:** a first exposure schedules its review a gap away without recording
a review; failures in a row are counted and forgotten on a success; the full
required validation passes.

### Patch 2.54 — The study day is the learner's, and starts when they say

The deployment ran on UTC while the learner did not, so the day rolled over
at ten in the morning where they were standing. New Cards unlocked
mid-morning, and anything studied before that counted against the day
before — which is how a learner came to have done twenty new Cards at 10:36
and be told there was nothing to learn.

A day also need not begin at midnight. Work done at one in the morning
belongs to the day just spent, not the one starting, so the day key winds
the instant back by `dayStartsAtHour` before reading its date. Zero is
midnight and the behaviour as it was; four is the small hours kept with the
evening they belong to.

The open admission window already pinned the zone it was opened under, so
that changing the zone mid-day could not end the day early and hand out a
second day's worth of new Cards. It now pins the hour for the same reason
and by the same rule: the day in progress is measured the way it was opened,
and a new zone or hour takes effect at the next genuine rollover.

**Gate:** the small hours fall in the previous day under a four o'clock
start and the next one under midnight; changing either setting mid-day
admits nothing further; the full required validation passes.

### Patch 2.55 — One button, because the other one could not work

Learn served a first exposure that was already stored, and nothing else. It
was the right shape when a Card's teaching arrived with it, written by hand
and carried in by the cards CLI. Of the Cards imported since, none carries
one: the learner's rule is that no sentence comes from the media a Card came
from, so there is nothing to attach at import and the sentence has to be
written later. Learn could not open any of them, and said so by naming them,
seventy at a time.

Prepare batch already did the whole job — it writes a first exposure for a
new Card and a review for one already taught, and it opens the session
itself as the Cards land. Learn is removed, with the two routes only it
used. What it protected is not lost: an authored sentence is still a banked
teach reserve, and the batch serves it as it is rather than writing another.

A session is now always a batch session, so it no longer carries a mode, and
ending one always ends the batch.

**Gate:** the journey teaches both authored Cards through the batch,
including the first exposures the batch writes for the Cards nothing had
taught; the full required validation passes.

### Patch 2.56 — The tiles answer for the limit as it stands

Raising the daily limit changed nothing on screen. Admission is what turns a
staged Card into a due one, and it runs when the queue is read — but the
routes behind the tiles read the Card listing and the counts, never the
queue. So the new limit sat unused until something else happened to read it,
which since Patch 2.55 means pressing Prepare batch. A learner who raised
the limit and watched the tiles saw a setting that appeared not to work.

The status is read through the queue now, so looking at the page is enough
for the limit to take effect. The bank listing follows the counts rather
than preceding them, so the Cards listed are the ones the counts describe.

**Gate:** a Card created under a limit of none is admitted by raising the
limit and nothing else; the full required validation passes.

### Patch 2.57 — Shelve a Card from where it is read

A Card shows itself to be wrong while it is on screen: the wrong sense, a
meaning belonging to another word, something the learner is nowhere near.
Suspending it meant leaving the session, finding it in the bank, and losing
the sentence that made the case — so in practice it was answered instead,
and came back.

Both modes carry a Suspend button now, and the S key. The Card is shelved
and the next one shows at once; the suspension goes to the outbox like a
grade or an acknowledgement, so it is instant and survives being offline. No
grade is recorded: a suspension is not an answer, and the schedule is left
where it stood for whenever the Card is restored.

**Gate:** a Card suspended from inside the session leaves the session at
once and reads as suspended in the bank; the full required validation
passes.

### Patch 2.58 — A miscounted span is arithmetic, not a different claim

Eight Cards in a row were refused for `targetSurfaceMismatch` and
`targetAbsent`, and several of those also had the target word counted
against its own sentence as vocabulary the learner had never met. One cause:
the model named the right word and pointed at the wrong place. Counting
UTF-16 offsets is the one part of the job a model does badly, and the part
it writes well — the target text — was being thrown away with it.

The span is repaired from the sentence when the surface appears exactly
once, which is the sentence saying plainly where the word is. The repaired
span is what travels back, so what is banked and coloured is where the
target stands. A surface the sentence says twice is refused rather than
guessed at: that is the case a careless model produces and the case a
misleading one would exploit, and there is no honest way to choose between
two occurrences.

This also ends the target reporting itself unknown. A token escapes the
unknown-vocabulary check by sitting inside the target span, and Patch 2.51
added identity as a second route — but identity is per token, so a compound
target never qualified: 紹介する is 紹介 and する, and no single token is the
word. A correct span covers it.

`invalidTargetSpan` is retired; no span is invalid on its own any more.
Patch 2.29's adversarial corpus is amended rather than quietly broken: the
`invalidSpan` fault becomes `unreconcilableSpan`, a doubled surface with a
span landing on neither, and the frozen manifest hash is updated with it.
The exit gate now reads "a span that cannot be reconciled with the sentence"
where it read "bad span", which is the guarantee that is actually kept — and
a stronger one, since a span can no longer point anywhere but at the word.

**Gate:** a span one character out is repaired and the repaired span is
banked; a surface appearing twice is refused; the amended corpus rejects
every invalid presentation; the full required validation passes.

### Patch 2.59 — The bank is read a page at a time

Every Card went to the browser on every load. At a thousand Cards that was
half a megabyte and nobody noticed; a five thousand word import would have
made it three, on each load and each refresh after an answer, for Cards the
learner will not meet for months.

The listing is a page of fifty now, and searching and filtering went to the
query with it — they were done in the browser over whatever had been sent,
which only worked because everything had been. A page is drawn from the
whole bank instead, so a search finds a Card whether or not it happened to
be in the last response. The response carries how many Cards the query
matches, so the pager can size itself, and the tiles are unaffected: they
are counted over every Card on the server, where the count costs nothing to
send.

**Gate:** pages partition the bank with no Card missed or repeated, a count
answers for the query rather than the page, and no limit is still the whole
bank; the full required validation passes.

## Exit gate

Phase 2 is implemented when all of the following are true:

- the same Grammar Card and Vocabulary Card can each be taught and graded more
  than once through fresh, materially different validated material;
- a first graded answer cannot occur before explicit teaching;
- malformed structure, missing target, a span that cannot be reconciled with
  the sentence, reconstruction mismatch,
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
