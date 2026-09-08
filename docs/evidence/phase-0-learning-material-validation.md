# Phase 0 learning-material validation

**Run:** 2026-09-08  
**Runtime:** Bun 1.3.2 with the selected Kuromoji adapter

## Decision

Proceed with the independent `i`/`i+1` validation boundary for the declared
grammar envelope. Provider output is untrusted input: the validator decodes it,
normalizes it, reconstructs its reading segments, verifies the exact target,
reanalyzes the Japanese, and rejects any unproved supporting vocabulary or
grammar. It returns all safe typed reasons and never mutates study state.

The provider is not an authority for validity. The adversarial tests use a
trusted deterministic sense resolver and knowledge snapshot separately from the
candidate presentation.

## Frozen corpus

The manifest contains 40 distinct valid Vocabulary presentations and 40
distinct valid Grammar presentations. Ten targets of each type are exercised in
plain, prefaced, and dialogue-style contexts. The invalid corpus applies 15
fault classes to every valid presentation, yielding 600 invalid Vocabulary and
600 invalid Grammar presentations. Its manifest SHA-256 is
`9f29b0c88ab01f9882807496c062267de6e56358df1f15b29ff209d0c24c9e40`.

## Fixed-gate results

| Gate | Result |
|---|---:|
| Valid Vocabulary acceptance | 40/40 (100%) |
| Valid Grammar acceptance | 40/40 (100%) |
| Invalid Vocabulary rejection | 600/600 (100%) |
| Invalid Grammar rejection | 600/600 (100%) |
| False acceptance | 0/1,200 |
| Reading reconstruction faults detected | 80/80 |
| Extra/incorrect supporting vocabulary faults detected | 320/320 |
| Unknown non-target grammar faults detected | 160/160 |
| Frozen grammar constructions recognized | 22/22 |

The target-specific cases cover absence, misleading repetition, a mismatched
surface, an invalid span, a metadata-only target, wrong vocabulary sense, wrong
grammar identity, and ambiguous or degraded analysis. Each is asserted by typed
failure kind rather than an error-message substring.

## Classification policy

Particles, auxiliaries, copulas, and symbols are structurally transparent. A
name or content word is never transparent. Content vocabulary must match lemma,
reading, broad part of speech, and either an explicit all-senses Known Word Bank
entry or the trusted sense evidence for a one-sense entry. An analyzer without a
sense inventory cannot manufacture that evidence.

The grammar validator recognizes the 22 constructions declared by the frozen
Japanese oracle. Agent grammar proposals may corroborate those deterministic
matches but cannot create trusted grammar evidence themselves.

## Limitations and Phase 1/2 handoff

- The deterministic sense resolver in this experiment is a test authority, not
  a selected production dictionary. Phase 1 must decide canonical Vocabulary
  Card identity and Phase 2 must provide the corresponding trusted resolver.
- The declared grammar matcher proves a bounded envelope, not complete Japanese
  grammar understanding. Generated material outside that envelope must be
  rejected or routed through a newly tested deterministic rule.
- Regex grammar evidence can overlap (for example `〜ても` inside `〜てもいい`).
  Every overlapping non-target construction must independently be known.
- The corpus is synthetic and deliberately controlled. A separate, manually
  triggered real-provider sample remains part of the batching/provider spike;
  it cannot weaken these deterministic gates.
