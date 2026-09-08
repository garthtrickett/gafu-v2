# Phase 0 — Prove the risky seams

**Status:** In implementation — patches 0.1–0.4 and 0.6 complete; 0.5 code
complete with manual provider evidence pending · 1.6
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)
**Product source:** [`../V2.md`](../V2.md)
**Last updated:** 2026-09-08

## Goal

Prove that Gafu V2 can identify Japanese learning targets and reject invalid
`i`/`i+1` material before durable Card and schedule design begins. At the same
time, select the smallest credible data and AI topology and establish the code
kernel that later phases will build on.

Phase 0 is evidence work, not a miniature implementation of the whole product.
Its output is a runnable skeleton, measured experiments, narrow draft
interfaces, and recorded decisions. A spike that disproves an assumption is a
successful Phase 0 result; hiding that result behind a prompt or fallback is
not.

## Why this phase comes first

Four decisions can invalidate large amounts of later work:

1. whether surface Japanese can be mapped to stable spans, lemmas, readings,
   parts of speech, senses, conjugations, and grammar evidence accurately enough
   to subtract what the learner knows;
2. whether generated Japanese can be checked independently so the target is the
   only unknown;
3. whether a complete series can be analyzed in bounded, resumable agent batches
   without silent omissions or duplicate cost; and
4. where learner data and provider credentials can live while keeping writes
   simple, atomic, recoverable, and testable.

Phase 1 must not freeze Card identity or persistence around guesses about these
questions.

## Phase boundaries

### In scope

- Project skeleton and quality commands.
- Notes-style `Result<T, E>` and discriminated typed failures.
- Japanese evaluation fixtures and a held-out oracle.
- Characterization of legacy Gafu behavior relevant to language analysis.
- Japanese analyzer bake-off and a narrow analysis interface.
- `i`/`i+1` validator feasibility, including grammar support.
- Resumable agent-batch orchestration with a fake and a small paid smoke run.
- Data-topology and AI-key-topology spikes and decisions.
- One diagnostic browser route proving the selected pieces can be composed.
- A Phase 0 evidence report and explicit Phase 1 handoff.

### Out of scope

- Production Card persistence, review scheduling, or learner-state transitions.
- The Kaishi import itself beyond a representative known-word fixture.
- Production study sessions or generated-card UI.
- User subtitle upload, ZIP extraction, Preparation Plans, and readiness.
- Video playback, Subtitle Capture, audio, alignment, or transcoding.
- V1 data migration.
- Cross-device sync, multi-user tenancy, plugins, or a public API.

Timeboxed spike code may be deleted at phase closure. Code may survive only when
it forms part of the chosen interface, its test harness, or a generally useful
fixture—not because work has already been spent on it.

### Product decisions informed, not smuggled in

Phase 0 supplies evidence for open PRD decisions but does not settle them by
accident inside a fixture or TypeScript key:

- Analyzer and ambiguity results inform whether Vocabulary Card identity is a
  lemma or lemma plus sense. The explicit product decision is required before
  Phase 1 freezes canonical identity.
- The data topology chooses the first-release source of truth; it does not
  silently decide that Gafu is permanently single-user or can never sync.
- The validator records what it can prove about supporting grammar; it does not
  redefine “known grammar” or the learner-state threshold.
- Source-sentence reuse and near-copy policy remain Phase 2 product work unless
  a Phase 0 result makes the existing PRD impossible.

The Phase 0 evidence report ends with a short decision request for every product
choice that must be resolved before Phase 1 or Phase 2. An unresolved choice is
not filled with a convenient implementation default.

## Non-negotiable rules

- The agent may propose; it may not attest that its own output is valid.
- Analyzer failure cannot become low-quality “successful” tokens. Degraded output
  is a typed result and cannot subtract language from the Preparation Gap.
- Normalization, offsets, and span units are versioned and explicit.
- A false-known result is more harmful than an extra unknown. Ambiguity stays
  visible rather than being coerced into a confident Card identity.
- No result is called complete merely because one prompt or context window ended.
- No API key, subtitle body, or generated private content is committed or logged.
- Phase 0 adds no speculative abstraction. A seam needs a production adapter and
  a test adapter, or another demonstrated reason to vary.
