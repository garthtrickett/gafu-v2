# Phase 3 — Subtitle Set to Preparation Gap

**Status:** Implementation complete; external provider, Kaishi, sense, grammar, and licence gates pending · 3.1
**Parent plan:** [`../v2-impl.md`](../v2-impl.md)  
**Product source:** [`../V2.md`](../V2.md)  
**Last updated:** 2026-09-08

## Goal

Turn one or more Japanese SRT files into a durable, complete, inspectable
Preparation Gap. The learner first verifies exactly which episodes were
accepted and in what order. Only then may Gafu send bounded subtitle-text
batches to the configured provider. Every proposed target remains tied to
locally verified cue evidence, compared with Study-owned knowledge, and open to
learner correction.

At the end of this phase, direct multi-file import and an equivalent ZIP import
produce the same ordered Subtitle Set and gap. Closing the app, losing a
response, or resuming later does not lose completed analysis, merge it twice,
or create any Card. Phase 4 alone turns corrected gap items into a Preparation
Plan and asks Study to write Cards.

## Phase boundaries

### In scope

- Direct import of one or more `.srt` files, or one `.zip` containing SRTs.
- Per-file acceptance, rejection, and duplicate reporting before persistence.
- Learner correction of episode title, order, and inclusion before analysis.
- Stable episode and cue evidence identities derived from subtitle content,
  not upload order or cue index alone.
- Local SRT parsing, NFKC normalization, Kuromoji/IPADIC token evidence, and the
  declared 22-form grammar detector.
- Provider-independent, complete-only, bounded agent batching with persisted
  manifests, checkpoints, normalized responses, and usage.
- A preflight that discloses provider/model, episode and cue scope, text bytes,
  estimated request count, and exactly what data leaves the machine.
- Comparison with one immutable Study snapshot containing the Known Word Bank
  and every existing Card's state.
- One canonical gap item with many evidence links, explicit ambiguity, an
  existing-Card attachment when available, and deterministic priority signals.
- Required/helpful/incidental classification, filtering, pagination, evidence
  inspection, and learner corrections.
- Explicit deletion of a Subtitle Set and all Preparation-owned analysis while
  leaving Study-owned Cards, schedules, support readiness, and reviews intact.
- Synthetic bounded fuzzing and a browser journey over non-copyrighted subtitle
  fixtures.

### Out of scope

- Creating or editing Cards from a gap, committing a Preparation Plan, or
  calculating its staging order.
- Daily admission, readiness, forecasts, or playback.
- Dictionary-grade independent sense verification. IPADIC has no trusted sense
  inventory; unresolved senses remain unresolved.
- Discovering arbitrary grammar outside the declared detector envelope.
- Nested archives, ZIP64, encrypted archives, non-SRT subtitle formats, video,
  audio, remote subtitle URLs, and directory watching.
- Automatic retry of an uncertain paid request. The learner decides after a
  clear duplicate-charge warning.

## Decisions frozen by this phase

### Import is a two-step workflow

`inspectImport` validates bytes and returns an Import Report without writing a
Subtitle Set. The report lists every input entry as accepted, duplicate, or
rejected and gives a safe inferred title and order for accepted episodes. The
learner may remove, rename, and reorder accepted files. `commitImport` then
persists one immutable source revision from the corrected report. Accepted
decoded sources are held in a short-lived, server-memory Pending Import for 15
minutes; archive bytes and rejected entries are discarded immediately. A
restart before commit requires a fresh inspection but cannot leave partial
learner data.

The report contains an opaque Pending Import token bound to exact accepted
content digests. Commit rejects an expired, forged, or partly changed report
rather than trusting filenames or browser state. A client-generated operation
key makes a repeated commit return the original Subtitle Set after a lost
response. One bad entry does not discard valid siblings. A report with no
accepted Japanese SRT cannot be committed.

Only one top-level ZIP may be selected in an archive import. Direct SRT files
may be selected together. Mixing a ZIP with direct files is rejected so the
learner gets one unambiguous manifest and equivalent direct/ZIP behavior is
testable.

