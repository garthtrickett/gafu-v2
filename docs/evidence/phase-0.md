# Phase 0 evidence and handoff

**Evidence date:** 2026-09-08  
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium  
**Recommendation:** clear the two external closure gates, then proceed to Phase 1

## Executive result

The risky implementation seams are credible. Japanese analysis reconstructs
normalized source spans and exposes ambiguity; the learning-material validator
independently enforces the declared `i`/`i+1` envelope; content-addressed agent
batches cannot claim a partial result as complete; and a local Bun/SQLite server
can own atomic learner writes, backups, and provider credentials. The integrated
browser diagnostic composes those boundaries with no key or network.

Phase 0 is not labelled complete yet. The manual three-run provider smoke could
not run because this environment has no `OPENAI_API_KEY`, and the repository
licence is still awaiting owner selection. Phase 1 must remain planned until
both are resolved.

## Reproducible commits

| Patch | Commit(s) containing the tested implementation |
|---|---|
| 0.1 executable skeleton | `d74794e`, `0a27d16` |
| 0.2 Japanese oracle | `335dc59`, `3fd370d` |
| 0.3 analyzer bake-off | `21b98b3` through `05ef8ef` |
| 0.4 material validation | `47c4b71` |
| 0.5 resumable batching | `3e3427a` |
| 0.6 topology decisions | `d0bedd4` |
| 0.7 integrated diagnostic | `6c486f2` plus the commit containing this report |

## Exact local validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

At the integrated proof commit, these produced 60 passing unit/fixture tests and
4,843 expectations in 14.35 seconds, a successful production build in 369 ms,
and two passing Chromium journeys in 11.6 seconds. The browser route analyzes
four committed synthetic cues, subtracts a small known-word fixture, completes
four fake-agent batches, retains the final-batch target, accepts one valid
presentation, and rejects reading, vocabulary, and grammar violations.

The initial skeleton baseline was five unit tests in 128 ms, one browser test in
4.4 seconds, and 9.11 kB of application JavaScript (4.08 kB gzip). The final
diagnostic build contains 26.62 kB of application JavaScript (9.93 kB gzip), a
29.83 kB analysis worker, and 0.91 kB CSS (0.48 kB gzip). The built analyzer and
dictionary distribution is about 18 MiB.

## Fixtures and analyzer

The authored corpus contains 134 synthetic Japanese cues: 90 calibration cues
(including two unsupported inputs) and 44 original holdout cues. The frozen
holdout contains 358 non-punctuation tokens, 336 known/unknown annotations, 66
inflected targets, 25 ambiguous targets, and 44 grammar occurrences across 22
constructions. No show dialogue or private subtitle data is committed. Full
inventory, freeze digest, correction history, and annotation uncertainty are in
[the fixture review](phase-0-fixture-review.md).

The selected `@faanau/kuromoji` 0.2.1 adapter achieved 40/40 normalization,
411/411 token-span reconstruction, 40/40 combined lemma/reading/broad-POS target
matches, 38/40 exact conjugation labels, deterministic output across ten warm
runs, and zero false-known exclusions across 26 at-risk tokens. Its browser
worker cold analysis was about 1.38 seconds; warm analysis was about 2.7 ms per
cue. A failed dictionary load returns no trusted tokens. The complete bake-off,
including the retained failed holdouts, is in [the analyzer
report](phase-0-analyzer-bakeoff.md).

Suzume 0.9.10 was rejected because it supplied no readings and missed the fixed
combined target gate. Its spike adapter and WASM dependency were deleted after
the measurements were recorded.

## Learning-material validator

The frozen material corpus has 40 distinct valid Vocabulary presentations, 40
distinct valid Grammar presentations, 600 invalid cases of each type, and 15
fault classes. Results were 80/80 valid accepted and 1,200/1,200 invalid
rejected. Reconstruction faults were detected 80/80, incorrect/unknown support
vocabulary 320/320, and unknown non-target grammar 160/160. All 22 declared
grammar constructions are recognized. See [the validation
report](phase-0-learning-material-validation.md) for the confusion table,
classification policy, and limitations.

This proves a bounded grammar envelope, not universal Japanese understanding.
Particles, auxiliaries, copulas, and symbols are transparent; names and content
words are not. Sense-specific vocabulary remains unresolved unless a trusted
sense authority attests it.