- No go/no-go threshold may be weakened after seeing the held-out results. A
  changed threshold requires an explicit product decision and recorded reason.

## Expected repository shape

Names may move if the phase proves a better module shape, but the responsibilities
must remain obvious:

```text
src/
  main.ts                    composition root and diagnostic route
  result.ts                  Result kernel only
  analysis/                  Japanese analysis module
  learning-material/         validation experiment
  preparation/               batch orchestration experiment
tests/
  fixtures/japanese/
    calibration/             visible while developing
    holdout/                 frozen before implementation tuning
  support/                   deterministic provider and clocks
docs/
  adr/                       only decisions that meet the ADR threshold
  evidence/phase-0.md        measurements, failures, and final recommendation
phases/
  phase-0.md                 this execution contract
```

Do not introduce folders named `services`, `utils`, `managers`, or `common` as a
substitute for deciding who owns behavior.

## Draft contracts under test

These are experiment shapes, not production types to preserve at all costs.
They exist so every bake-off is judged through the same small interface.

### Japanese analysis

```ts
type TextSpan = {
  readonly start: number;
  readonly end: number;
  readonly unit: "utf16-code-unit";
  readonly normalization: "nfkc-v1";
};

type AnalyzedToken = {
  readonly surface: string;
  readonly lemma: string;
  readonly reading: string | null;
  readonly partOfSpeech: readonly string[];
  readonly conjugation: string | null;
  readonly span: TextSpan;
};

type AnalysisError =
  | { readonly kind: "analyzerUnavailable"; readonly cause: string }
  | { readonly kind: "unsupportedText"; readonly cueId: string }
  | { readonly kind: "invalidSpan"; readonly cueId: string }
  | { readonly kind: "degraded"; readonly cueId: string; readonly cause: string };

type JapaneseAnalyzer = {
  readonly analyze: (
    cueId: string,
    rawText: string,
  ) => Promise<Result<AnalyzedText, AnalysisError>>;
};
```

`AnalyzedText` must retain raw text, normalized text, reconstruction data, and
tokens. Callers must not learn dictionary-loading, worker, WASM, or provider
details. Every `TextSpan` indexes the normalized text, never the raw input. If a
later caller needs to map back to raw bytes or characters, `AnalyzedText` owns
that mapping; callers must not recreate normalization arithmetic.

### Learning-material validation

```ts
type ValidationRequest = {
  readonly target: CardCandidate;
  readonly japanese: string;
  readonly targetSpan: TextSpan;
  readonly readingSegments: readonly ReadingSegment[];
  readonly knownVocabulary: ReadonlySet<CanonicalVocabularyKey>;
  readonly knownGrammar: ReadonlySet<CanonicalGrammarKey>;
};

type ValidationDecision =
  | { readonly accepted: true; readonly analyzed: AnalyzedText }
  | { readonly accepted: false; readonly reasons: readonly ValidationFailure[] };
```

Failures must distinguish malformed schema, reconstruction mismatch, invalid
span, absent target, wrong canonical target, ambiguous target, unknown supporting
vocabulary, unknown supporting grammar, and analyzer degradation. The caller
must not parse error messages to choose recovery.

### Agent batching

```ts
type AnalysisBatch = {
  readonly runId: string;
  readonly batchId: string;
  readonly inputDigest: string;
  readonly cues: readonly AnalyzedCue[];
};

type BatchResult = {
  readonly runId: string;
  readonly batchId: string;
  readonly inputDigest: string;
  readonly candidates: readonly CandidateEvidence[];
};
```

A durably completed `inputDigest` is the local idempotency fact. Retrying it
reuses the same normalized batch result rather than calling the provider or
merging the work again. The merged run is complete only when every manifest
batch has a completed result.

External billing cannot be exactly-once by local design alone. A crash after the
provider accepts a request but before its response is committed leaves an
`uncertain` request. Recover it through provider idempotency or result retrieval
when available; otherwise require an explicit retry with a possible
duplicate-cost warning. Never silently issue it again.