### Explicit first-release input limits

The limits are policy values owned by Preparation and shown in the import UI:

| Limit | Value |
|---|---:|
| Direct files or archive entries examined | 64 |
| Bytes read from one direct SRT | 4 MiB |
| Compressed ZIP bytes | 32 MiB |
| Total accepted decoded subtitle bytes | 32 MiB |
| Total declared uncompressed archive bytes | 64 MiB |
| One archive entry after inflation | 4 MiB |
| Compression ratio for one entry | 100:1 |
| Cues in one file | 20,000 |
| Text in one cue after normalization | 4,096 UTF-16 code units |

Archives are parsed in memory and never extracted to a filesystem path. Gafu
rejects encrypted entries, ZIP64, multi-disk archives, unsupported compression,
nested archives, pathless/directory entries, inconsistent central-directory
metadata, size-limit violations, CRC mismatches, and malformed UTF-8 names.
Only stored and deflate-compressed entries are accepted. Unsupported non-SRT
entries are reported and ignored; they still count toward archive limits.

Supported text encodings are strict UTF-8 with or without BOM and UTF-16LE or
UTF-16BE with BOM. Invalid byte sequences and unlabelled legacy encodings are
reported per file rather than decoded with replacement characters. This avoids
quietly changing Japanese evidence. A future Shift-JIS adapter requires its own
fixtures and explicit encoding choice.

### Stable source provenance

Preparation distinguishes identity from editable presentation:

- `SubtitleSetId` is an opaque persisted ID for the learner-owned collection.
- `SourceRevision` is the SHA-256 of every ordered episode's normalized text
  and source timings. It changes when the committed source payload changes.
- `EpisodeKey` is `episode-v1:sha256` over the normalized cue-text sequence,
  ignoring filename, editable title, upload order, cue number, and timestamps.
- `CueKey` is `cue-v1:sha256` over the EpisodeKey, normalized cue text, the
  adjacent normalized cue texts, and the occurrence ordinal of an identical
  neighbourhood.

Timestamp alignment, filename correction, title correction, and reordering do
not change EpisodeKey or CueKey, although alignment and reordering do produce a
new Source Revision. Changing subtitle wording honestly creates new evidence
identity. Identical semantic episodes imported twice are reported as duplicates
even when filenames, cue numbers, timestamps, or supported text encodings
differ. Duplicate cues inside one episode remain distinct through the
neighbourhood and occurrence ordinal.

Stored source evidence contains the learner's local subtitle text, cue timing,
episode order, editable title, original safe display name, and source keys. Raw
filenames are display metadata, never identity or extraction destinations.

### Parsing is strict enough to be trustworthy and tolerant enough to report

SRT parsing accepts CRLF/LF, optional numeric cue labels, hours with more than
two digits, comma or period millisecond separators, and common cue settings
after the end timestamp. It preserves multiline cue text with line breaks,
removes a UTF BOM, and normalizes analysis text to NFKC.

Each cue must have a valid increasing time range and non-empty text. Cue labels
need not be consecutive or unique because they are not identities. A malformed
cue rejects that file with line and reason; it does not shift later text into a
plausible-looking cue or reject valid sibling files.

### Local evidence precedes agent proposals

Preparation runs the local analyzer over every accepted cue before remote
work. It creates vocabulary evidence from content tokens and grammar evidence
from the declared detector. Particles, auxiliaries, copulas, symbols, pure
punctuation, and whitespace are retained in the analyzed cue sent for context
but are not independent Vocabulary gap candidates.

The agent may annotate and canonicalize only supplied evidence. It may not
invent a cue, span, surface, lemma, reading, part of speech, or grammar match.
Every response is decoded locally and must reproduce the supplied cue and span.
Unknown or malformed evidence fails the batch rather than being partially
trusted.

For vocabulary, a local candidate first has a lemma-reading-POS lexical key.
The provider proposes a meaning and a versioned sense claim. When more than one
sense remains plausible, the item is marked `ambiguous` and cannot be treated
as a Phase 4 Card Draft until the learner resolves it. For grammar, the
canonical construction must be one of the locally detected forms. Agent
confidence is explanatory metadata, never local attestation.

