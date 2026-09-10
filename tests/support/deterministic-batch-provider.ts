import type {
  AnalysisBatch,
  BatchProvider,
  CandidateEvidence,
  ProviderBatchResponse,
  ProviderFailure,
  ProviderIdentity,
} from "../../src/preparation/batching-contracts.ts";
import { err, ok } from "../../src/result.ts";

type FailureInjection = Readonly<{
  batchId: string;
  failure: ProviderFailure;
  afterAccept: boolean;
}>;

export const evidence = (
  cueId: string,
  sentence: string,
  surface: string,
  kind: CandidateEvidence["kind"],
  canonicalKey: string,
  ambiguity: readonly string[] = [],
  annotation: Readonly<{
    meaning?: string;
    senseId?: string | null;
    impact?: CandidateEvidence["impact"];
    confidence?: number;
  }> = {},
): CandidateEvidence => {
  const start = sentence.indexOf(surface);
  return {
    kind,
    canonicalKey,
    cueId,
    surface,
    span: {
      start,
      end: start + surface.length,
      unit: "utf16-code-unit",
      normalization: "nfkc-v1",
    },
    meaning: annotation.meaning ?? canonicalKey,
    senseId:
      annotation.senseId === undefined
        ? kind === "vocabulary"
          ? `fixture:${canonicalKey}`
          : null
        : annotation.senseId,
    impact: annotation.impact ?? "helpful",
    confidence: annotation.confidence ?? 0.9,
    ambiguity,
  };
};

export const createDeterministicBatchProvider = (
  candidates: ReadonlyMap<string, readonly CandidateEvidence[]>,
  options: Readonly<{
    identity?: ProviderIdentity;
    failure?: FailureInjection;
    invalidEvidence?: Readonly<{
      batchId: string;
      kind: "cueId" | "span";
    }>;
    retrievalAvailable?: boolean;
  }> = {},
): BatchProvider & {
  readonly submissions: string[];
  readonly retrievals: string[];
  readonly chargedRequests: number;
} => {
  const responses = new Map<string, ProviderBatchResponse>();
  // Keyed by the provider's own id, which is what resume asks for once a
  // dispatch has been recorded.
  const dispatchedResponses = new Map<string, ProviderBatchResponse>();
  const submissions: string[] = [];
  const retrievals: string[] = [];
  const charged = new Set<string>();
  let injection = options.failure;
  const responseFor = (
    batch: AnalysisBatch,
    requestKey: string,
  ): ProviderBatchResponse => {
    const output = batch.cues.flatMap((cue) => candidates.get(cue.cueId) ?? []);
    if (batch.batchId === options.invalidEvidence?.batchId && output[0] !== undefined) {
      output[0] =
        options.invalidEvidence.kind === "cueId"
          ? { ...output[0], cueId: "cue-that-was-never-in-the-batch" }
          : {
              ...output[0],
              span: { ...output[0].span, end: output[0].span.end + 1 },
            };
    }
    return {
      providerRequestId: `fake:${requestKey}`,
      candidates: output,
      usage: {
        inputTokens: batch.cues.length * 10,
        outputTokens: output.length * 8,
      },
    };
  };
  const provider: BatchProvider & {
    readonly submissions: string[];
    readonly retrievals: string[];
    readonly chargedRequests: number;
  } = {
    identity: options.identity ?? {
      provider: "deterministic-fake",
      model: "fixture-v1",
      promptVersion: "preparation-v1",
    },
    submissions,
    retrievals,
    get chargedRequests() {
      return charged.size;
    },
    submit: async (batch, requestKey, dispatched, signal) => {
      submissions.push(batch.inputDigest);
      if (signal?.aborted === true) {
        return err({ kind: "cancelled", detail: "request was cancelled" });
      }
      const activeFailure =
        injection?.batchId === batch.batchId ? injection : undefined;
      if (activeFailure !== undefined && !activeFailure.afterAccept) {
        injection = undefined;
        return err(activeFailure.failure);
      }
      const response = responses.get(requestKey) ?? responseFor(batch, requestKey);
      responses.set(requestKey, response);
      charged.add(requestKey);
      if (options.retrievalAvailable !== false) {
        dispatchedResponses.set(response.providerRequestId, response);
      }
      // The provider accepted the request: the caller can now name it even if
      // the wait for output is interrupted.
      await dispatched(response.providerRequestId);
      if (activeFailure !== undefined) {
        injection = undefined;
        return err(activeFailure.failure);
      }
      return ok(response);
    },
    retrieve: async (providerResponseId, signal) => {
      retrievals.push(providerResponseId);
      if (signal?.aborted === true) {
        return err({ kind: "cancelled", detail: "retrieval was cancelled" });
      }
      return ok(dispatchedResponses.get(providerResponseId) ?? null);
    },
  };
  return provider;
};
