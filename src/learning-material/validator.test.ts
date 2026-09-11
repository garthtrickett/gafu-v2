import { beforeAll, describe, expect, test } from "bun:test";
import {
  adversarialManifest,
  grammarBases,
  type InvalidFault,
  invalidFaults,
  type PresentationBase,
  vocabularyBases,
} from "../../tests/fixtures/learning-material/corpus.ts";
import type {
  AnalyzedText,
  BroadPartOfSpeech,
  JapaneseAnalyzer,
} from "../analysis/contracts.ts";
import type { KnownVocabularyEntry } from "../analysis/known-vocabulary.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { err } from "../result.ts";
import type {
  CardCandidate,
  DecodedPresentation,
  KnowledgeSnapshot,
  ValidationDependencies,
} from "./contracts.ts";
import { declaredGrammarDetector, declaredGrammarForms } from "./declared-grammar.ts";
import { createLearningMaterialValidator } from "./validator.ts";

const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const transparent = new Set<BroadPartOfSpeech>([
  "particle",
  "auxiliary",
  "copula",
  "symbol",
]);
const senses = {
  resolve: (token: AnalyzedText["tokens"][number]) => [`sense:${token.lemma}`],
};
const policy = { transparentPartOfSpeech: transparent };
let knowledge: KnowledgeSnapshot;
const targets = new Map<string, CardCandidate>();
const firstSupport = new Map<string, KnownVocabularyEntry>();