### Complete-only resumable paid batches

One Analysis Run is a deterministic manifest over the Subtitle Set identity and revision,
normalization/analyzer versions, provider/model/prompt version, and fixed cue
batches. The Study comparison digest is deliberately absent: learner progress
can be re-compared locally without buying the same linguistic analysis again.
The default batch size is 20 cues and may be lowered by policy; it is never
enlarged dynamically after preflight.

Before the first request, Preparation persists the entire manifest and pending
checkpoints. A batch passes these states:

```text
pending -> requested -> uncertain -> completed
                              \-> retry-authorized -> uncertain
```

The response is validated and stored in the same local transaction that marks
the batch completed. Completed input digests are never submitted or merged
again. If interruption occurs after request dispatch but before local commit,
the batch stays uncertain. The current Responses call cannot be recovered by
Gafu's client request key, so automatic resubmission would risk a second charge.
The UI offers “check again” where provider recovery exists, or an explicit
“retry and possibly pay twice” action. This is honest at-most-once local
submission, not a false exactly-once claim about an external system.

Analysis is complete only when every manifest batch is completed. A partial
run remains inspectable as progress but never masquerades as the full gap. The
complete normalized responses and actual usage totals are persisted so reopen
and re-render do not call the provider or merge work again.

The OpenAI adapter uses the Responses API, strict JSON Schema output,
`store: false`, a stable hashed safety identifier, and output lookup by content
type. This matches current official OpenAI documentation: Responses accepts
JSON output, supports strict schema formatting, exposes usage, and does not
guarantee output-array position. Provider retention policy still applies and is
linked from settings; `store: false` is not described as zero data retention.

### Minimal remote scope and explicit consent

The provider receives only:

- normalized subtitle text and opaque CueKeys for one batch;
- locally measured token and declared-grammar evidence for those cues;
- candidate keys needed to return evidence-linked annotations; and
- no Study learner state. The minimum needed by this provider contract is zero
  because known/existing comparison is deterministic and local.

It never receives video, audio, filesystem paths, raw archive bytes, editable
episode titles, review history, due dates, email, API-key text inside prompts,
or full Card display content. The learner sees this scope, provider/model,
batch count, and input-byte estimate and must press Analyze. Import itself
causes no remote call.

### Study comparison has one read-only seam

Study exposes a `preparationSnapshot` that contains:

- enabled Known Word Bank lexical claims;
- every Card's immutable identity claims, type, Card ID, Card State, and
  support-ready fact; and
- a deterministic snapshot digest.

It contains no schedule internals or review history. Preparation receives the
snapshot as a value and cannot query Study's tables. Baseline/support-ready
items are excluded as known. A baseline word-level claim matches normalized
lemma, reading, and compatible broad part of speech without pretending Kaishi
provides sense IDs. A learned Card remains sense-conservative and also requires
a compatible meaning. Existing known Cards are excluded. Existing
staged, active, or suspended Cards remain visible as `existing` preparation
items with their Card attached, so Phase 4 can count them without recreating
them. A disabled baseline item is not subtracted.

Each gap projection records the Study snapshot digest separately from the
Analysis Run. If Study changes before the run completes, agent evidence remains
valid but gap comparison is marked stale; the learner refreshes comparison
locally without paying for analysis again.

### Finding, gap, existing coverage, completeness, and ranking

One `PreparationFinding` represents one proposed Vocabulary sense or one grammar
construction. It aggregates all deduplicated evidence links across cues and
episodes. Its public snapshot includes:

- type, canonical display, reading/POS or grammar form, meaning/function;
- resolution state: `resolved` or `ambiguous`;
- Study relation: `missing`, `existing`, or `known`;
- classification: `required`, `helpful`, or `incidental`;
- total occurrences, episode count, first-needed episode/cue/time;
- priority score and an explanation of its ranking signals;
- all evidence, paginated separately when large; and
- learner correction state and audit time.

