# Phase 3 evidence and handoff

**Evidence date:** 2026-09-08
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium
**Result:** implementation complete; paid-provider, Kaishi, dictionary-sense,
grammar-envelope, and repository-licence gates remain explicit

## Executive result

Gafu can import multiple Japanese SRT files or one ZIP into a learner-edited,
durable Subtitle Set and turn the complete set into one evidence-backed
Preparation Gap. Import and local preflight make no provider call. Analysis
sends only normalized cue text and locally measured token/declared-grammar
evidence after explicit consent. It stores deterministic manifests and batch
checkpoints, validates every returned cue, span, surface, and canonical key,
then compares the complete result locally with Study.

Preparation does not create Cards or modify review state. Existing Cards are
attached as coverage, enabled baseline and learned items are subtracted, and
missing items remain available with classification, rank reasons, ambiguity,
first need, and paginated evidence. Learner meaning/sense, classification,
known-for-set, defer, and dismiss changes are timestamped overlays. Local
recomparison can change Study relations without another provider request.

## Import and provenance evidence

- Direct and ZIP imports of the same two synthetic episodes produce identical
  parsed episodes, cue keys, and final findings, even when archive/upload order
  differs.
- Natural filename ordering is only an editable default. The committed learner
  order and titles survive close/reopen.
- `EpisodeKey` depends on the normalized cue-text sequence. `CueKey` adds
  neighboring text and repeated-neighborhood ordinal. Renaming, cue renumbering,
  and timing shifts preserve those evidence keys; timings and order still alter
  `SourceRevision`.
- Inspection reports accepted, duplicate, malformed, encrypted, corrupt,
  unsupported, unsafe, and non-Japanese siblings independently. It never
  extracts archive paths.
- ZIP validation accepts stored/deflate data and valid data descriptors while
  enforcing entry count, archive bytes, declared inflated bytes, per-entry
  bytes, compression ratio, CRC, EOCD/central directory bounds, and matching
  local/central headers. ZIP64, nested, encrypted, multi-disk, unsafe-name, and
  unsupported-compression entries are rejected.
- SRT decoding is strict UTF-8 or BOM-labelled UTF-16. Parsing accepts optional
  numeric labels, LF/CRLF, comma/period milliseconds, common cue settings, and
  multiline text while rejecting malformed ranges and empty/oversized cues.
- A fixed-seed pass sent 128 bounded malformed byte archives through the public
  import inspector; every case remained a typed failure rather than escaping.

The frozen policy is `subtitle-import-v1`: 64 examined entries, 4 MiB per SRT,
32 MiB compressed archive and accepted decoded text, 64 MiB declared archive
inflation, 100:1 per-entry compression ratio, 20,000 cues per file, 4,096
normalized UTF-16 code units per cue, and a 15-minute Pending Import.

## Complete, resumable analysis evidence

The analysis identity records `nfkc-v1`, `kuromoji-ipadic`, provider/model, and
`preparation-v2`; findings record `preparation-rank-v1`. Production uses the
configured `GAFU_OPENAI_MODEL` (`gpt-5.6-luna` by default). The deterministic
closure adapter identifies as `deterministic-fake` / `fixture-v1`.

For the four-cue, one-cue-per-batch fixture, preflight estimated four requests.
The run completed exactly four batches with four submissions and 40 recorded
input tokens. Repeating the analysis submitted nothing. A separate restart
test deliberately let the provider accept the first request, returned a timeout
before local completion, closed Preparation, and reopened the SQLite file. The
saved uncertain request was retrieved, the other batches completed, and total
submissions still equaled the four-request estimate. The unretrievable path is
covered by the batching contract and pauses until the learner explicitly
accepts a possible duplicate charge.

The production OpenAI adapter uses the Responses API, strict JSON Schema,
`store: false`, a stable hashed safety identifier, content-type output scanning,
actual token usage, server-held key custody, cancellation, and a timeout.
Contract tests cover 401, 403, 429, 500/transport, timeout, cancellation,
incomplete output, refusal, malformed output, missing credentials, and lack of
recoverability from a local request key. Response bodies and credentials are
omitted from failures.

