# Phase 0 complete and resumable batching

**Run:** 2026-09-08  
**Runtime:** Bun 1.3.2

## Implementation result

The batch experiment processes the entire immutable manifest and exposes a
merged result only in the `complete` state. Run, batch, and input identities are
SHA-256-derived from cue content, batch partition, normalization and analyzer
versions, prompt version, provider, and model. The manifest reports estimated
request count and UTF-8 input bytes before any provider call.

The 12-cue, four-episode fixture forms four batches, including repeated evidence
across boundaries, one ambiguous candidate, and one required candidate only in
the final batch. It completed locally in about 14 ms with 11 canonical
candidates and 12 distinct evidence links. Its current run ID is
`run-v1:sha256:edec0c6f45354f8effd843e54614cfdfa248c4aa8b29efbd659b49c0d347cc9f`.

## Deterministic gate results

| Proof | Result |
|---|---|
| One-batch versus four-batch merge | Identical |
| Forty shuffled completion orders | Identical |
| Repeated canonical candidate | One candidate, both evidence links retained |
| Duplicate completion/evidence | Removed deterministically |
| Final-batch-only target | Present in complete result |
| Failure before request intent | Resumes from pending; no provider call made |
| Provider accepted then timed out | Retrieved and committed; no second charge |
| Provider returned then commit failed | Retrieved and committed; call not reissued |
| Completed run invoked again | No provider call reissued |
| Unretrievable uncertain request | Pauses for explicit possible-charge retry |
| Invalid cue ID or normalized span | Batch remains uncertain; run fails; no merged result |
| Incompatible resume versions | Typed failure |
| Cancellation | Typed, resumable uncertain checkpoint |

The store history verifies `requested` is durable before `uncertain`, and
`uncertain` is durable before the outbound call. A completion is stored only
after all cited cue IDs and normalized UTF-16 spans reconstruct locally.

## OpenAI adapter

The production experiment adapter uses the Responses API directly over `fetch`
with a configurable model, `store: false`, and strict JSON-schema output. The API
key is supplied by a server-side function and never appears in the body or an
error detail. Authentication, permission, rate limit, transport, timeout,
malformed structure, incomplete output, refusal, and cancellation are mapped to
the provider-independent failure union.

OpenAI response retrieval requires a provider response ID. The first version of
this adapter called the Responses API synchronously, so the ID arrived only with
the finished output: any interruption before that left an `uncertain` checkpoint
that nothing could answer. Because `retrieve` then had to return no recovery,
one timeout converted a run into a per-batch duplicate-charge decision, and the
orchestrator stopped calling the provider entirely on later resume attempts.

The adapter now dispatches with `background: true`. The POST returns as soon as
the request is queued, carrying the response ID, and the orchestrator commits it
to the checkpoint before waiting for any output. Generation is then read over
short `GET /v1/responses/{id}` polls. Two consequences:

- No single HTTP call has to be sized against the model's thinking time.
  `timeoutMs` bounds one call; `completionTimeoutMs` bounds the whole batch.
- An interrupted wait is recoverable by retrieval. `possibleDuplicateCharge` is
  now raised only for the narrow window in which a dispatch was sent but its ID
  was never committed, or in which the provider has already discarded it.

`store` stays `false`. Background responses are retained provider-side for
roughly ten minutes purely so they can be polled, which the analysis disclosure
already covers ("the provider's retention policy still applies"). A `GET` that
returns 404 means the dispatch aged out; that is reported as no recovery rather
than as a transport failure, because the two need opposite responses.

References: [create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create/),
[retrieve a model response](https://developers.openai.com/api/reference/resources/responses/methods/retrieve/),
[background mode](https://developers.openai.com/api/docs/guides/background).

## Manual provider gate

`bun run spike:provider` is a manually triggered paid smoke test. It requires
`OPENAI_API_KEY`, defaults to the user-selected `gpt-5.6-luna`, and runs three
complete four-batch analyses of the same synthetic fixture. Each run reports
model, exact cue/batch scope, request count, duration, token usage, invalid
output rate, vocabulary recall, grammar recall, and (when current per-million
prices are supplied in the two price environment variables) fixture and
12-episode cost estimates. It prints neither the key nor the prompt body.

No `OPENAI_API_KEY` was available in the implementation environment on
2026-09-08, so the three paid runs have not been executed. Patch 0.5's code and
offline gates are complete, but its manual evidence gate remains open and is not
represented as a passing result.

Because that gate never ran, no measured per-batch duration exists. The original
`timeoutMs: 60_000` was therefore never validated against a real call, and the
server analyses 20 cues per batch where this script defaulted to 3. The script
now defaults to the server's batch size (`OPENAI_BATCH_SIZE`) so that the
duration it reports bounds production batches. Until it is run, treat
`completionTimeoutMs` as an unmeasured upper bound, not a calibrated one.