Known items are counted in an analysis summary but hidden from the default view.
The Preparation Gap is precisely the complete useful set of `missing` findings:
language neither known nor represented by a current Card. Existing staged,
active, and suspended Card findings appear beside it as **existing preparation
coverage**, because Phase 4 must reuse or deliberately restore them rather than
create duplicates. Incidental missing findings remain inspectable but are not
selected by default in Phase 4.

Ranking is deterministic and versioned. It combines capped recurrence,
cross-episode reuse, earlier first need, and provider-proposed comprehension
impact. Agent impact is bounded to a small enum and cannot erase an item.
Classification defaults from the score, then the learner may override it.
Stable tie-breakers are type and canonical key. UI pagination never changes the
stored result or imposes a target-count limit.

### Corrections are overlays, not destructive rewrites

The learner may:

- choose a supplied sense or enter corrected meaning/sense metadata;
- let local Study recomparison attach a compatible existing Card;
- mark it known for this Subtitle Set;
- override required/helpful/incidental classification;
- defer or dismiss the item from the future Plan Draft.

Corrections are Preparation-owned overlays keyed to source/candidate identity
and survive local recomparison and a compatible re-analysis. They do not edit a
Study Card, mark a Card known globally, delete agent evidence, or alter the raw
source. An incompatible source revision preserves the old revision for audit
until the learner explicitly replaces or deletes it.

### Deletion cannot cross into Study

Deleting a Subtitle Set requires its exact ID and an explicit confirmation
value. One Preparation transaction removes its source files, cues, runs,
checkpoints, responses, gap projection, and corrections. It has no query or
foreign-key cascade into Study tables. Any Cards or progress that later phases
associate with the source therefore survive by construction.

## Preparation module

Preparation is one deep module. Callers do not coordinate ZIP parsing, cue
identity, database rows, analysis batching, comparison, or ranking.

```ts
type Preparation = {
  inspectImport(input: ImportInput): Promise<Result<ImportReport, PreparationFailure>>;
  commitImport(command: CommitImport): Result<SubtitleSetSnapshot, PreparationFailure>;
  listSubtitleSets(): Result<readonly SubtitleSetSummary[], PreparationFailure>;
  getSubtitleSet(id: SubtitleSetId): Result<SubtitleSetSnapshot, PreparationFailure>;
  preflight(id: SubtitleSetId, study: StudyPreparationSnapshot): Promise<Result<AnalysisPreflight, PreparationFailure>>;
  analyze(command: AnalyzeCommand): Promise<Result<PreparationSnapshot, PreparationFailure>>;
  recompare(id: SubtitleSetId, study: StudyPreparationSnapshot): Result<PreparationSnapshot, PreparationFailure>;
  correct(command: CorrectionCommand): Result<PreparationSnapshot, PreparationFailure>;
  evidence(query: EvidenceQuery): Result<EvidencePage, PreparationFailure>;
  deleteSubtitleSet(command: DeleteSubtitleSet): Result<void, PreparationFailure>;
  close(): void;
};
```

`analyze` creates or resumes the deterministic run identified by the preflight.
The command must repeat the preflight token so a changed set, provider, policy,
or Study snapshot cannot be analyzed under stale consent. Provider payloads,
archive records, prompts, SQL rows, checkpoint mechanics, ranking weights, and
parser helpers remain private.

### Injected dependencies

- production batch provider or deterministic fake;
- Japanese analyzer and declared grammar detector;
- SQLite path;
- Study preparation snapshot supplied per workflow;
- clock and ID generation;
- archive/import/ranking policy values; and
- opaque token generation.

The external AI seam has both production and deterministic adapters. Import,
SRT/ZIP parsing, evidence identity, aggregation, and ranking are in-process
implementation details tested through Preparation wherever practical.

## Persistence contract

Preparation owns a separate forward-only migration ledger in the shared SQLite
file and stores:

- Subtitle Set, current Source Revision, ordered episode metadata, accepted cue
  text/timing, and cue evidence;