Every complete run must contain exactly one annotation for every supplied
content token and declared grammar span. Unknown/duplicate cues, altered spans
or surfaces, changed canonical keys, missing annotations, empty semantic fields,
and incompatible grammar/vocabulary sense shapes fail locally. A partial or
failed run never projects a Preparation Gap.

## Study boundary, projection, and deletion

Study exposes one read-only preparation snapshot containing enabled baseline
claims, all Card states/content/identity claims, support readiness, and a digest;
it exposes no schedule implementation or Review Events. Preparation receives
that value and has no Study database interface.

Baseline subtraction uses normalized lemma, reading, and compatible broad part
of speech because Kaishi is a word-level claim rather than a sense authority. A
fixture proves the word remains known when the provider's contextual gloss
differs. Learned and existing Vocabulary Cards remain meaning-conservative;
Grammar Cards match their canonical form. Repeated evidence merges across two
episodes, and direct/ZIP projections have identical keys, relation, counts, and
priority.

Corrections survive recomparison and restart. Undoing known-for-set restores the
original local Study relation; meaning/sense correction marks comparison stale
until local recomparison. Evidence pages do not change stored totals or rank.
Deletion cascades only through Preparation's module-specific tables. An
adversarial test snapshots every row in Study's Card, identity, progress,
schedule, admission, and review tables before import and verifies exact equality
after completed analysis and Subtitle Set deletion.

## Browser and privacy evidence

The Prepare journey imports direct files, inspects the report, edits and commits
the set, reviews provider/text/request scope, analyzes, views the complete gap,
corrects meaning/sense and known-for-set state, reloads and recomputes locally,
then explicitly deletes Preparation data. It repeats import and analysis with
the same episodes in a reversed ZIP and observes identical gap metrics.

The result UI defaults to included, required/helpful missing work and can filter
by relation, classification, type, disposition, and search. It exposes existing
coverage and known subtraction, correction timestamps, ambiguity, defer/dismiss,
and paginated source evidence without a top-N result cutoff.

The multipart server streams into a bounded 40 MiB buffer before parsing.
Inspection stores no rejected/archive body and calls no provider. Persisted local
data contains accepted subtitle cue text, so it remains private learner data and
is included in SQLite backups. Source review found no subtitle-body, raw
provider-body, or credential logging. All committed Japanese subtitle fixtures
were authored for this test suite; no show dialogue or private data is present.

## Exact validation

Run from the repository root with the exact runtime declared in `package.json`:

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The final local run produced 119 passing tests and 6,139 assertions across 30
files, a successful Vite production build, five passing Chromium journeys, and
a clean whitespace check. The Phase 3-focused subset produced 35 passing tests
and 303 assertions. The shared Kuromoji loader now reuses one in-flight/successful
dictionary load per path and evicts failed loads, avoiding parallel cold-load
timeouts without turning failure into fallback evidence.

## Known limitations and external gates

1. `OPENAI_API_KEY` was unavailable in the implementation environment. The paid
   series analysis has not been run, so model quality, real latency, usage, and
   cost are not inferred from deterministic or response-shape tests.
2. IPADIC supplies morphology but no trusted sense inventory. The provider's
   sense label remains a proposal visible for learner correction, not
   dictionary-grade semantic attestation.
3. Grammar discovery remains the declared, tested 22-construction envelope; the
   gap cannot claim universal grammar coverage.
4. The owner-approved Kaishi 1.5k production source remains unavailable, so
   production still reports an unavailable baseline rather than silently
   pretending the learner knows zero or 1,500 words.
5. Repository licence selection and durable OS-backed API-key storage remain
   open decisions. Keys intentionally remain server-memory only.

## Phase 4 handoff

Phase 4 may consume only a `complete` Preparation snapshot, default to included
required/helpful missing findings, reuse attached existing Cards, and require
ambiguous Vocabulary findings to be corrected before Card creation. It should
submit one idempotent Plan Draft to a new Study transaction that creates/reuses
Cards and memberships atomically, then rely on Study's existing shared New Cards
per Day admission. It must not re-run paid subtitle analysis when only Study
state, classifications, dispositions, or planning choices change.

Phase 4 must preserve the module boundary: Preparation owns source evidence,
analysis, corrections, and ranking; Study alone owns Cards, plan membership,
staging, schedules, and review progress. Deleting or pausing a plan must not
delete shared Cards or the Phase 3 source audit trail.
