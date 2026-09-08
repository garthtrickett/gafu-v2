import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result.ts";
import type {
  CaptureCandidate,
  CaptureOutcome,
  CaptureResolution,
  CommitCapture,
  ResolveCapture,
  Watch,
  WatchDependencies,
  WatchFailure,
} from "./contracts.ts";

type Pending = Readonly<{
  command: ResolveCapture;
  candidates: readonly CaptureCandidate[];
  expiresAt: number;
  createdAt: number;
  completed?: Readonly<{
    command: CommitCapture;
    outcome: CaptureOutcome;
  }>;
}>;

const contentParts = new Set(["noun", "verb", "adjective", "adverb", "interjection"]);
const clean = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ");
const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const validCommand = (command: ResolveCapture): boolean =>
  command.sourceVersion === "watch-source-v1" &&
  command.episodeKey.trim() !== "" &&
  command.cueKey.trim() !== "" &&
  command.cueText.length > 0 &&
  command.cueText.length <= 4_096 &&
  command.cueText === command.cueText.normalize("NFKC") &&
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(
    command.selectedSurface,
  ) &&
  Number.isSafeInteger(command.cueStartMs) &&
  Number.isSafeInteger(command.cueEndMs) &&
  command.cueStartMs >= 0 &&
  command.cueEndMs > command.cueStartMs &&
  Number.isSafeInteger(command.selectedSpan.start) &&
  Number.isSafeInteger(command.selectedSpan.end) &&
  command.selectedSpan.start >= 0 &&
  command.selectedSpan.end > command.selectedSpan.start &&
  command.selectedSpan.end <= command.cueText.length &&
  command.cueText.slice(command.selectedSpan.start, command.selectedSpan.end) ===
    command.selectedSurface;

export const createWatch = (dependencies: WatchDependencies): Watch => {
  const pending = new Map<string, Pending>();

  const now = (): Result<Date, WatchFailure> => {
    try {
      const value = dependencies.clock();
      return Number.isFinite(value.getTime())
        ? ok(new Date(value.getTime()))
        : err({ kind: "invalidCaptureSelection", detail: "Clock is invalid." });
    } catch {
      return err({ kind: "invalidCaptureSelection", detail: "Clock is invalid." });
    }
  };

  const prune = (time: number): void => {
    for (const [token, value] of pending) {
      if (value.expiresAt < time) pending.delete(token);
    }
    while (pending.size >= dependencies.maximumPending) {
      const oldest = [...pending.entries()].sort(
        (left, right) => left[1].createdAt - right[1].createdAt,
      )[0];
      if (oldest === undefined) break;
      pending.delete(oldest[0]);
    }
  };

  return {
    resolve: async (command) => {
      if (!validCommand(command)) {
        return err({
          kind: "invalidCaptureSelection",
          detail: "Selection must be one exact Japanese span inside the active cue.",
        });
      }
      const time = now();
      if (!time.ok) return time;
      const analyzed = await dependencies.analyzer.analyze(
        command.cueKey,
        command.cueText,
      );
      if (!analyzed.ok) return err({ kind: "analyzerUnavailable" });
      const candidates = analyzed.value.tokens
        .filter(
          (token) =>
            contentParts.has(token.broadPartOfSpeech) &&
            token.span.start < command.selectedSpan.end &&
            token.span.end > command.selectedSpan.start,
        )
        .map((token): CaptureCandidate => {
          const reading = clean(token.reading ?? token.lemma);
          const partOfSpeech = token.broadPartOfSpeech;
          const key = `capture-candidate-v1:sha256:${sha256([
            token.lemma,
            reading,
            partOfSpeech,
            token.span.start,
            token.span.end,
          ])}`;
          return {
            key,
            surface: token.surface,
            lemma: clean(token.lemma),
            reading,
            partOfSpeech,
            span: { start: token.span.start, end: token.span.end },
            suggestedSenseId: `local:${sha256([
              token.lemma,
              reading,
              partOfSpeech,
            ]).slice(0, 20)}`,
          };
        });
      if (candidates.length === 0) return err({ kind: "noContentCandidate" });
      prune(time.value.getTime());
      const token = dependencies.nextToken();
      const expiresAt = time.value.getTime() + dependencies.pendingTtlMs;
      pending.set(token, {
        command,
        candidates,
        expiresAt,
        createdAt: time.value.getTime(),
      });
      return ok({
        token,
        expiresAt: new Date(expiresAt).toISOString(),
        selectedSurface: command.selectedSurface,
        candidates,
      } satisfies CaptureResolution);
    },
    commit: (command) => {
      const time = now();
      if (!time.ok) return time;
      const value = pending.get(command.token);
      if (value === undefined) return err({ kind: "pendingCaptureMissing" });
      if (value.expiresAt < time.value.getTime()) {
        pending.delete(command.token);
        return err({ kind: "pendingCaptureExpired" });
      }
      if (value.completed !== undefined) {
        return JSON.stringify(value.completed.command) === JSON.stringify(command)
          ? ok(value.completed.outcome)
          : err({
              kind: "invalidCaptureIdentity",
              detail: "A completed capture token can only replay its original command.",
            });
      }
      const candidate = value.candidates.find(
        (item) => item.key === command.candidateKey,
      );
      if (candidate === undefined) return err({ kind: "captureCandidateMissing" });
      const meaning = clean(command.meaning);
      const senseId = clean(command.senseId);
      if (
        meaning === "" ||
        meaning.length > 500 ||
        senseId === "" ||
        senseId.length > 200 ||
        clean(command.operationKey) === "" ||
        command.operationKey.length > 200
      ) {
        return err({
          kind: "invalidCaptureIdentity",
          detail: "Meaning, sense label, and operation key are required.",
        });
      }
      const captured = dependencies.captureVocabulary({
        operationKey: command.operationKey,
        card: {
          type: "vocabulary",
          content: {
            lemma: candidate.lemma,
            reading: candidate.reading,
            partOfSpeech: candidate.partOfSpeech,
            meaning,
            usageNotes: "Captured deliberately from a local subtitle.",
          },
        },
        identityClaim: {
          authority: "gafu-capture-v1",
          claimKey: `vocabulary:${JSON.stringify([
            candidate.lemma,
            candidate.reading,
            candidate.partOfSpeech,
            senseId,
          ])}`,
        },
        evidence: {
          sourceKey: value.command.episodeKey,
          cueKey: value.command.cueKey,
          selectedSurface: value.command.selectedSurface,
          span: value.command.selectedSpan,
        },
      });
      if (!captured.ok) {
        return err({ kind: "studyFailure", failure: captured.error.kind });
      }
      const outcome = {
        outcome: captured.value.outcome,
        cardId: captured.value.card.id,
        lemma: candidate.lemma,
        evidenceAdded: captured.value.evidenceAdded,
      } satisfies CaptureOutcome;
      pending.set(command.token, { ...value, completed: { command, outcome } });
      return ok(outcome);
    },
  };
};
