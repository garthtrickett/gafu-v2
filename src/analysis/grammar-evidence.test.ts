import { expect, test } from "bun:test";
import { reconcileGrammarEvidence } from "./grammar-evidence.ts";

const span = {
  start: 2,
  end: 5,
  unit: "utf16-code-unit" as const,
  normalization: "nfkc-v1" as const,
};

test("agent grammar cannot attest its own new proposal", () => {
  expect(
    reconcileGrammarEvidence({
      normalizedText: "猫が寝ている。",
      deterministic: [],
      proposals: [
        { proposedForm: "〜ている", spans: [span], rationale: "progressive form" },
      ],
    }),
  ).toEqual([
    {
      kind: "untrustedProposal",
      proposedForm: "〜ている",
      spans: [span],
      rationale: "progressive form",
    },
  ]);
});

test("an agent may corroborate but not replace deterministic evidence", () => {
  expect(
    reconcileGrammarEvidence({
      normalizedText: "猫が寝ている。",
      deterministic: [{ canonicalForm: "〜ている", spans: [span] }],
      proposals: [
        { proposedForm: "〜ている", spans: [span], rationale: "progressive form" },
      ],
    }),
  ).toEqual([
    {
      kind: "trustedMatch",
      canonicalForm: "〜ている",
      spans: [span],
      agentCorroborated: true,
    },
  ]);
});

test("rejects proposal spans outside normalized text", () => {
  expect(
    reconcileGrammarEvidence({
      normalizedText: "猫",
      deterministic: [],
      proposals: [
        {
          proposedForm: "〜そうだ",
          spans: [{ ...span, end: 20 }],
          rationale: "appearance",
        },
      ],
    }),
  ).toEqual([
    {
      kind: "rejectedProposal",
      proposedForm: "〜そうだ",
      reason: "invalidSpan",
    },
  ]);
});
