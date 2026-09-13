import { createHash } from "node:crypto";
import type { CreateCard } from "./study/contracts.ts";

declare const planIdBrand: unique symbol;
export type PlanId = string & { readonly [planIdBrand]: true };

export type PlanEvidenceReference = Readonly<{
  episodeKey: string;
  cueKey: string;
}>;

export type PlanDraftItem = Readonly<{
  findingKey: string;
  classification: "required" | "helpful";
  preparationPriority: number;
  stagingPriority: number;
  rankReasons: readonly string[];
  firstNeeded: Readonly<{
    episodeKey: string;
    episodeOrder: number;
    episodeTitle: string;
  }>;
  evidence: readonly PlanEvidenceReference[];
  existingCardId: string | null;
  proposedCard: CreateCard;
  identityClaim: Readonly<{
    authority: "gafu-preparation-v1";
    claimKey: string;
  }>;
}>;

export type PlanDraftBlocker = Readonly<{
  findingKey: string;
  label: string;
  reason: "ambiguousVocabulary" | "missingCardContent" | "missingEvidence";
}>;

export type PlanDraft = Readonly<{
  version: "plan-draft-v1";
  digest: string;
  sourceKey: string;
  sourceRevision: string;
  analysisRunId: string;
  studyDigest: string;
  title: string;
  episodes: readonly Readonly<{
    episodeKey: string;
    order: number;
    title: string;
  }>[];
  selection: Readonly<{
    required: number;
    helpful: number;
    grammar: number;
    vocabulary: number;
  }>;
  blockers: readonly PlanDraftBlocker[];
  items: readonly PlanDraftItem[];
}>;

export const planDraftDigest = (draft: Omit<PlanDraft, "digest">): string =>
  `plan-draft-v1:sha256:${createHash("sha256")
    .update(JSON.stringify(draft))
    .digest("hex")}`;

export type StartPlan = Readonly<{
  operationKey: string;
  draft: PlanDraft;
}>;

export type PlanState = "active" | "paused";

export type PlanMemberSnapshot = Readonly<{
  cardId: string;
  findingKey: string;
  type: "grammar" | "vocabulary";
  label: string;
  classification: "required" | "helpful";
  preparationPriority: number;
  firstNeededEpisodeOrder: number;
  state: "staged" | "active" | "suspended";
  supportReady: boolean;
  ready: boolean;
  evidenceCount: number;
  rankReasons: readonly string[];
}>;

export type EpisodeReadiness = Readonly<{
  episodeKey: string;
  order: number;
  title: string;
  ready: boolean;
  requiredReady: number;
  requiredTotal: number;
  helpfulReady: number;
  helpfulTotal: number;
  estimatedIntroductionDay: string | null;
  inStudyUnknownReadiness: number;
  inactiveStagedBlockers: number;
}>;

export type PlanSnapshot = Readonly<{
  id: PlanId;
  sourceKey: string;
  title: string;
  state: PlanState;
  revision: number;
  draftDigest: string;
  createdAt: string;
  updatedAt: string;
  ready: boolean;
  members: readonly PlanMemberSnapshot[];
  episodes: readonly EpisodeReadiness[];
  createdCards: number;
  reusedCards: number;
  newCardsPerDay: number;
}>;

export type PlanSummary = Pick<
  PlanSnapshot,
  "id" | "sourceKey" | "title" | "state" | "revision" | "ready" | "updatedAt"
> &
  Readonly<{ memberCount: number; readyEpisodes: number; episodeCount: number }>;

export type PlanStateCommand = Readonly<{
  planId: PlanId;
  action: "pause" | "resume";
}>;

export const asPlanId = (value: string): PlanId => value as PlanId;
