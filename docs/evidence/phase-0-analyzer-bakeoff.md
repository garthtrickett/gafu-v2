# Phase 0 Japanese analyzer bake-off

**Run:** 2026-09-08  
**Reference runtime:** Bun 1.3.2 on Linux x64; headless Chromium from Playwright

## Decision

Select `@faanau/kuromoji` 0.2.1 with the Gafu analysis adapter for the next
Phase 0 experiments. It is the only evaluated candidate that supplies exact
surfaces, readings, dictionary forms, part of speech, and conjugation while
meeting the frozen selection gates. It runs in a browser Web Worker so its
roughly 1.4-second cold load does not freeze the UI.

This selects an analysis implementation, not final Vocabulary Card identity.
IPADIC has no sense inventory. The adapter therefore returns no fabricated
sense and the subtraction boundary leaves sense-specific content vocabulary
unresolved. Only an explicit all-senses Known Word Bank entry can bypass that
requirement. Phase 1 still needs the product decision about lemma-versus-sense
identity and a dictionary authority if sense-level subtraction is required.

## Candidate comparison

| Candidate | Selected | Linguistic result | Runtime/maintenance result |
|---|---:|---|---|
| V1 Kuromoji behavior | No | Has useful IPADIC fields, but dictionary failure can become apparently successful regex tokens; grammar is catalogue-alias limited; identity omits sense | Legacy behavior only; no source copied |
| `@faanau/kuromoji` 0.2.1 | Yes | Final fresh holdout: 40/40 combined lemma, reading, and broad POS; 38/40 exact conjugation labels | Apache-2.0; maintained fork; about 17 MiB dictionary; browser and Bun; worker-capable |
| `@libraz/suzume` 0.9.10 | No | 34/40 lemma, 0/40 reading, 30/40 broad POS, 0/40 combined on the final set | Apache-2.0; 568 KiB WASM; fast cold load but about 33.87 ms/cue here; explicitly does not provide readings |

Suzume remains a useful search tokenizer, but a missing required output is a
capability failure, not a score to fill with guessed kana.

## Selection protocol and retained failures

The original holdout was frozen before adapter tuning. The first Kuromoji run
scored 18/19 (94.7%) on combined non-ambiguous targets because the adapter had
not mapped IPADIC `形容動詞語幹` to a な-adjective. That result failed the fixed
98% gate and was not reused for selection.

After a generic mapping correction, a new 40-cue holdout was frozen at commit
`219a9db`. It scored 38/40 (95%) because two duplicate cues incorrectly named
`掃除` as the target while the fixture intended the compound verb `掃除する`.
Those two annotations were declared invalid; no analyzer change followed. Two
new unseen replacements were frozen at commit `f3eb654`, producing the final
40-cue selection set. The failed runs and replacement IDs remain in
`retest-corpus.ts` and its freeze tests.

## Final fixed-gate results

| Gate | Result |
|---|---:|
| NFKC reconstruction | 40/40 (100%) |
| Surface/span reconstruction | 411/411 (100%) |
| Target lemma | 40/40 (100%) |
| Target reading | 40/40 (100%) |
| Target broad part of speech | 40/40 (100%) |
| Combined lemma/reading/POS | 40/40 (100%) |
| Exact conjugation label | 38/40 (95%, measured but not a fixed selection gate) |
| Determinism | 10/10 full warm runs identical |
| False-known exclusions | 0/26 at-risk original-holdout tokens |
| Dictionary-load fallback | 0 trusted tokens; typed `analyzerUnavailable` |

The zero false-known result is deliberately conservative. Sense-specific
content entries remain unresolved because the analyzer has no sense evidence;
this increases the apparent Preparation Gap rather than silently deleting a
real unknown. That limitation must be addressed before claiming useful gap
recall at series scale.

## Performance and distribution observations

| Measurement | Kuromoji | Suzume |
|---|---:|---:|
| Bun cold first analysis | 2008.2 ms | 241.2 ms |
| Bun warm average over 40 cues | 1.10 ms/cue | 33.87 ms/cue |
| Bun RSS increase during sample | 272.3 MiB | 23.9 MiB |
| Browser worker cold analysis | 1384.9 ms | not measured |
| Browser worker warm analysis | 2.7 ms | not measured |
| Analyzer/dictionary payload | about 17 MiB | 568 KiB WASM |

The Vite production spike is about 18 MiB because it ships the Kuromoji package
directory, including its Apache licence, NOTICE, and compressed dictionary. The
application JS remains 9.83 kB and the worker is 29.83 kB before the dictionary.

The browser loader requires raw `.gz` bytes because it performs decompression
itself. A server must therefore send dictionary files as
`application/octet-stream` without `Content-Encoding: gzip`; otherwise browsers
decode once and the loader attempts an invalid second decode. The Vite
diagnostic server enforces this transport for the spike. Phase 0.6 must decide
the owned production serving location rather than relying on arbitrary static
host defaults.

## Grammar evidence boundary

Morphological analysis does not discover a trustworthy grammar syllabus by
itself. Deterministic matches against the declared supported construction set
are trusted evidence. Agent results enter as proposals with normalized UTF-16
spans. An exact proposal may corroborate a deterministic match; a novel proposal
remains untrusted until a later deterministic or learner-review boundary accepts
it. Invalid spans are rejected. The agent never attests its own output.

## Known limitations

- Candidate senses remain unresolved.
- Potential and passive-looking forms can remain morphologically ambiguous.
- Exact conjugation nomenclature varies between the oracle and IPADIC even when
  lemma, reading, POS, and span are correct.
- The dictionary is large and the observed cold RSS increase is substantial.
- Browser delivery has a non-default gzip-header constraint.
- Grammar discovery and `i`/`i+1` validation are separate Patch 0.4 work; this
  selection must not be cited as proof that those are solved.