- deterministic Analysis Run manifests and per-batch checkpoints;
- validated normalized provider responses and usage;
- candidate/evidence aggregation and versioned rank projection;
- Study comparison digest and existing-Card attachments; and
- learner correction overlays and audit instants.

Raw archive bytes, rejected files, provider credentials, video, audio, and
provider error bodies are not persisted. Subtitle text is private learner data
and is included in the local SQLite backup. Ordinary logs use IDs, counts,
digests, and failure kinds; they never contain subtitle bodies or API keys.

Preparation opens its own SQLite connection with foreign keys, WAL, and a busy
timeout. Its table names and migration ledger are module-specific. It references
Study Card IDs only as opaque text and intentionally has no database foreign
keys to Study tables, keeping deletion ownership one-way.

## Typed failures and recovery

Preparation distinguishes at least:

- invalid input shape, mixed import mode, unsupported extension/encoding,
  malformed SRT, and no accepted files;
- input/file/archive/inflation/ratio/cue limits;
- encrypted, corrupt, ZIP64, multi-disk, nested, and unsupported ZIP entries;
- stale import report, stale preflight, Subtitle Set/revision/cue not found;
- analyzer unavailable/degraded and locally invalid evidence;
- provider not configured, authentication, permission, rate limit, timeout,
  offline, cancelled, refusal, incomplete, and malformed output;
- uncertain paid request and explicit duplicate-charge authorization required;
- ambiguous identity, incompatible correction, and invalid classification; and
- migration, unsupported schema, read, write, and delete failures.

The browser maps each to correction, removal, configure key, retry, explicit
uncertain retry, refresh comparison, or contact/recovery guidance. Error
responses expose safe detail such as display filename and SRT line, but never
subtitle text, archive bytes, prompt bodies, provider bodies, or credentials.

## Server and browser flow

The app adds a Prepare view with four explicit stages:

```text
choose -> inspect/edit -> committed/preflight -> analyzing/paused -> gap
             \-> correct files                 \-> explicit uncertain retry
```

The server accepts multipart file bodies only at the inspect endpoint and
applies an HTTP body cap before parsing. Commit, reorder/title correction,
preflight, analysis, corrections, evidence pagination, and deletion use small
JSON intents. The browser renders module snapshots and never computes hashes,
canonical matches, known subtraction, rank, or completion.

The view defaults to required and helpful missing work, shows separate gap,
existing-coverage, and known counts without a top-N cutoff, and supports
type/classification/relation/search filters. It shows evidence counts and first
need without loading every cue; the learner opens paginated evidence on demand.
Ambiguity and existing Card state are visible before Phase 4 can create
anything.

## Patch plan

### Patch 3.1 — Refined contract, language, and provenance decision

Freeze import limits, stable evidence identity, remote scope, complete-only
resume semantics, Study comparison, gap completeness, correction ownership,
and deletion in this document. Add precise glossary terms and the stable-source
provenance ADR.

**Gate:** every Phase 3 product requirement has one authority and recovery
owner; the design makes no dictionary-grade sense or exactly-once provider
claim that current evidence cannot support.

### Patch 3.2 — Safe import and stable cue evidence

Implement two-step direct/ZIP import, strict decoding, safe archive inspection,
SRT parsing, duplicate detection, content-derived source keys, report-bound
commit, and import policy/fuzz tests.

**Gate:** direct and ZIP fixtures yield byte-for-byte equivalent committed
episode/cue snapshots; every limit and corrupt/encrypted/unsupported path is a
typed per-entry or import failure; no archive path reaches filesystem writes.

### Patch 3.3 — Durable Preparation and Study comparison seams

Add Preparation migrations, source/run/correction persistence, reopen/delete
behavior, and Study's read-only preparation snapshot with all Card states and
immutable claims.

**Gate:** reload preserves sets and corrected order; a Study change only marks
comparison stale; deleting Preparation data leaves Study table counts and Card
progress byte-for-byte unchanged.

### Patch 3.4 — Resumable analysis and provider attestation

