import { describe, expect, test } from "bun:test";
import { canonicalizeCard } from "./identity.ts";

describe("manual Card identity", () => {
  test("normalizes equivalent grammar forms", () => {
    const ordinary = canonicalizeCard({
      type: "grammar",
      content: {
        canonicalForm: "〜 て しまう",
        meaning: "completion or regret",
        formation: "て-form + しまう",
        usageNotes: "",
      },
    });
    const fullWidth = canonicalizeCard({
      type: "grammar",
      content: {
        canonicalForm: " 〜　て　しまう ",
        meaning: "completion or regret",
        formation: "て-form + しまう",
        usageNotes: "casual contractions exist",
      },
    });

    expect(ordinary.ok).toBe(true);
    expect(fullWidth.ok).toBe(true);
    if (ordinary.ok && fullWidth.ok) {
      expect(fullWidth.value.claimKey).toBe(ordinary.value.claimKey);
    }
  });

  test("normalizes katakana readings and superficial English differences", () => {
    const first = canonicalizeCard({
      type: "vocabulary",
      content: {
        lemma: "開く",
        reading: "アク",
        partOfSpeech: "Intransitive Verb",
        meaning: "To open.",
        usageNotes: "",
      },
    });
    const retry = canonicalizeCard({
      type: "vocabulary",
      content: {
        lemma: " 開く ",
        reading: "あく",
        partOfSpeech: "intransitive   verb",
        meaning: "to open",
        usageNotes: "a different display note",
      },
    });

    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    if (first.ok && retry.ok) {
      expect(retry.value.claimKey).toBe(first.value.claimKey);
    }
  });

  test("keeps different senses distinct", () => {
    const open = canonicalizeCard({
      type: "vocabulary",
      content: {
        lemma: "あく",
        reading: "あく",
        partOfSpeech: "noun",
        meaning: "evil",
        usageNotes: "",
      },
    });
    const vacancy = canonicalizeCard({
      type: "vocabulary",
      content: {
        lemma: "あく",
        reading: "あく",
        partOfSpeech: "noun",
        meaning: "a vacancy",
        usageNotes: "",
      },
    });

    expect(
      open.ok && vacancy.ok && open.value.claimKey !== vacancy.value.claimKey,
    ).toBe(true);
  });

  test("rejects missing identity fields", () => {
    expect(
      canonicalizeCard({
        type: "vocabulary",
        content: {
          lemma: " ",
          reading: "あく",
          partOfSpeech: "verb",
          meaning: "to open",
          usageNotes: "",
        },
      }),
    ).toEqual({
      ok: false,
      error: { kind: "invalidCard", field: "lemma", detail: "is required" },
    });
  });
});
