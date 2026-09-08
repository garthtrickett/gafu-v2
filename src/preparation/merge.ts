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
      meanings: Set<string>;
      senseIds: Set<string>;
      impacts: CandidateEvidence["impact"][];
      confidence: number;
    }
  >();
  for (const batch of batches) {
    if (batch.state !== "completed") continue;
    for (const candidate of batch.response.candidates) {
      const key = `${candidate.kind}\0${candidate.canonicalKey}\0${candidate.senseId ?? "ambiguous"}`;
      const aggregate = byCandidate.get(key) ?? {
        kind: candidate.kind,
        canonicalKey: candidate.canonicalKey,
        evidence: new Map(),
        ambiguity: new Set(),
        meanings: new Set(),
        senseIds: new Set(),
        impacts: [] as CandidateEvidence["impact"][],
        confidence: 0,
      };
      aggregate.evidence.set(evidenceKey(candidate), candidate);
      for (const ambiguity of candidate.ambiguity) {
        aggregate.ambiguity.add(ambiguity);
      }
      aggregate.meanings.add(candidate.meaning);
      if (candidate.senseId !== null) aggregate.senseIds.add(candidate.senseId);
      aggregate.impacts.push(candidate.impact);
      aggregate.confidence = Math.max(aggregate.confidence, candidate.confidence);
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
      meanings: [...candidate.meanings].sort(),
      senseIds: [...candidate.senseIds].sort(),
      impact: candidate.impacts.includes("required")
        ? "required"
        : candidate.impacts.includes("helpful")
          ? "helpful"
          : "incidental",
      confidence: candidate.confidence,
    }));
};
