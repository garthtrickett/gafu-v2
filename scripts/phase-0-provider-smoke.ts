import { createPreparationBatching } from "../src/preparation/batching.ts";
import { createInMemoryCheckpointStore } from "../src/preparation/in-memory-checkpoint-store.ts";
import { createOpenAiBatchProvider } from "../src/preparation/openai-batch-provider.ts";
import {
  batchingCandidates,
  batchingCues,
} from "../tests/fixtures/preparation/batching.ts";

const apiKey = process.env["OPENAI_API_KEY"] ?? "";
const model = process.env["OPENAI_MODEL"] ?? "gpt-5.6-luna";
const inputPrice = Number(process.env["OPENAI_INPUT_USD_PER_MILLION"] ?? "NaN");
const outputPrice = Number(process.env["OPENAI_OUTPUT_USD_PER_MILLION"] ?? "NaN");

if (apiKey === "") {
  throw new Error("OPENAI_API_KEY is required for the manual paid smoke run");
}

const expected = [...batchingCandidates.values()].flat();
const expectedVocabulary = expected.filter(
  (item) => item.kind === "vocabulary" && item.ambiguity.length === 0,
);
const expectedGrammar = expected.filter((item) => item.kind === "grammar");

const evidenceIdentity = (item: {
  kind: string;
  canonicalKey: string;
  cueId: string;
  span: { start: number; end: number };
}): string =>
  `${item.kind}:${item.canonicalKey}:${item.cueId}:${item.span.start}:${item.span.end}`;

for (let runNumber = 1; runNumber <= 3; runNumber += 1) {
  const provider = createOpenAiBatchProvider({
    apiKey: () => apiKey,
    model,
    promptVersion: "preparation-v1",
    timeoutMs: 60_000,
  });
  const batching = createPreparationBatching({
    provider,
    store: createInMemoryCheckpointStore(),
    normalizationVersion: "nfkc-v1",
    analyzerVersion: "kuromoji-ipadic-v1",
  });
  const manifest = await batching.createManifest(batchingCues, 3);
  const started = performance.now();
  const result = await batching.analyze(manifest);
  const durationMs = Math.round(performance.now() - started);
  const observed = new Set(
    result.merged?.flatMap((candidate) =>
      candidate.evidence.map((item) =>
        evidenceIdentity({
          kind: candidate.kind,
          canonicalKey: candidate.canonicalKey,
          cueId: item.cueId,
          span: item.span,
        }),
      ),
    ) ?? [],
  );
  const recall = (items: typeof expectedVocabulary): number =>
    items.length === 0
      ? 1
      : items.filter((item) => observed.has(evidenceIdentity(item))).length /
        items.length;
  const usage = result.batches.reduce(
    (total, batch) => {
      if (batch.state !== "completed") return total;
      return {
        input: total.input + (batch.response.usage.inputTokens ?? 0),
        output: total.output + (batch.response.usage.outputTokens ?? 0),
      };
    },
    { input: 0, output: 0 },
  );
  const estimatedFixtureCostUsd =
    Number.isFinite(inputPrice) && Number.isFinite(outputPrice)
      ? (usage.input * inputPrice + usage.output * outputPrice) / 1_000_000
      : null;
  const report = {
    run: runNumber,
    model,
    scope: { cues: batchingCues.length, batches: manifest.batches.length },
    state: result.state,
    failureKind: result.failure?.kind ?? null,
    durationMs,
    requests: result.batches.filter((batch) => batch.state !== "pending").length,
    usage,
    invalidOutputRate:
      result.failure?.kind === "invalidCueEvidence" ||
      result.failure?.kind === "malformedStructure"
        ? 1 / manifest.batches.length
        : 0,
    vocabularyRecall: recall(expectedVocabulary),
    grammarRecall: recall(expectedGrammar),
    estimatedFixtureCostUsd,
    estimatedTwelveEpisodeCostUsd:
      estimatedFixtureCostUsd === null ? null : estimatedFixtureCostUsd * 3,
  };
  console.log(JSON.stringify(report));
  if (
    result.state !== "complete" ||
    report.vocabularyRecall < 0.98 ||
    report.grammarRecall < 0.9
  ) {
    process.exitCode = 1;
  }
}