## Complete and resumable batching

The four-batch fixture merges to the same 11 canonical candidates and 12
evidence links as a one-batch run. Forty shuffled completion orders are
identical. Failures before, during, and after a provider response resume from
the last committed batch; completed digests are never reissued; invalid cue IDs
or spans cannot complete; and an unretrievable uncertain request pauses for an
explicit possible-charge retry. The final-batch-only candidate is retained.

The [batching report](phase-0-batching.md) records the checkpoint protocol and
the OpenAI Responses adapter. `bun run spike:provider` is ready to perform the
required three paid, four-batch runs and report each run's requests, tokens,
duration, invalid-output rate, vocabulary/grammar recall, and optional cost.
Those results are pending rather than inferred from the deterministic fake.

## Data and AI topology

[ADR 0001](../adr/0001-local-bun-sqlite-is-the-first-release-writer.md)
selects a local Bun server and SQLite as the first-release source of truth. Its
representative Plan/Card/evidence/schedule transaction passes commit, forced
mid-transaction rollback, close/reload, backup, and restore.

[ADR 0002](../adr/0002-provider-keys-and-calls-stay-in-the-local-server.md)
keeps provider keys and calls out of browser JavaScript. A pasted key is
verified before replacing the current key and can be removed. First-release
custody is server memory, so restart requires re-entry and backups contain no
credential. The [topology report](phase-0-topology.md) contains the scored
comparison and the evidence that would reopen either decision.

Video and audio never cross the network. An explicit series-analysis action may
send normalized subtitle cue text and local analyzer annotations to the chosen
provider; known-bank subtraction remains local. Provider retention policy still
applies to sent subtitle text.

## Dependency and distribution record

| Dependency | Role | Version | Licence | Measured footprint |
|---|---|---:|---|---:|
| `@faanau/kuromoji` | runtime analyzer and IPADIC | 0.2.1 | Apache-2.0 | about 18 MiB installed/distributed |
| `doublearray` | analyzer runtime dependency | 0.0.2 | MIT | included above |
| `lit-html` | runtime rendering | 3.3.3 | BSD-3-Clause | included in 26.62 kB app JS |
| Vite | build/dev server | 8.2.2 | MIT | development only |
| TypeScript | type checking | 7.0.2 | Apache-2.0 | development only |
| Playwright | browser checks | 1.63.0 | Apache-2.0 | development only |
| Biome | formatting/linting | 2.5.12 | MIT OR Apache-2.0 | development only |

Runtime notices are in `THIRD_PARTY_NOTICES.md`; upstream licence/notice files
remain in installed packages, and Kuromoji's files ship beside its dictionary.

## Known limitations and decisions still required

1. Run and record the three paid provider smokes. The deterministic provider is
   proof of orchestration, not proof of model recall, variability, or cost.
2. Select the repository licence. Until then V1 and `jp-player` remain
   behavioral evidence only; no source has been copied.
3. Before Phase 1 freezes Vocabulary Card identity, select a trusted dictionary
   and sense identifier. The glossary specifies one meaning, while IPADIC has no
   sense inventory.
4. The declared 22-form grammar detector is a tested starting envelope, not a
   complete grammar parser. Expansion requires new frozen evidence and rules.
5. The selected browser analyzer has a large dictionary, high cold RSS, and a
   special raw-gzip serving requirement documented in the bake-off.
6. Server-memory API-key custody intentionally trades restart convenience for a
   narrow first-release threat model. Revisit it when a tested OS secret-store
   adapter or hosted accounts exist.

## Phase 1 contract

Phase 1 may build an offline Card/SRS core around one local SQLite writer. It may
rely on versioned NFKC/UTF-16 evidence spans, typed analyzer degradation,
conservative known-word subtraction, and the independent material-validation
interface. Study alone owns Cards, schedules, learner state, plan membership,
and the transaction that changes them. The browser owns none of that state.

Phase 1 must not treat IPADIC as a sense dictionary, expose generated material
before validation, add a second browser source of truth, persist provider keys
in learner backups, or weaken the `i`/`i+1` rule. Once the two external closure
gates above pass, the technical recommendation is to proceed.