## Ordered patch plan

Each patch is independently reviewable and leaves `main` green. Corrective
commits may remain on the same pull request, but unrelated patches do not share
one.

| Patch | Status | Purpose | Depends on |
|---|---|---|---|
| 0.1 | Done | Establish the executable skeleton and quality contract | — |
| 0.2 | Done | Build and freeze the Japanese fixture oracle | 0.1 |
| 0.3 | Done | Characterize and select Japanese analysis | 0.2 |
| 0.4 | Done | Prove or reject `i`/`i+1` validation | 0.3 |
| 0.5 | Manual gate pending | Prove complete, resumable agent batching | 0.2, 0.3 |
| 0.6 | Done | Decide data and AI topology from working spikes | 0.1, 0.5 |
| 0.7 | Not started | Compose the proof, publish evidence, and close the phase | 0.3–0.6 |

## Patch 0.1 — Executable skeleton

### Purpose

Create the smallest application and test surface on which the experiments can
run. This patch establishes mechanics, not product architecture.

### Work

- Configure Bun, Vite, strict TypeScript, formatting/linting, unit tests, and one
  browser smoke-test runner.
- Use standalone `lit-html` for the diagnostic route, matching the proven Notes
  pattern without introducing web components, a router, or a state framework.
- Enable at least `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` unless a documented tool incompatibility blocks
  one.
- Implement only the `Result<T, E>`, `ok`, `err`, and async exception-capture
  helpers already earned by the experiments.
- Render one diagnostic route from an explicit model.
- Establish one composition root that creates ambient dependencies.
- Establish structured development logging with redaction tests. Domain modules
  receive a logger or return diagnostic facts; they never call `console` as an
  undeclared dependency.
- Add a concise root `AGENTS.md` naming `V2.md`, `CONTEXT.md`, and `v2-impl.md` as
  authoritative, recording the local commands and the no-Effect/deep-module
  rules, and requiring phase work to follow this patch sequence.
- Record the repository licence decision before copying any V1 or `jp-player`
  implementation. Until then, legacy code is read-only behavioral evidence.
- Add CI running the same commands as local development.
- Record bundle size and test duration as baselines, not pass/fail budgets yet.

### Gate

- A typed failure returned by an async action is exhaustively presented on the
  diagnostic route.
- Adding an unhandled error variant makes the relevant switch fail type-checking.
- Unit tests run without a browser; the browser smoke test boots the route.
- No Effect, state framework, router framework, persistence library, or AI SDK
  is added without a demonstrated requirement from a later patch.

### Expected commands

```bash
bun install
bun run check
bun test
bun run build
bun run test:browser
```

Every listed script must exist by the end of the patch. CI is authoritative;
local success alone does not close it.

## Patch 0.2 — Japanese fixture oracle

### Purpose

Create a stable way to tell whether an analyzer or validator improved. Without
an oracle, switching libraries merely changes output.

### Corpus

Commit at least 120 short, original or synthetic Japanese cues. Freeze at least
40 as a held-out set before analyzer tuning. Across the held-out set include at
least 300 annotated non-punctuation tokens, 100 explicit known/unknown
classifications, 30 inflected targets, 20 ambiguous or polysemous targets, and
40 grammar occurrences spanning at least 20 distinct constructions. Fixtures
must cover:

- plain kana, common kanji, numbers, counters, punctuation, whitespace, and
  multi-line cues;
- NFKC-changing characters, half-width forms, emoji, astral characters, and
  UTF-16 offset traps;
- verbs and adjectives across polite, plain, negative, past, progressive,
  potential, passive, causative, and contracted spoken forms;
- compounds, auxiliaries, particles, sentence endings, and fixed expressions;
- homographs and polysemous lemmas where sense cannot be inferred from spelling
  alone;
- names, invented words, loanwords, interjections, stutters, music markers, and
  dialogue fragments;
- overlapping and discontinuous-looking grammar constructions;
- the same target recurring in different surface forms and episodes; and
- malformed or unsupported text that must fail visibly.

