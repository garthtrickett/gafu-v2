import type {
  BatchCheckpoint,
  CandidateEvidence,
  MergedCandidate,
} from "./batching-contracts.ts";

const evidenceKey = (evidence: CandidateEvidence): string =>
  `${evidence.cueId}\0${evidence.span.start}\0${evidence.span.end}\0${evidence.surface}`;

export const mergeCompletedBatches = (
  batches: readonly BatchCheckpoint[],
): readonly MergedCandidate[] => {
  const byCandidate = new Map<
    string,
    {
      kind: CandidateEvidence["kind"];
      canonicalKey: string;
      evidence: Map<string, CandidateEvidence>;
      ambiguity: Set<string>;
    }
  >();
  for (const batch of batches) {
    if (batch.state !== "completed") continue;
    for (const candidate of batch.response.candidates) {
      const key = `${candidate.kind}\0${candidate.canonicalKey}`;
      const aggregate = byCandidate.get(key) ?? {
        kind: candidate.kind,
        canonicalKey: candidate.canonicalKey,
        evidence: new Map(),
        ambiguity: new Set(),
      };
      aggregate.evidence.set(evidenceKey(candidate), candidate);
      for (const ambiguity of candidate.ambiguity) {
        aggregate.ambiguity.add(ambiguity);
      }
      byCandidate.set(key, aggregate);
    }
  }
  return [...byCandidate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, candidate]) => ({
      kind: candidate.kind,
      canonicalKey: candidate.canonicalKey,
      evidence: [...candidate.evidence.values()]
        .sort((left, right) => evidenceKey(left).localeCompare(evidenceKey(right)))
        .map(({ kind: _kind, canonicalKey: _canonicalKey, ...evidence }) => evidence),
      ambiguity: [...candidate.ambiguity].sort(),
    }));
};
