# Grammar envelope: V1 inventory coverage

**Date:** 2026-09-09
**Branch:** `codex/grammar-envelope-v1-coverage`
**Result:** all 296 migrated V1 grammar Cards are detectable; 208 unit tests,
check, build, and 12 browser journeys pass.

## Why

The Learning Material validator requires the grammar detector to find a
grammar Card's exact `canonicalForm` at the target span, and rejects any other
detected construction the learner does not know. The declared detector covered
22 constructions while V1 migrates 296 grammar Cards, so only 3 of 296
migrated Cards could ever receive validated study material. Undetected
grammar additionally passed the `unknownGrammar` check silently, so `i`/`i+1`
was unenforced for everything outside the envelope.

## What changed

- `src/learning-material/declared-grammar.ts`: 22 → 315 patterns.
  Canonical forms are verbatim V1 `formalName`s so migrated Cards match
  exactly. NFKC note: full-width ～ normalizes to ASCII ~ while 〜 is
  unchanged; ～-named patterns match ~ surfaces.
- `tests/fixtures/japanese/v1-grammar-inventory.ts`: the 296 V1 names as
  functional interop keys (no meanings, explanations, or example sentences
  reproduced). Revisit under `LICENSE-DECISION.md`.
- `src/learning-material/v1-grammar-coverage.test.ts`: asserts every
  inventory name is declared, documents keep-all overlap policy, and pins the
  tilde behavior. Red until the last batch landed.
- `tests/fixtures/japanese/corpus.ts`: one Pattern entry (calibration + two
  holdouts) per construction; new entries append so existing fixture ids are
  stable. Corpus counts, the holdout digest, and the declared-forms count are
  bumped per batch, deliberately.
- `src/learning-material/scripted-provider.ts`: deterministic surfaces for
  every new form (bare stems like た/やすい never fire without a verb stem)
  and a ～-stripping fallback.
- Validator boundary tests (`generated-validator`, `phase2-exit`) and the
  Phase 2 browser journey now declare the background grammar their scripted
  sentences assume, via real Cards marked known (unit) and the public card
  bank (browser).

## Deliberate couplings (keep-all)

Overlapping constructions retain every identity; the learner must know each
one. New couplings in this change: の ×3, じゃない ×2, 〜た (る/う),
〜ている ×2 (+ legacy 〜ている), たばかり ×2, れる ×3, ない ×2 everywhere,
〜-prefixed originals with five verbatim V1 twins (つもりだ/のに/
かもしれない/ようになる/ながら), Verb［せる・させる］ with 使役形,
〜たばかり with ばかり, ことに with こと, と with conditional-と contexts.
Verb[よう] intentionally couples with every よう-compound.

## Accepted over-fires and ceilings

- 私と fires と (条件); 台風 fires 風; 時代 fires ～代; 一日中 fires 中;
  目的 fires 的; 社会 avoids かい only via end-anchoring; 後ろ。 fires 命令形;
  旅に fires たびに; 上がる avoids がる via the stem class.
- Kanji stems are invisible to surface regex (見た needed 見|寝|起|着|居;
  来い needed explicit cover; godan せ+てもらう never matches
  /させてもらう/). Unlisted kanji stems need analyzer-backed detection.
- Dictionary-form verb Cards (くる/する) only validate when the surface
  appears; conjugated targets need analyzer-backed span evidence.
- 帰れ。-class れ-imperatives need a command continuation to validate.
- Bare-kana きり and bare きれない rely on enumerated kanji-adjacent forms.

## Follow-up (not in this change)

1. **Alias unification:** twin names (かもしれない/〜かもしれない and four
   others, plus the の/じゃない/たばかり/れる families) force double
   knowledge. Knowing either twin should satisfy both.
2. **Onboarding:** a zero-grammar learner can no longer validate any
   generated sentence, because every sentence contains particles. Fresh users
   currently must create and mark known ~10 background Cards first. Decide
   between a seeded baseline grammar set, transparent basic grammar, or an
   explicit first-run setup flow before this reaches real learners.
3. **Analyzer-backed detection** for kanji stems, conjugated verb targets,
   and Verb + Noun syntax beyond the lexical approximation.
4. Full JLPT N5–N1 inventory beyond the V1 296.

## Validation

`bun run check`, `bun test` (208 pass), `bun run build`,
`bun run test:browser` (12 pass), `git diff --check` — all green on the
branch head.