Each annotated cue records expected normalization, token surfaces, exact spans,
lemma, reading, broad part of speech, conjugation where applicable, expected
known-word behavior, and any grammar evidence. An ambiguous field is marked
ambiguous with allowed alternatives; the oracle never invents one answer to make
a test convenient.

### Legacy characterization cases

Recreate the behavior—not the implementation—of known V1 failures:

- analyzer load failure returning coarse fallback tokens that appear usable;
- vocabulary identity based on lemma, reading, and part of speech but not sense;
- grammar discovery limited to aliases already in a catalogue;
- a target span that becomes wrong after NFKC normalization;
- UTF-16 offsets around non-BMP characters;
- generated furigana/reading segments that do not reconstruct the Japanese;
- a target surface or span that names only part of the requested Card; and
- a fixed-size batch that succeeds while omitting later candidates.

### Gate

- Fixture format is schema-checked and documented.
- Raw and normalized reconstruction assertions pass for the oracle itself.
- Calibration and holdout sets are selected before Patch 0.3 tuning.
- A review report lists uncertain annotations; uncertain cases do not count
  toward accuracy thresholds until resolved.
- No copyrighted episode transcript or user subtitle is committed.

### Measurement protocol

- Develop against calibration fixtures only. The holdout is not opened until a
  candidate and its configuration are frozen.
- Report raw numerator and denominator beside every percentage and retain the
  per-fixture result, so a rounded percentage cannot hide one dangerous error.
- Apply thresholds both overall and to the named risk slices: normalization
  traps, inflection, ambiguity, unknown words, and grammar.
- A discovered annotation error is corrected transparently and the affected
  result is invalidated. Tuning after any holdout observation requires freezing
  a new unseen holdout before the next selection claim.
- Performance is measured after a cold load and a warm load on the documented
  reference machine and browser. Results are evidence, not portable guarantees.

## Patch 0.3 — Japanese analyzer selection

### Purpose

Select the smallest analyzer implementation that makes gap subtraction and
target validation credible.

### Work

- Run the current Kuromoji-based behavior as a characterized baseline rather
  than copying its module.
- Evaluate at least one viable alternative when licensing, browser/runtime
  support, dictionary size, and maintenance allow it.
- Drive every candidate through the same `JapaneseAnalyzer` interface and
  calibration corpus.
- Verify normalization, reconstruction, spans, lemma, reading, part of speech,
  conjugation, unknown-token behavior, load failure, and deterministic repeat
  output.
- Measure initialization time, per-cue time, memory, dictionary/download size,
  and whether work can move off the UI thread. Record measurements; do not pick
  solely on linguistic score.
- Define canonical vocabulary identity evidence without prematurely collapsing
  ambiguous senses. Analyzer output may narrow a sense; it does not become the
  dictionary authority by itself.
- Define how grammar evidence combines deterministic form matching and agent
  proposals. A catalogue-only alias scan is not new-grammar discovery.
- Return `degraded` or another typed error when trustworthy analysis is
  unavailable. Never promote a whitespace/regex fallback to canonical evidence.

### Fixed thresholds on the held-out set

- **Span and surface reconstruction:** 100%.
- **Normalization reconstruction:** 100% according to the versioned fixture.
- **Known-word false exclusion:** 0 cases. A word may remain unnecessarily
  unknown, but an unknown word may not be removed as known.
- **Target lemma/reading/POS on non-ambiguous supported tokens:** at least 98%.
- **Determinism:** identical normalized results across ten repeated runs.
- **Failure behavior:** analyzer/dictionary failure produces no trusted tokens.

Results below a threshold block selection. Changing the fixture or threshold
after the held-out run requires a written rationale and a fresh holdout set.

### Gate

Publish a bake-off table and select one implementation, or stop with evidence
that none is viable. The chosen implementation passes the interface-level suite
with no tests reaching into its dictionary or internal token objects. Any new
dependency has its version, license, notices, runtime location, and size recorded.

## Patch 0.4 — `i`/`i+1` validator feasibility

### Purpose

Prove that AI-generated material can be independently rejected when it teaches
more than the one intended target.

### Validation layers

Run all layers and collect all safe-to-report failure reasons:

1. decode the provider response into the expected structure;
2. normalize Japanese using the analyzer's versioned rule;
3. reconstruct the Japanese from reading/furigana segments exactly;
4. verify target span bounds and exact substring;
5. map the observed target surface back to the intended canonical Card;
6. analyze every non-punctuation token;
7. prove every supporting vocabulary item is in the Known Word Bank;
8. prove every non-target grammar construction is in the known Grammar set;
9. reject degraded, ambiguous, or incomplete analysis; and
10. return a typed decision without changing study state.

Inflection, particles, auxiliaries, copulas, names, and transparent forms need
an explicit classification policy. They cannot be silently ignored merely
because they make validation difficult.

The declared grammar envelope must cover every non-target construction in the
valid holdout presentations and at least the 20 distinct constructions frozen
in Patch 0.2. Calling a construction “unsupported” after it causes a failure
does not remove it from the denominator.

### Adversarial suite

For both Grammar and Vocabulary targets include at least 40 valid and 40 invalid
presentations in the frozen holdout, balanced across the following cases:

- valid `i` and `i+1` material in several registers and conjugations;
- target absent, target repeated misleadingly, wrong sense, and wrong grammar;
- valid target text with an invalid or normalization-shifted span;
- target hidden only in furigana or explanation rather than the sentence;
- one and several extra unknown supporting words;
- an unknown inflected lemma whose surface resembles a known word;
- known words used in an unknown sense;
- one and several unknown non-target grammar constructions;
- malformed reading segments and reconstruction mismatches;
- tokenizer degradation and ambiguous canonical matches; and
- valid natural sentences likely to trigger false rejection.

### Go/no-go thresholds

On the frozen adversarial holdout:

- **False acceptance of an invalid presentation:** 0.
- **Target identity and span:** 100% correct.
- **Reconstruction mismatch detection:** 100%.
- **Extra unknown vocabulary detection:** 100%.
- **Extra unknown grammar detection for the declared supported grammar set:**
  100%.
- **Acceptance of annotated valid presentations:** at least 90%.

The finite suite does not prove universal linguistic correctness. It proves the
declared supported envelope. If grammar coverage is too narrow to generate
natural material or the valid acceptance rate misses the threshold, stop and
bring the evidence back to the product contract. Prompt instructions and agent
self-reported prerequisite lists do not satisfy this gate.

### Gate

The validator makes its decision from the request, analyzer, and trusted
knowledge snapshot. A deterministic fake-generator suite demonstrates every
failure. A small real-provider sample estimates retry rate and cost but cannot
override a failed deterministic gate.

## Patch 0.5 — Complete and resumable agent batching

### Purpose

Prove that multi-episode analysis can exceed one model context without presenting
a partial result as the full Preparation Gap.

### Work

- Create a deterministic multi-episode manifest with targets repeated across
  batch boundaries, ambiguous evidence, and a required target only in the final
  batch.
- Define content-derived `runId`, `batchId`, input digest, normalization version,
  analyzer version, prompt version, and provider/model identity.
- Persist request intent before calling the provider. Record `requested`,
  `uncertain`, and `completed` separately so the crash window is visible.
- Persist a completion record only after a batch response decodes and every
  cited cue/span validates against input.
- Merge by canonical candidate identity while retaining every distinct evidence
  link and ambiguity. Merge order must not change the result.
- Resume from completed batch digests after cancellation, reload, timeout, rate
  limit, or malformed output.
- Ensure retry uses a stored valid normalized result when present and never adds
  the same evidence twice.
- Use provider idempotency or result retrieval when available. When unavailable,
  an uncertain request pauses for an explicit retry decision instead of silently
  risking a second charge.
- Distinguish `running`, `paused`, `incomplete`, `complete`, and `failed` run
  states, plus uncertain request state within a run. Only `complete` may claim
  to represent the whole manifest.
- Estimate request count and input size before the first paid call. Surface the
  configured provider/model and exact subtitle scope.
- Use a deterministic provider fake for orchestration tests, then perform a
  manually triggered real-provider run with a developer-supplied key. Run at
  least three complete four-batch analyses of the same synthetic holdout so
  variability is visible rather than hidden by one lucky response.

