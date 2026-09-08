import { createHash } from "node:crypto";
import type {
  PlanDraft,
  PlanDraftBlocker,
  PlanDraftItem,
} from "../preparation-plan-contracts.ts";
import type { CreateCard } from "../study/contracts.ts";
import type { PreparationFinding } from "./contracts.ts";
import type { SubtitleSetSnapshot } from "./import-contracts.ts";
import type { StoredFinding } from "./projection.ts";

const clean = (value: string | null): string =>
  (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");

const digest = (value: unknown): string =>
  `plan-draft-v1:sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const selected = (finding: PreparationFinding): boolean =>
  finding.disposition === "include" &&
  !finding.knownForSet &&
  finding.relation !== "known" &&
  finding.classification !== "incidental";

const label = (finding: PreparationFinding): string =>
  finding.type === "grammar"
    ? finding.canonicalKey
    : `${finding.lemma ?? finding.canonicalKey}${finding.reading === null ? "" : `【${finding.reading}】`}`;

const proposedCard = (finding: PreparationFinding): CreateCard | null => {
  if (finding.type === "grammar") {
    const canonicalForm = clean(finding.canonicalKey);
    const meaning = clean(finding.meaning);
    if (canonicalForm === "" || meaning === "") return null;
    return {
      type: "grammar",
      content: {
        canonicalForm,
        meaning,
        formation: canonicalForm,
        usageNotes: "Prepared from verified subtitle evidence.",
      },
    };
  }
  const lemma = clean(finding.lemma);
  const reading = clean(finding.reading);
  const partOfSpeech = clean(finding.partOfSpeech);
  const meaning = clean(finding.meaning);
  if (lemma === "" || reading === "" || partOfSpeech === "" || meaning === "") {
    return null;
  }
  return {
    type: "vocabulary",
    content: {
      lemma,
      reading,
      partOfSpeech,
      meaning,
      usageNotes: "Prepared from verified subtitle evidence.",
    },
  };
};

const stagingPriority = (finding: PreparationFinding): number =>
  (10_000 - Math.min(9_999, finding.firstNeeded.episodeOrder)) * 1_000_000 +
  (finding.classification === "required" ? 500_000 : 0) +
  Math.min(499_999, Math.max(0, finding.priority));

export const projectPlanDraft = (
  input: Readonly<{
    set: SubtitleSetSnapshot;
    runId: string;
    studyDigest: string;
    findings: readonly StoredFinding[];
  }>,
): PlanDraft => {
  const blockers: PlanDraftBlocker[] = [];
  const items: PlanDraftItem[] = [];
  for (const finding of input.findings.filter(selected)) {
    const evidence = [
      ...new Map(
        finding.evidence.map((item) => [
          `${item.episodeKey}\0${item.cueKey}`,
          { episodeKey: item.episodeKey, cueKey: item.cueKey },
        ]),
      ).values(),
    ].sort(
      (left, right) =>
        left.episodeKey.localeCompare(right.episodeKey) ||
        left.cueKey.localeCompare(right.cueKey),
    );
    if (evidence.length === 0) {
      blockers.push({
        findingKey: finding.key,
        label: label(finding),
        reason: "missingEvidence",
      });
      continue;
    }
    if (
      finding.type === "vocabulary" &&
      (finding.resolution !== "resolved" || clean(finding.senseId) === "")
    ) {
      blockers.push({
        findingKey: finding.key,
        label: label(finding),
        reason: "ambiguousVocabulary",
      });
      continue;
    }
    const card = proposedCard(finding);
    if (card === null) {
      blockers.push({
        findingKey: finding.key,
        label: label(finding),
        reason: "missingCardContent",
      });
      continue;
    }
    const firstEvidence = finding.evidence.find(
      (item) => item.episodeOrder === finding.firstNeeded.episodeOrder,
    );
    if (firstEvidence === undefined) {
      blockers.push({
        findingKey: finding.key,
        label: label(finding),
        reason: "missingEvidence",
      });
      continue;
    }
    const claimKey =
      finding.type === "grammar"
        ? `grammar:${clean(finding.canonicalKey)}`
        : `vocabulary:${JSON.stringify([
            clean(finding.lemma),
            clean(finding.reading),
            clean(finding.partOfSpeech).toLocaleLowerCase("en"),
            clean(finding.senseId),
          ])}`;
    items.push({
      findingKey: finding.key,
      classification: finding.classification === "required" ? "required" : "helpful",
      preparationPriority: finding.priority,
      stagingPriority: stagingPriority(finding),
      rankReasons: finding.rankReasons,
      firstNeeded: {
        episodeKey: firstEvidence.episodeKey,
        episodeOrder: finding.firstNeeded.episodeOrder,
        episodeTitle: finding.firstNeeded.episodeTitle,
      },
      evidence,
      existingCardId: finding.existingCardId,
      proposedCard: { ...card, stagingPriority: stagingPriority(finding) },
      identityClaim: {
        authority: "gafu-preparation-v1",
        claimKey,
      },
    });
  }
  items.sort(
    (left, right) =>
      right.stagingPriority - left.stagingPriority ||
      left.proposedCard.type.localeCompare(right.proposedCard.type) ||
      left.identityClaim.claimKey.localeCompare(right.identityClaim.claimKey) ||
      left.findingKey.localeCompare(right.findingKey),
  );
  blockers.sort((left, right) => left.findingKey.localeCompare(right.findingKey));
  const payload = {
    version: "plan-draft-v1" as const,
    sourceKey: String(input.set.id),
    sourceRevision: input.set.sourceRevision,
    analysisRunId: input.runId,
    studyDigest: input.studyDigest,
    title: input.set.title,
    episodes: input.set.episodes.map((episode) => ({
      episodeKey: episode.episodeKey,
      order: episode.order,
      title: episode.title,
    })),
    selection: {
      required: items.filter((item) => item.classification === "required").length,
      helpful: items.filter((item) => item.classification === "helpful").length,
      grammar: items.filter((item) => item.proposedCard.type === "grammar").length,
      vocabulary: items.filter((item) => item.proposedCard.type === "vocabulary")
        .length,
    },
    blockers,
    items,
  };
  return { ...payload, digest: digest(payload) };
};