Compose local cue analysis with persisted manifests and checkpoints. Extend the
provider contract to return evidence-bound meaning/function, bounded impact,
confidence, and ambiguity through strict structured output. Reuse server-memory
key custody and implement explicit uncertain retry semantics.

**Gate:** completed batches never resubmit; interruption at every checkpoint
state resumes honestly; invented/altered cues and spans fail locally; preflight
matches the requests actually made.

### Patch 3.5 — Complete gap projection, ranking, and corrections

Aggregate canonical candidates across episodes, compare with Study, preserve
ambiguous and existing items, compute versioned deterministic rank, paginate
without truncation, and persist correction overlays.

**Gate:** repeated targets merge with all evidence; known subtraction is
conservative; existing Cards attach without creation; corrections survive
reprojection; all useful items remain queryable.

### Patch 3.6 — Prepare browser journey and closure evidence

Add the Prepare view, upload report editing, disclosure/preflight, progress and
resume states, full gap/evidence inspection, corrections, explicit deletion,
and deterministic browser exit journey. Publish evidence and update the parent
plan.

**Gate:** the full direct and equivalent ZIP workflows pass through public
module/server/browser interfaces and all Phase 3 required checks pass.

## Refinement scenarios

The implementation and tests must answer these without caller-side
workarounds:

1. Sixty-four direct files include one empty, one malformed, one duplicate, and
   valid siblings.
2. A ZIP contains directories, macOS metadata, unsupported files, and SRTs.
3. A ZIP uses encryption, ZIP64, forged sizes, a bad CRC, or an unsupported
   compression method; a valid data-descriptor archive uses authoritative
   central-directory sizes and succeeds.
4. A tiny compressed entry claims or inflates beyond the ratio or byte limit.
5. Archive names contain traversal, absolute paths, backslashes, NUL, or invalid
   UTF-8.
6. An SRT is UTF-8, UTF-8 BOM, UTF-16LE/BE BOM, invalid UTF-8, or legacy encoded.
7. Cue labels are missing, duplicated, or non-consecutive while timings remain
   valid.
8. A cue has malformed timing, reversed time, no text, huge text, or too many
   cues.
9. The same episodes arrive directly and inside a ZIP in different file order.
10. The same episode has renamed files, shifted timestamps, or changed cue
    numbers.
11. Identical cue text and neighbourhood appear more than once in one episode.
12. Two files normalize to the same cue-text sequence but have different
    timings and names.
13. The learner changes titles/order after inspection but before commit.
14. A client tampers with an accepted digest or commits an expired report.
15. Import or commit is double-clicked or its response is lost.
16. Kuromoji fails for one cue or returns a degraded/ambiguous token.
17. One lexical surface appears with two readings or plausible senses.
18. A grammar form overlaps vocabulary and another grammar form.
19. The provider invents a cue, alters a surface/span, omits evidence, duplicates
    evidence, or returns invalid classification.
20. Analysis stops before dispatch, during dispatch, after response, or during
    local completion commit.
21. A completed run is resumed, and an uncertain run is retried without or with
    explicit duplicate-charge authorization.
22. The provider key is removed or replaced between preflight and request.
23. Study changes after preflight or during a multi-batch run.
24. A Known Word Bank entry shares a lemma but not reading/POS with evidence.
25. A known, active, staged, suspended, and missing target each matches
    evidence and enters the correct result section.
26. The same target occurs hundreds of times across several episodes.
27. A target is early and rare; another is late and frequent; ties are stable.
28. An ambiguous target ranks but cannot become a resolved future Card Draft.
29. The learner overrides classification, corrects meaning/sense, marks the item
    known-for-set, then recomputes comparison and restarts.
30. Evidence pagination changes page size or filter but not totals/rank.
31. A set is deleted while no run is active, while paused, and after completion.
32. Preparation deletion is followed by a Study snapshot and backup comparison.
33. Ordinary logs, JSON failures, and browser diagnostics are searched for
    subtitle bodies, API keys, and raw provider response text.

### Patch 3.x — Coverage before you watch

