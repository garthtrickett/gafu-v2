# Japanese fixture oracle

The corpus contains 90 calibration cues (88 analyzable and two unsupported) and
44 frozen holdout cues. All text is short, synthetic, and written for this
repository; it contains no episode transcript or learner subtitle data.

`corpus.ts` is the authoritative fixture source. The builder turns explicit
token annotations into `nfkc-v1` normalized text and UTF-16 code-unit spans.
`schema.ts` defines the static schema and its runtime structural check.
`corpus.test.ts` checks the schema, exact normalization/span reconstruction, IDs,
and every minimum count in the Phase 0 contract.
`legacy-characterization.ts` freezes the eight unsafe V1 behaviors as explicit
V2 boundary requirements without copying their implementation.

## Annotation policy

- Readings are written in hiragana so candidates normalize into one comparison
  form even if their dictionaries use katakana.
- Lemmas are dictionary forms. Conjugations use the familiar IPADIC labels where
  they apply; broad part of speech is deliberately provider-independent.
- `knownBehavior` is oracle input for subtraction experiments, not a claim about
  a real learner.
- A token with several plausible senses records all allowed senses and is marked
  ambiguous. Those annotations do not count toward single-answer accuracy.
- Spans index normalized text, never raw text, and use JavaScript UTF-16 code
  units. Raw-to-normalized mapping remains the analyzer module's responsibility.
- Grammar spans may cover several adjacent tokens. They identify construction
  evidence and do not assert that tokenization defines grammar identity.

## Holdout protocol

Patch 0.3 must freeze each candidate and its configuration against calibration
fixtures before running the holdout evaluator. Any annotation correction after
a holdout observation invalidates that selection result and must be recorded.
Do not tune individual analyzer exceptions against holdout sentences.

The canonical JSON serialization of the 44 holdout fixtures was frozen on
2026-09-08 with SHA-256 digest
`9c5437404df6ab72b50ef66f9acb753da6629ee9379b158c6706fd718f598da6`.
The freeze test makes any later change explicit in review.
