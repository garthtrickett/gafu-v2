# Phase 2 evidence and handoff

**Evidence date:** 2026-09-08  
**Reference runtime:** Bun 1.3.2, Linux x64, headless Chromium  
**Result:** implementation complete; paid-provider and existing data/licence gates pending

## Executive result

Gafu can now teach and review admitted Grammar and Vocabulary Cards with fresh
AI-shaped Learning Material while Study remains the only progress authority.
The provider proposes three structured candidates; local decoding, Kuromoji,
the declared grammar detector, Card identity, the knowledge snapshot, and the
versioned variation rule decide what can be stored and displayed. A validated
review presentation receives one opaque permit, which Study consumes in the
same transaction as the Review Event and FSRS transition.

The browser journey configures an API key without JSON, admits a Card, shows a
teaching presentation without grade controls, acknowledges teaching, shows a
different recall presentation, reveals the answer, records one grade, and
reloads the saved result. An API key is held only in server memory and is not in
the SQLite backup.

## Implemented contracts

- `LearningMaterial.prepare` owns provider calls, local validation, bounded
  invalid-output retries, persisted reserves, atomic show selection, and permit
  issue behind one interface.
- The OpenAI adapter uses `gpt-5.6-luna` by default, the Responses API, strict
  structured output, `store: false`, typed response failures, and output-item
  scanning rather than positional assumptions.
- Key verification checks access to the selected model before replacing an
  existing in-memory key. Settings show provider, model, restart behavior, sent
  data, and retention implications; ordinary API errors return only safe kinds.
- A first `new` presentation is teaching-only. Its durable acknowledgement is
  not a Review Event and cannot earn support readiness.
- Exact variation is SHA-256 over normalized Japanese. Near variation is
  Jaccard similarity over normalized character bigrams after masking the target;
  `0.82` against recent and queued same-Card material is rejected.
- A successful three-candidate batch normally leaves two unshown validated
  reserves. Restart and key removal can still serve one; rejected or authored
  material can never act as fallback.
- Study schema v2 records baseline part of speech, allowing the future Kaishi
  seed to participate in conservative `i`/`i+1` validation rather than being
  silently ignored.
- Study now rechecks `due_at` while answering. Two tabs may hold separate valid
  permits, but only the first due answer can advance the schedule.

## Adversarial evidence

The Phase 2 tests deliberately reject malformed structure, missing target,
invalid span, reading reconstruction mismatch, wrong target metadata, unknown
supporting vocabulary, unknown non-target grammar, exact/near copies, incomplete
response, refusal, invalid JSON, timeout, cancellation, 401, 403, 429, and
offline responses. The retained Phase 0 corpus additionally exercises 1,200
frozen invalid presentations across both Card types. None receives a permit or
creates a Review Event.

The integrated file-backed journey proves:

1. teaching has no permit;
2. acknowledgement produces a separate review presentation;
3. the permit advances one FSRS schedule once;
4. replay returns `presentationAlreadyUsed`;
5. a second-tab permit after the first answer returns `cardNotAnswerable`;
6. material and teaching history survive close/reopen; and
7. an unconfigured, timing-out provider can be bypassed only by an existing
   unshown validated reserve.

## Exact validation

```bash
bun run check
bun test
bun run build
bun run test:browser
git diff --check
```

The final local run produced 104 passing tests and 5,955 expectations across 28
files, a successful Vite production build, and four passing Chromium journeys.
The browser suite includes the Phase 0 diagnostics, Phase 1 Card management,
and the Phase 2 teach-before-test flow.

## Known limitations and closure gates

1. No `OPENAI_API_KEY` is available in this environment, so the real paid
   `gpt-5.6-luna` generation smoke remains unrun. Recorded response-shape and
   transport tests prove the adapter contract, not model quality, latency,
   naturalness, or account access.
2. Grammar enforcement remains the Phase 0 22-construction envelope. Grammar
   Cards outside it fail explicitly with `unsupportedGrammarTarget`.
3. IPADIC cannot prove a requested English word sense from Japanese. Phase 2
   binds lemma, reading, broad part of speech, target span, and the Card's
   declared meaning, but does not claim dictionary-grade semantic attestation.
4. The owner-approved, redistributable Kaishi 1.5k source is still unavailable.
   The schema and validation path now carry part of speech, but production has
   no bundled baseline entries.
5. The repository licence is still awaiting owner selection.
6. API keys intentionally disappear on local-server restart. Durable custody
   remains deferred until an OS secret-store adapter has evidence.

## Phase 3 handoff

Phase 3 may rely on one working server-side provider/key boundary and the same
local analyzer, Card identities, Knowledge Snapshot, and typed failure style.
It must not reuse Learning Material prompts for subtitle analysis, let an agent
attest its own evidence, send video/audio, or broaden the grammar/sense claims.
Preparation remains a separate deep module and submits no schedule writes.