### Typed failures

At minimum distinguish authentication, permission, rate limit, offline/transport,
timeout, malformed structure, invalid cue evidence, incomplete response,
provider refusal, cancellation, and incompatible resume metadata. Recovery is
exhaustive by kind; generic strings are diagnostic detail only.

### Gate

- One-batch and many-batch fake runs produce the same canonical candidates and
  evidence.
- Randomized batch and completion order does not change the merged result.
- Failure is injected before, during, and after a provider response; every run
  resumes from the last committed valid batch.
- No retry reissues a durably completed digest or duplicates evidence.
- The crash-after-request/before-commit case is recovered through provider
  idempotency or becomes visibly uncertain; it is never silently reissued.
- The final-batch-only target appears, proving there is no early fixed cutoff.
- Invalid cue IDs or spans prevent the affected batch from completing.
- Across each real-provider run, every accepted evidence span is locally valid,
  non-ambiguous vocabulary recall is at least 98%, and recall for the declared
  grammar constructions is at least 90%. Report each run, not only the average.
- The real-provider smoke report records requests, tokens when available,
  duration, retry/invalid-output rate, and estimated series-scale cost without
  retaining the private prompt body.

## Patch 0.6 — Data and AI topology decisions

### Purpose

Decide two hard-to-reverse deployment seams using running proofs rather than
architecture preference.

### Data topology spike

Compare local/browser persistence with an owned server database for the first
release. Test the minimum transaction shape Phase 4 will require: one Plan Draft
creates plan membership, source evidence, several canonical Cards, and schedules
or creates nothing.

Use disposable representative records for this proof. Patch 0.6 chooses
transaction ownership and storage capabilities; it does not define the
production Phase 1 schema early.

Score each option on:

- single-writer clarity and transaction guarantees;
- durability when browser data is cleared;
- backup, restore, schema migration, and recovery ergonomics;
- local media and subtitle privacy;
- deployment and operational burden;
- deterministic tests with an isolated local adapter; and
- the cost of adding accounts or cross-device sync later without building them
  now.

The selected topology must have one authoritative writer. Do not combine a local
and remote store with an ad hoc outbox during Phase 0.

### AI topology spike

Compare direct browser-to-provider access, where technically and operationally
safe, with a minimal owned proxy. Test one structured request, cancellation,
timeout, provider error mapping, and redacted diagnostics.

Score each option on:

- whether browser CORS and provider policy permit it;
- API-key exposure, storage, rotation, removal, and threat model;
- normal setup by pasting one API key, never configuration JSON;
- streaming and cancellation support;
- provider error fidelity and observability;
- deployment and recurring operational burden; and
- ability to substitute a deterministic adapter in tests.

### Required decisions

- learner-data source of truth and writer;
- backup/restore mechanism for the first release;
- whether an owned server exists and its exact responsibility;
- where the provider key is entered, held, and used;
- which layer performs provider-specific error translation; and
- which data, if any, crosses the network during analysis and generation.

Create an ADR only where the choice is costly to reverse, surprising without
context, and selected between genuine alternatives. Otherwise record the result
and evidence in the Phase 0 report.

### Gate

The winning data spike proves commit, forced mid-transaction failure, reload,
backup, and restore. The winning AI spike proves key entry, verification,
redaction, one structured response, cancellation, and typed failure. The report
explains why the losing options were rejected and what evidence would reopen the
decision.

## Patch 0.7 — Integrated proof and phase closure

### Purpose

Demonstrate that the selected pieces compose without turning the spike harness
into the production product.

### Diagnostic journey

The browser route runs a committed synthetic Subtitle Set through:

1. normalization and Japanese analysis;
2. known-word subtraction using a small Kaishi-derived fixture;
3. deterministic fake-agent batching and evidence merge;
4. validation of one valid and several invalid Learning Material samples; and
5. rendering typed outcomes and safe measurements.

The route is explicitly diagnostic. It does not create Cards, schedules, or a
temporary production UI that Phase 1 must preserve.

### Evidence report

`docs/evidence/phase-0.md` must contain:

- commit SHAs and exact commands tested;
- fixture inventory and unresolved annotation uncertainty;
- held-out analyzer metrics and performance measurements;
- validator confusion table and declared supported grammar envelope;
- batching interruption/idempotency results and provider-smoke cost;
- selected data and AI topology with links to any ADRs;
- dependencies and their versions, licenses, notices, and measured footprint;
- discarded spike code and the reason it was discarded;
- known limitations and every deferred question;
- a direct recommendation to proceed, revise the PRD, or stop; and
- the exact contracts and facts Phase 1 may rely on.

### Cleanup

- Delete losing analyzer/provider adapters unless retained solely as small test
  adapters with a real purpose.
- Delete benchmark UI and scripts that do not reproduce evidence.
- Keep fixtures, selected module interface tests, topology proofs, and the
  diagnostic journey if they remain cheap regression protection.
- Update `../v2-impl.md` with the Phase 0 result and change Phase 1 from planned
  to ready only when every closure gate passes.

### Gate

Run the full command set from a clean checkout. The diagnostic journey passes
with no key and no network by using deterministic adapters. Any manually
triggered provider smoke remains separate from normal CI. All required evidence
exists, all thresholds are unchanged, and every stop condition below is cleared.

## Test matrix

| Layer | Runs against | Proves |
|---|---|---|
| Pure unit | Result helpers, normalization, merge and validation rules | exhaustive transitions and deterministic rules |
| Fixture conformance | calibration and frozen holdout corpora | analyzer and validator accuracy |
| Property | batch partitions/order, span reconstruction, evidence merge | invariants across more cases than examples |
| Bounded fuzz | Unicode cue input and structured provider output | no crash, hang, unsafe allocation, or trusted degraded result |
| Adapter contract | analyzer, persistence, provider fake and production adapters | the same interface behavior at each real seam |
| Browser smoke | diagnostic route | composition, rendering, and failure presentation |
| Manual provider smoke | small synthetic input only | real auth, response shape, latency, and cost |

Tests assert observable results through module interfaces. They do not import
an analyzer's dictionary internals, provider SDK response classes, or persistence
tables merely to make assertions easier.

## Stop conditions

Stop Phase 0 and report evidence instead of improvising if any of these remain
after the relevant patch:

- normalized spans cannot reconstruct exact target text;
- analyzer degradation cannot be distinguished from trustworthy output;
- known-word subtraction produces a false-known result on held-out fixtures;
- Card identity requires silently choosing among unresolved senses;
- unknown supporting grammar cannot be detected within a useful declared
  envelope;
- an invalid `i+1` presentation passes the frozen adversarial suite;
- valid material is rejected often enough that generation would predictably
  exhaust retries or become too expensive;
- a batched run can claim completion with missing manifest batches;
- resume can silently reissue completed or uncertain provider work, or duplicate
  evidence;
- no data topology can prove atomic write, recovery, and backup;
- normal API-key setup requires JSON copying, leaks the key, or lacks a credible
  threat model; or
- closing the gap requires building SRS, sync, Watch, or another later phase to
  make the spike appear successful.

Changing the PRD, adding a material external dependency, or expanding the phase
after a stop condition requires an explicit decision before work resumes.

## Phase completion checklist

- [ ] Patches 0.1 through 0.7 are merged independently and `main` is green.
- [ ] Calibration and frozen holdout fixtures are committed and licensed.
- [ ] Analyzer thresholds pass without trusted fallback output.
- [ ] Validator thresholds pass, including unknown supporting grammar.
- [ ] Agent batching is complete, resumable, idempotent, and cost-measured.
- [ ] Data and AI topology proofs pass and required decisions are recorded.
- [ ] No API key or private/copyrighted subtitle content is in git or logs.
- [ ] Diagnostic journey passes offline from a clean checkout.
- [ ] `docs/evidence/phase-0.md` recommends proceeding to Phase 1.
- [ ] `../v2-impl.md` records the result and Phase 1 inputs.

Phase 0 is not complete because a prototype looked promising. It is complete
only when this checklist and the parent plan's Phase 0 exit gate both pass.
