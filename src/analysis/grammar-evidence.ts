import type { TextSpan } from "./contracts.ts";

export type DeterministicGrammarEvidence = Readonly<{
  canonicalForm: string;
  spans: readonly TextSpan[];
}>;

export type AgentGrammarProposal = Readonly<{
  proposedForm: string;
  spans: readonly TextSpan[];
  rationale: string;
}>;

export type GrammarEvidenceResolution =
  | Readonly<{
      kind: "trustedMatch";
      canonicalForm: string;
      spans: readonly TextSpan[];
      agentCorroborated: boolean;
    }>
  | Readonly<{
      kind: "untrustedProposal";
      proposedForm: string;
      spans: readonly TextSpan[];
      rationale: string;
    }>
  | Readonly<{
      kind: "rejectedProposal";
      proposedForm: string;
      reason: "invalidSpan";
    }>;

const validSpans = (normalizedText: string, spans: readonly TextSpan[]): boolean =>
  spans.length > 0 &&
  spans.every(
    (span) =>
      span.normalization === "nfkc-v1" &&
      span.unit === "utf16-code-unit" &&
      span.start >= 0 &&
      span.end > span.start &&
      span.end <= normalizedText.length,
  );

const sameEvidence = (
  deterministic: DeterministicGrammarEvidence,
  proposal: AgentGrammarProposal,
): boolean =>
  deterministic.canonicalForm === proposal.proposedForm &&
  JSON.stringify(deterministic.spans) === JSON.stringify(proposal.spans);

export const reconcileGrammarEvidence = (
  input: Readonly<{
    normalizedText: string;
    deterministic: readonly DeterministicGrammarEvidence[];
    proposals: readonly AgentGrammarProposal[];
  }>,
): readonly GrammarEvidenceResolution[] => [
  ...input.deterministic.map(
    (evidence): GrammarEvidenceResolution => ({
      kind: "trustedMatch",
      canonicalForm: evidence.canonicalForm,
      spans: evidence.spans,
      agentCorroborated: input.proposals.some((proposal) =>
        sameEvidence(evidence, proposal),
      ),
    }),
  ),
  ...input.proposals
    .filter(
      (proposal) =>
        !input.deterministic.some((evidence) => sameEvidence(evidence, proposal)),
    )
    .map((proposal): GrammarEvidenceResolution => {
      if (!validSpans(input.normalizedText, proposal.spans)) {
        return {
          kind: "rejectedProposal",
          proposedForm: proposal.proposedForm,
          reason: "invalidSpan",
        };
      }
      return {
        kind: "untrustedProposal",
        proposedForm: proposal.proposedForm,
        spans: proposal.spans,
        rationale: proposal.rationale,
      };
    }),
];
