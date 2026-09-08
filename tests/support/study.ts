import type { Result } from "../../src/result.ts";
import { err, ok } from "../../src/result.ts";
import type {
  CardId,
  KnownWordSeed,
  PresentationPermit,
  PresentationPermitFailure,
  PresentationPermitVerifier,
  VerifiedPresentationPermit,
} from "../../src/study/contracts.ts";
import { asCardId } from "../../src/study/contracts.ts";

export type MutableClock = Readonly<{
  now: () => Date;
  set: (value: string) => void;
}>;

export const mutableClock = (initial: string): MutableClock => {
  let current = new Date(initial);
  return {
    now: () => new Date(current.getTime()),
    set: (value) => {
      current = new Date(value);
    },
  };
};

export const sequentialIds = (): (() => string) => {
  let sequence = 0;
  return () => `test-${String(++sequence).padStart(4, "0")}`;
};

export const testSeed: KnownWordSeed = {
  id: "synthetic-kaishi",
  version: "1",
  availability: "available",
  entries: [
    {
      key: "inu",
      lemma: "犬",
      reading: "いぬ",
      meaning: "dog",
      partOfSpeech: "noun",
    },
    {
      key: "neko",
      lemma: "猫",
      reading: "ねこ",
      meaning: "cat",
      partOfSpeech: "noun",
    },
  ],
};

type EncodedPermit = Readonly<{
  id: string;
  cardId: string;
  issuedAt: string;
}>;

export const permit = (
  id: string,
  cardId: CardId,
  issuedAt: Date,
): PresentationPermit => ({
  token: JSON.stringify({ id, cardId, issuedAt: issuedAt.toISOString() }),
});

export const testPermitVerifier: PresentationPermitVerifier = {
  verify: (
    candidate,
  ): Result<VerifiedPresentationPermit, PresentationPermitFailure> => {
    try {
      const parsed = JSON.parse(candidate.token) as Partial<EncodedPermit>;
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.cardId !== "string" ||
        typeof parsed.issuedAt !== "string"
      ) {
        return err({ kind: "presentationInvalid", detail: "malformed test permit" });
      }
      const issuedAt = new Date(parsed.issuedAt);
      if (!Number.isFinite(issuedAt.getTime())) {
        return err({ kind: "presentationInvalid", detail: "invalid issue time" });
      }
      return ok({
        id: parsed.id,
        cardId: asCardId(parsed.cardId),
        issuedAt,
        contractVersion: "prevalidated-fixture-v1",
      });
    } catch {
      return err({ kind: "presentationInvalid", detail: "malformed test permit" });
    }
  },
};
