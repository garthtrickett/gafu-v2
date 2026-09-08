# Phase 0 fixture review

**Reviewed:** 2026-09-08  
**Source:** `tests/fixtures/japanese/corpus.ts`

## Corpus disposition

- 134 total synthetic cues: 90 calibration (including two unsupported inputs)
  and 44 holdout.
- Every holdout cue contains annotated grammar evidence.
- The holdout deliberately pairs an inflection-focused cue with a polysemous
  target for each supported construction.
- Noise variants cover interjections, punctuation, names, half-width katakana,
  emoji, newlines, and non-BMP UTF-16 offsets.
- The fixture tests enforce all contractual minimum counts and exact spans.

The frozen holdout contains 358 annotated non-punctuation tokens, 336 explicit
known/unknown classifications, 66 inflected targets, 22 ambiguous targets, and
44 grammar occurrences across 22 constructions. Its canonical serialized
SHA-256 is
`052c8cc9ce929b02eb74adcf6b64b65281c97685ac369854d38205156368fe63`.

## Uncertainty register

Twenty-two holdout targets have explicitly ambiguous senses. They are retained to
test that analyzers expose uncertainty, but they do not count toward the
single-answer lemma/reading/POS threshold. Token boundaries around auxiliary
chains and contractions may differ between dictionaries; the oracle records the
intended semantic units and candidate adapters must translate their native
tokens rather than modifying the fixture after observation.

Japanese morphological dictionaries sometimes describe the same form with more
specific labels than the broad oracle categories. Candidate-specific mapping is
allowed only when documented before holdout. It may not change surface spans,
lemma, reading, known/unknown safety, or the presence of ambiguity.

## Copyright and privacy review

All cues were constructed for this test suite. No subtitle file, show dialogue,
private generated material, or V1/`jp-player` implementation was copied.