const presentation = (
  base: PresentationBase,
  japanese = base.japanese,
): DecodedPresentation => {
  const start = japanese.indexOf(base.targetSurface);
  return {
    japanese,
    targetSurface: base.targetSurface,
    targetSpan: {
      start,
      end: start + base.targetSurface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    readingSegments: [{ written: japanese, reading: "" }],
  };
};

const analyzeOrThrow = async (base: PresentationBase): Promise<AnalyzedText> => {
  const result = await analyzer.analyze(base.id, base.japanese);
  if (!result.ok) throw new Error(`${base.id}: ${result.error.kind}`);
  return result.value;
};

beforeAll(async () => {
  const bank = new Map<string, KnownVocabularyEntry>();
  for (const base of [...vocabularyBases, ...grammarBases]) {
    const analysis = await analyzeOrThrow(base);
    const basePresentation = presentation(base);
    const targetToken = analysis.tokens.find(
      (token) =>
        token.span.start === basePresentation.targetSpan.start &&
        token.span.end === basePresentation.targetSpan.end,
    );
    if (base.cardType === "vocabulary") {
      if (targetToken === undefined)
        throw new Error(`${base.id}: target token missing`);
      targets.set(base.id, {
        kind: "vocabulary",
        lemma: targetToken.lemma,
        reading: targetToken.reading ?? "",
        partOfSpeech: targetToken.broadPartOfSpeech,
        senseId: `sense:${targetToken.lemma}`,
      });
    } else {
      targets.set(base.id, {
        kind: "grammar",
        canonicalForm: base.grammarForm ?? "",
      });
    }
    for (const token of analysis.tokens) {
      const isTarget =
        base.cardType === "vocabulary" &&
        token.span.start === basePresentation.targetSpan.start &&
        token.span.end === basePresentation.targetSpan.end;
      if (isTarget || transparent.has(token.broadPartOfSpeech)) continue;
      const key = `${token.lemma}|${token.reading}|${token.broadPartOfSpeech}`;
      bank.set(key, {
        lemma: token.lemma,
        reading: token.reading,
        partOfSpeech: token.broadPartOfSpeech,
        scope: { kind: "allSenses" },
      });
      if (!firstSupport.has(base.id)) {
        firstSupport.set(base.id, {
          lemma: token.lemma,
          reading: token.reading,
          partOfSpeech: token.broadPartOfSpeech,
          scope: { kind: "allSenses" },
        });
      }
    }
  }
  knowledge = {
    vocabulary: [...bank.values()],
    grammar: new Set(declaredGrammarForms),
  };
});

const dependencies = (): ValidationDependencies => ({
  analyzer,
  grammar: declaredGrammarDetector,
  senses,
  policy,
});

const injectedGrammar = [
  { canonicalForm: "〜かもしれない", text: "かもしれない" },
  { canonicalForm: "〜のに", text: "のに困る" },
  { canonicalForm: "〜ながら", text: "ながら歩く" },
] as const;

const invalidCase = (
  base: PresentationBase,
  fault: InvalidFault,
): Readonly<{
  value: unknown;
  target: CardCandidate;
  snapshot: KnowledgeSnapshot;
  dependencies: ValidationDependencies;
}> => {
  const originalTarget = targets.get(base.id);
  if (originalTarget === undefined) throw new Error(`${base.id}: target missing`);
  let value: unknown = presentation(base);
  let target = originalTarget;
  let snapshot = knowledge;
  let deps = dependencies();

  switch (fault) {
    case "malformedStructure":
      value = { japanese: 7 };
      break;
    case "readingMismatch":
      value = {
        ...presentation(base),
        readingSegments: [{ written: "不一致", reading: "" }],
      };
      break;
    case "invalidSpan":
      value = {
        ...presentation(base),
        targetSpan: { ...presentation(base).targetSpan, start: -1 },
      };
      break;
    case "surfaceMismatch":
      value = { ...presentation(base), targetSurface: "別" };
      break;
    case "targetAbsent": {
      const japanese = base.japanese.replace(base.targetSurface, "");
      value = { ...presentation(base, japanese), targetSurface: base.targetSurface };
      break;
    }
    case "targetOnlyMetadata": {
      const japanese = base.japanese.replace(base.targetSurface, "別");
      value = {
        ...presentation(base, japanese),
        targetSurface: base.targetSurface,
        readingSegments: [{ written: japanese, reading: base.targetSurface }],
      };
      break;
    }
    case "wrongIdentity":
      target =
        originalTarget.kind === "vocabulary"
          ? { ...originalTarget, senseId: "wrong-sense" }
          : {
              kind: "grammar",
              canonicalForm:
                originalTarget.canonicalForm === "〜前に" ? "〜てもいい" : "〜前に",
            };
      break;
    case "repeatedMisleading": {
      const repeated = base.japanese.replace("。", `${base.targetSurface}。`);
      value = {
        ...presentation(base, repeated),
        targetSpan: {
          ...presentation(base, repeated).targetSpan,
          start: repeated.lastIndexOf(base.targetSurface) + 1,
        },
      };
      break;
    }
    case "oneUnknownVocabulary": {
      const japanese = base.japanese.replace("。", "宇宙船。");
      value = presentation(base, japanese);
      break;
    }
    case "severalUnknownVocabulary": {
      const japanese = base.japanese.replace("。", "宇宙船と火星人。");
      value = presentation(base, japanese);
      break;
    }
    case "unknownInflectedLookalike": {
      const japanese = base.japanese.replace("。", "走れなかった。");
      value = presentation(base, japanese);
      break;
    }
    case "knownFormWrongSense": {
      const support = firstSupport.get(base.id);
      if (support === undefined) throw new Error(`${base.id}: support token missing`);
      snapshot = {
        ...knowledge,
        vocabulary: knowledge.vocabulary
          .filter(
            (entry) =>
              entry.lemma !== support.lemma ||
              entry.reading !== support.reading ||
              entry.partOfSpeech !== support.partOfSpeech,
          )
          .concat({
            ...support,
            scope: { kind: "oneSense", senseId: "different-sense" },
          }),
      };
      break;
    }
    case "oneUnknownGrammar": {
      const injected = injectedGrammar.find(
        (item) => item.canonicalForm !== base.grammarForm,
      );
      if (injected === undefined) throw new Error("no non-target grammar fixture");
      const japanese = base.japanese.replace("。", `${injected.text}。`);
      value = presentation(base, japanese);
      snapshot = {
        ...knowledge,
        grammar: new Set(
          [...knowledge.grammar].filter((form) => form !== injected.canonicalForm),
        ),
      };
      break;
    }
    case "severalUnknownGrammar": {
      const injected = injectedGrammar
        .filter((item) => item.canonicalForm !== base.grammarForm)
        .slice(0, 2);
      const japanese = base.japanese.replace(
        "。",
        `${injected.map((item) => item.text).join("")}。`,
      );
      value = presentation(base, japanese);
      const unknownForms: ReadonlySet<string> = new Set(
        injected.map((item) => item.canonicalForm),
      );
      snapshot = {
        ...knowledge,
        grammar: new Set(
          [...knowledge.grammar].filter((form) => !unknownForms.has(form)),
        ),
      };
      break;
    }
    case "degradedOrAmbiguous": {
      if (base.cardType === "vocabulary") {
        deps = {
          ...deps,
          senses: { resolve: () => ["first-sense", "second-sense"] },
        };
      } else {
        const degraded: JapaneseAnalyzer = {
          name: "degraded-fixture",
          analyze: async () =>
            err({ kind: "degraded", cueId: base.id, cause: "injected degradation" }),
        };
        deps = { ...deps, analyzer: degraded };
      }
      break;
    }
  }
  return { value, target, snapshot, dependencies: deps };
};

describe("i/i+1 learning-material validator", () => {
  test("accepts every frozen valid vocabulary and grammar presentation", async () => {
    let acceptedVocabulary = 0;
    let acceptedGrammar = 0;
    for (const base of [...vocabularyBases, ...grammarBases]) {
      const target = targets.get(base.id);
      if (target === undefined) throw new Error(`${base.id}: target missing`);
      const result = await createLearningMaterialValidator(dependencies()).validate(
        presentation(base),
        target,
        knowledge,
      );
      if (result.ok && base.cardType === "vocabulary") acceptedVocabulary += 1;
      if (result.ok && base.cardType === "grammar") acceptedGrammar += 1;
      expect(result.ok, base.id).toBe(true);
    }
    expect(acceptedVocabulary).toBe(adversarialManifest.validVocabulary.length);
    expect(acceptedGrammar).toBe(adversarialManifest.validGrammar.length);
  }, 20_000);

  test("rejects every frozen invalid vocabulary and grammar presentation", async () => {
    let rejectedVocabulary = 0;
    let rejectedGrammar = 0;
    for (const base of [...vocabularyBases, ...grammarBases]) {
      for (const fault of invalidFaults) {
        const item = invalidCase(base, fault);
        const result = await createLearningMaterialValidator(
          item.dependencies,
        ).validate(item.value, item.target, item.snapshot);
        if (!result.ok && base.cardType === "vocabulary") rejectedVocabulary += 1;
        if (!result.ok && base.cardType === "grammar") rejectedGrammar += 1;
        expect(result.ok, `${base.id}-${fault}`).toBe(false);
        if (!result.ok) {
          const kinds = result.error.reasons.map((reason) => reason.kind);
          const expectedKind = (() => {
            switch (fault) {
              case "malformedStructure":
                return "malformedStructure";
              case "readingMismatch":
                return "readingReconstructionMismatch";
              case "invalidSpan":
              case "repeatedMisleading":
                return "invalidTargetSpan";
              case "targetAbsent":
              case "targetOnlyMetadata":
                return "targetAbsent";
              case "surfaceMismatch":
                return "targetSurfaceMismatch";
              case "wrongIdentity":
                return base.cardType === "vocabulary"
                  ? "wrongTargetIdentity"
                  : "targetAbsent";
              case "oneUnknownVocabulary":
              case "severalUnknownVocabulary":
              case "unknownInflectedLookalike":
              case "knownFormWrongSense":
                return "unknownVocabulary";
              case "oneUnknownGrammar":
              case "severalUnknownGrammar":
                return "unknownGrammar";
              case "degradedOrAmbiguous":
                return base.cardType === "vocabulary"
                  ? "ambiguousTargetIdentity"
                  : "analysisDegraded";
            }
          })();
          expect(kinds, `${base.id}-${fault}`).toContain(expectedKind);
        }
      }
    }
    expect(rejectedVocabulary).toBe(adversarialManifest.invalidVocabulary.length);
    expect(rejectedGrammar).toBe(adversarialManifest.invalidGrammar.length);
  }, 20_000);
});

describe("target span containment", () => {
  const candidate = (
    japanese: string,
    start: number,
    end: number,
  ): DecodedPresentation => ({
    japanese,
    targetSurface: japanese.normalize("NFKC").slice(start, end),
    targetSpan: { start, end, unit: "utf16-code-unit", normalization: "nfkc-v1" },
    readingSegments: [{ written: japanese, reading: "" }],
  });
  const word = (
    lemma: string,
    reading: string,
    partOfSpeech: BroadPartOfSpeech,
  ): KnownVocabularyEntry => ({
    lemma,
    reading,
    partOfSpeech,
    scope: { kind: "allSenses" },
  });

  test("a grammar target spanned whole-word contains its detected form", async () => {
    // The detector only ever matches the れた suffix; the model spans the
    // whole verb. Overlapping た-forms sit inside the span and are the
    // target's own morphology, not supporting language.
    const japanese = "昨日買われた本が高い。";
    const result = await createLearningMaterialValidator(dependencies()).validate(
      candidate(japanese, 2, 6),
      { kind: "grammar", canonicalForm: "受身形" },
      {
        vocabulary: [
          word("昨日", "きのう", "adverb"),
          word("本", "ほん", "noun"),
          word("高い", "たかい", "adjective"),
        ],
        grammar: new Set(["が"]),
      },
    );
    expect(result.ok).toBe(true);
  });

  test("a construction outside the target span still needs support", async () => {
    const japanese = "昨日買われた本が高い。";
    const result = await createLearningMaterialValidator(dependencies()).validate(
      candidate(japanese, 2, 6),
      { kind: "grammar", canonicalForm: "受身形" },
      {
        vocabulary: [
          word("昨日", "きのう", "adverb"),
          word("本", "ほん", "noun"),
          word("高い", "たかい", "adjective"),
        ],
        grammar: new Set(),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasons.map((reason) => reason.kind)).toContain(
        "unknownGrammar",
      );
    }
  });

  test("a compound vocabulary target tiles its tokens", async () => {
    // 飼育員 analyzes as 飼育|員; no token spans the word, but the tiling
    // concatenates to its lemma and reading.
    const japanese = "飼育員は多い。";
    const result = await createLearningMaterialValidator(dependencies()).validate(
      candidate(japanese, 0, 3),
      {
        kind: "vocabulary",
        lemma: "飼育員",
        reading: "しいくいん",
        partOfSpeech: "noun",
        senseId: "sense:飼育員",
      },
      {
        vocabulary: [word("多い", "おおい", "adjective")],
        grammar: new Set(["は"]),
      },
    );
    expect(result.ok).toBe(true);
  });

  test("a な-adjective stem meets its だ-lemmatized token", async () => {
    // Kuromoji lemmatizes the stem with its copula (肝心だ); the Card claims
    // the bare stem (肝心).
    const japanese = "これは肝心だ。";
    const result = await createLearningMaterialValidator(dependencies()).validate(
      candidate(japanese, 3, 5),
      {
        kind: "vocabulary",
        lemma: "肝心",
        reading: "かんじん",
        partOfSpeech: "adjective",
        senseId: "sense:肝心だ",
      },
      {
        vocabulary: [word("これ", "これ", "noun")],
        grammar: new Set(["は", "だ", "これ"]),
      },
    );
    expect(result.ok).toBe(true);
  });

  test("a covered span with the wrong form is still wrong identity", async () => {
    const japanese = "猫がいる。";
    const result = await createLearningMaterialValidator(dependencies()).validate(
      candidate(japanese, 0, 1),
      {
        kind: "vocabulary",
        lemma: "猫",
        reading: "ねこ!",
        partOfSpeech: "noun",
        senseId: "sense:猫",
      },
      {
        vocabulary: [word("いる", "いる", "verb")],
        grammar: new Set(["が", "がいる"]),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasons.map((reason) => reason.kind)).toEqual([
        "wrongTargetIdentity",
      ]);
    }
  });
});