A learner picking an episode wants one number: what fraction of the words
spoken in it do they already know. The scan reported distinct words, which is
a different and far more discouraging figure — the frequent words carry most
of what is said, so knowing half an episode's vocabulary still leaves four
fifths of it understood.

- `POST /api/preparation/coverage` takes the token from an inspected import
  and reports coverage of the running words, the words to learn to reach a
  target (0.95), the same figure per file, milestone counts for 90/92/95/98%,
  and the unknown words ranked by how often they are said.
- Grammar and bound forms (`非自立`, `接尾`), interjections, numbers,
  punctuation kuromoji tags as a noun, and proper nouns cost no Card and are
  counted as covered; only content words are candidates.
- A word is known by its written form or by its reading, because subtitles
  write ordinary words in kana where the Known Word Bank holds the kanji.
  Matching on the written form alone reported hundreds of known words as new.
- The preparation view offers coverage after an import is inspected, asked
  for rather than computed automatically: tokenising a series takes a while
  and the import itself stays quick.

A Subtitle Set already saved is measured the same way, episode by episode in
watch order, through `POST /api/preparation/sets/:id/coverage`. It is
recomputed against the Known Word Bank each time, so an episode's readiness
rises as its words are learned and the panel says which episodes are ready.
Sources are reported in the order they were given rather than sorted, so
watch order survives.

**Gate:** unit tests for the buckets, reading-aware matching, the coverage
arithmetic, the ranking across files, the per-file figures, and an empty
import; the full required validation passes.

## Exit gate

Phase 3 is implemented when all of the following are true:

- direct multi-file and equivalent ZIP imports produce the same ordered
  episodes, stable cue evidence, and complete Preparation Gap;
- accepted, rejected, and duplicate inputs are visible before analysis, and
  title/order/removal corrections persist across restart;
- every supported input limit, encoding, SRT, and archive failure is typed and
  one bad entry does not silently erase valid siblings;
- import causes no provider call, and analysis starts only from a matching
  preflight that discloses provider/model, text-only scope, batch count, and
  byte estimate;
- completed batches and normalized responses survive restart and are never
  submitted or merged twice; uncertain calls require explicit, visible retry
  authorization where recovery is unavailable;
- provider candidates cannot escape locally supplied cue/span evidence;
- repeated cross-episode targets aggregate into one item with every evidence
  link, while ambiguity remains explicit;
- enabled baseline/support-ready/known items are excluded conservatively, and
  existing not-known Cards attach without Card creation;
- deterministic required/helpful/incidental ranking and learner corrections
  survive reload and local recomparison;
- no fixed batch, page, or target-count cap truncates the useful gap;
- deleting a Subtitle Set removes only Preparation-owned data and leaves all
  Study Cards, schedules, Review Events, and support readiness unchanged; and
- all required checks pass from a clean checkout.

The phase may be implementation-complete with the deterministic provider when
no paid API key is available, provided the production adapter is contract-tested
against local response shapes and the paid series smoke is recorded as an
external closure gate. It may not claim dictionary-grade sense resolution,
arbitrary grammar coverage, or exactly-once external billing.

## Required validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

Evidence records exact commands, test counts, import/archive policy versions,
normalization/analyzer/provider/prompt/rank versions, preflight versus actual
usage, resume behavior, browser journey, privacy inspection, known limitations,
and the Phase 4 handoff.

## Completion checklist

- [x] Import/archive limits and two-step commit contract are explicit.
- [x] Stable episode/cue provenance and duplicate semantics are explicit.
- [x] Sense and grammar evidence limits remain honest.
- [x] Remote scope, consent, checkpoint, and uncertain retry rules are explicit.
- [x] Study comparison and Preparation deletion ownership are explicit.
- [x] Complete gap, ranking, pagination, and correction rules are explicit.
- [x] Safe direct/ZIP import and SRT parsing are implemented.
- [x] Preparation persistence and Study comparison snapshot are implemented.
- [x] Resumable local/provider analysis is implemented.
- [x] Complete gap projection and corrections are implemented.
- [x] Prepare browser journey and phase evidence pass.
