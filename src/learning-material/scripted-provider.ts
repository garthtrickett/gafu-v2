import { ok, type Result } from "../result.ts";
import type {
  MaterialProvider,
  MaterialProviderFailure,
  MaterialProviderRequest,
  MaterialProviderResult,
  RedactedProviderRequest,
} from "./generated-contracts.ts";
import { parseBroadPartOfSpeech } from "./generated-decode.ts";

export type ScriptedStep =
  | Result<MaterialProviderResult, MaterialProviderFailure>
  | ((
      request: MaterialProviderRequest,
    ) => Result<MaterialProviderResult, MaterialProviderFailure>);

export const createScriptedMaterialProvider = (
  steps: readonly ScriptedStep[],
): MaterialProvider => {
  let index = 0;
  let last: RedactedProviderRequest | null = null;
  return {
    identity: {
      provider: "scripted",
      model: "deterministic",
      promptVersion: "test-v1",
    },
    inspectLastRequest: () => last,
    generate: async (request) => {
      last = { endpoint: "scripted://learning-material", body: request };
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      if (step === undefined) {
        return { ok: false, error: { kind: "offline", detail: "script exhausted" } };
      }
      return typeof step === "function" ? step(request) : step;
    },
  };
};

const grammarSurface: Readonly<Record<string, string>> = {
  "〜ている": "ている",
  "〜たことがある": "たことがある",
  "〜なければならない": "なければならない",
  "〜てもいい": "てもいい",
  "〜てはいけない": "てはいけない",
  "〜そうだ（様態）": "そうだ",
  "〜かもしれない": "かもしれない",
  "〜ので": "ので",
  "〜のに": "のに",
  "〜ながら": "ながら",
  "〜たり〜たりする": "たりたりする",
  "〜ようになる": "ようになる",
  "〜ことにする": "ことにした",
  "〜つもりだ": "つもりだ",
  "〜たばかりだ": "たばかりだ",
  "〜てしまう（縮約）": "ちゃう",
  可能形: "できる",
  受身形: "られる",
  使役形: "させる",
  "〜ほど〜ない": "ほどでもない",
  "〜前に": "前に",
  "〜ても": "ても",
};

const variants = (surface: string, mode: "teach" | "review"): readonly string[] =>
  mode === "teach"
    ? [`${surface}かな。`, `でも${surface}。`, `${surface}だけだ。`]
    : [`${surface}よね。`, `${surface}だって。`, `${surface}かね。`];

export const deterministicMaterialResult = (
  request: MaterialProviderRequest,
): Result<MaterialProviderResult, MaterialProviderFailure> => {
  const content = request.card.content;
  const targetSurface =
    request.card.type === "grammar" && "canonicalForm" in content
      ? (grammarSurface[content.canonicalForm] ??
        content.canonicalForm.replaceAll("〜", ""))
      : "lemma" in content
        ? content.lemma
        : "";
  const candidates = variants(targetSurface, request.mode).map((japanese) => {
    const start = japanese.indexOf(targetSurface);
    const shared = {
      mode: request.mode,
      context: "Someone is responding naturally in a simple everyday situation.",
      prompt:
        request.mode === "teach"
          ? "Study the highlighted target."
          : "What does the target express?",
      japanese,
      targetSurface,
      targetSpan: {
        start,
        end: start + targetSurface.length,
        unit: "utf16-code-unit" as const,
        normalization: "nfkc-v1" as const,
      },
      readingSegments: [{ written: japanese, reading: "" }],
      answer: content.meaning,
      explanation: content.usageNotes || content.meaning,
      usageNote: content.usageNotes || "Use it in an appropriate everyday context.",
    };
    return request.card.type === "grammar" && "canonicalForm" in content
      ? {
          ...shared,
          targetKind: "grammar" as const,
          target: {
            canonicalForm: content.canonicalForm,
            meaning: content.meaning,
            formationHint: content.formation,
          },
        }
      : {
          ...shared,
          targetKind: "vocabulary" as const,
          target: {
            lemma: "lemma" in content ? content.lemma : "",
            reading: "reading" in content ? content.reading : "",
            partOfSpeech:
              ("partOfSpeech" in content
                ? parseBroadPartOfSpeech(content.partOfSpeech)
                : null) ?? "noun",
            meaning: content.meaning,
          },
        };
  });
  return ok({
    requestId: `scripted-${request.card.id}-${request.mode}`,
    candidates,
    provider: "scripted",
    model: "deterministic",
    promptVersion: "test-v1",
  });
};

export const createDeterministicMaterialProvider = (): MaterialProvider =>
  createScriptedMaterialProvider([deterministicMaterialResult]);
