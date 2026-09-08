import type { DetectedGrammar, GrammarDetector } from "./contracts.ts";

type GrammarPattern = Readonly<{
  canonicalForm: string;
  expression: RegExp;
}>;

const patterns: readonly GrammarPattern[] = [
  { canonicalForm: "〜ている", expression: /[てで]いる/g },
  { canonicalForm: "〜たことがある", expression: /たことがある/g },
  { canonicalForm: "〜なければならない", expression: /なければならない/g },
  { canonicalForm: "〜てもいい", expression: /てもいい/g },
  { canonicalForm: "〜てはいけない", expression: /[てで]はいけない/g },
  { canonicalForm: "〜そうだ（様態）", expression: /そうだ/g },
  { canonicalForm: "〜かもしれない", expression: /かもしれない/g },
  { canonicalForm: "〜ので", expression: /ので/g },
  { canonicalForm: "〜のに", expression: /のに/g },
  { canonicalForm: "〜ながら", expression: /ながら/g },
  {
    canonicalForm: "〜たり〜たりする",
    expression: /[ただ]り[^。]*[ただ]りする/g,
  },
  { canonicalForm: "〜ようになる", expression: /ようにな(?:る|っ)/g },
  { canonicalForm: "〜ことにする", expression: /ことにし(?:た|て|ます|よう)/g },
  { canonicalForm: "〜つもりだ", expression: /つもりだ/g },
  { canonicalForm: "〜たばかりだ", expression: /たばかりだ/g },
  { canonicalForm: "〜てしまう（縮約）", expression: /(?:ちゃ|じゃ)(?:う|っ)/g },
  { canonicalForm: "可能形", expression: /(?:[えけげせてねべめれ]る|できる)/g },
  { canonicalForm: "受身形", expression: /(?:れ|られ)(?:る|た|て)/g },
  { canonicalForm: "使役形", expression: /(?:せ|させ)(?:る|た|て)/g },
  { canonicalForm: "〜ほど〜ない", expression: /ほど[^。]*ない/g },
  { canonicalForm: "〜前に", expression: /前に/g },
  { canonicalForm: "〜ても", expression: /ても/g },
];

export const declaredGrammarForms = patterns.map((pattern) => pattern.canonicalForm);

export const declaredGrammarDetector: GrammarDetector = {
  detect: (normalizedJapanese): readonly DetectedGrammar[] =>
    patterns.flatMap((pattern) =>
      Array.from(normalizedJapanese.matchAll(pattern.expression), (match) => ({
        canonicalForm: pattern.canonicalForm,
        spans: [
          {
            start: match.index,
            end: match.index + match[0].length,
            unit: "utf16-code-unit" as const,
            normalization: "nfkc-v1" as const,
          },
        ],
      })),
    ),
};
