import type {
  PlanId,
  PlanSnapshot,
  PlanStateCommand,
  PlanSummary,
  StartPlan,
} from "../preparation-plan-contracts.ts";
import type { Result } from "../result.ts";

declare const cardIdBrand: unique symbol;
export type CardId = string & { readonly [cardIdBrand]: true };

export type CardType = "grammar" | "vocabulary";
export type CardState = "staged" | "active" | "suspended";
export type AnswerGrade = "again" | "hard" | "good" | "easy";
export type SchedulePhase = "new" | "learning" | "review" | "relearning";

export type GrammarContent = Readonly<{
  canonicalForm: string;
  meaning: string;
  formation: string;
  usageNotes: string;
}>;

export type VocabularyContent = Readonly<{
  lemma: string;
  reading: string;
  partOfSpeech: string;
  meaning: string;
  usageNotes: string;
}>;

export type CreateCard =
  | Readonly<{
      type: "grammar";
      content: GrammarContent;
      stagingPriority?: number;
    }>
  | Readonly<{
      type: "vocabulary";
      content: VocabularyContent;
      stagingPriority?: number;
    }>;

export type CardContent = GrammarContent | VocabularyContent;

export type CardSummary = Readonly<{
  id: CardId;
  type: CardType;
  content: CardContent;
  state: CardState;
  supportReadyAt: string | null;
  stagedAt: string;
  admittedAt: string | null;
  dueAt: string | null;
  schedulePhase: SchedulePhase | null;
  reviewCount: number;
  /** Answers of Again in a row, reset by any other answer. */
  consecutiveFailures: number;
  /**
   * Answers other than Again in a row, reset by an Again.
   *
   * How much the sentence helps is read from this: under two, the sentence
   * gives the target away; at two or more it must not. A wrong answer takes
   * it to zero, so the help comes straight back.
   */
  consecutiveCorrect: number;
}>;

/** Correct answers in a row after which a sentence stops helping. */
export const PLAIN_AFTER_CORRECT = 2;

export type CreateCardOutcome = Readonly<{
  outcome: "created" | "existing";
  card: CardSummary;
}>;

export type SubtitleVocabularyCapture = Readonly<{
  operationKey: string;
  card: Extract<CreateCard, { type: "vocabulary" }>;
  identityClaim: Readonly<{
    authority: "gafu-capture-v1";
    claimKey: string;
  }>;
  evidence: Readonly<{
    sourceKey: string;
    cueKey: string;
    selectedSurface: string;
    span: Readonly<{ start: number; end: number }>;
  }>;
}>;

export type CaptureCardOutcome = CreateCardOutcome &
  Readonly<{ evidenceAdded: boolean }>;

export type CardQuery = Readonly<{
  search?: string;
  type?: CardType;
  state?: CardState;
  /** A page of the listing. Absent means every match, as it always did. */
  limit?: number;
  offset?: number;
}>;

/**
 * What happened when a baseline word's known-ness changed. Saying a word is
 * not known stages a Card for it, so the admission it was standing in for
 * becomes something to learn; `staged` is the Card, or null when one already
 * existed or the word was being restored.
 */
export type BaselineWordOutcome = Readonly<{
  knowledge: KnowledgeSnapshot;
  staged: CardSummary | null;
}>;

export type CardStateCommand = Readonly<{
  cardId: CardId;
  action: "markSupportReady" | "suspend" | "restore";
}>;

export type StudyPreferences = Readonly<{
  newCardsPerDay: number;
  timeZone: string;
  /**
   * How long after a first exposure its first review is asked for. Set it
   * shorter than the gap between sittings so the review lands at the next
   * one: a word recalled minutes after being shown has not been recalled.
   * Zero asks for it immediately, which is the old behaviour.
   */
  firstReviewAfterMinutes: number;
  /**
   * The hour the study day begins, in the learner's zone. Four means work
   * done at two in the morning counts towards the day just spent.
   */
  dayStartsAtHour: number;
  /**
   * Whether a tab sitting in the background may prepare the Cards that are
   * due, so returning to it finds sentences already written.
   *
   * It is a preference because it spends provider budget with nothing
   * pressed. Preparing costs a generation per Card the first time and
   * nothing afterwards, so an idle tab with everything banked is free; a
   * tab left open the day a hundred Cards come due is not.
   */
  prepareInBackground: boolean;
}>;

export type PreferenceChange = Readonly<{
  newCardsPerDay?: number;
  timeZone?: string;
  firstReviewAfterMinutes?: number;
  dayStartsAtHour?: number;
  prepareInBackground?: boolean;
}>;

export type QueueCard = Readonly<{
  card: CardSummary;
  dueAt: string;
  phase: SchedulePhase;
}>;

export type StudyQueue = Readonly<{
  generatedAt: string;
  localDay: string;
  admittedToday: number;
  newlyAdmitted: number;
  due: readonly QueueCard[];
  stagedCount: number;
}>;

export type StudyStatus = Readonly<{
  observedAt: string;
  dueCount: number;
  stagedCount: number;
  activeCount: number;
  suspendedCount: number;
}>;

export type PresentationPermit = Readonly<{ token: string }>;

/**
 * How long a presentation permit stays answerable. A session is handed to
 * the browser whole and may be worked through hours later, or after a
 * reload; the permit stays single-use and target-bound throughout. Study
 * and Learning Material both enforce this one value.
 */
export const PRESENTATION_PERMIT_LIFETIME_MS = 12 * 60 * 60 * 1_000;

export type VerifiedPresentationPermit = Readonly<{
  id: string;
  cardId: CardId;
  presentationId: string;
  issuedAt: Date;
  contractVersion: string;
}>;

export type PresentationPermitFailure =
  | { readonly kind: "presentationMissing" }
  | { readonly kind: "presentationInvalid"; readonly detail: string }
  | { readonly kind: "presentationExpired" };

export type PresentationPermitVerifier = Readonly<{
  verify: (
    permit: PresentationPermit,
    now: Date,
  ) => Result<VerifiedPresentationPermit, PresentationPermitFailure>;
}>;

export type AnswerCard = Readonly<{
  cardId: CardId;
  grade: AnswerGrade;
  permit: PresentationPermit;
}>;

export type AnswerOutcome = Readonly<{
  card: CardSummary;
  reviewedAt: string;
  nextDueAt: string;
}>;

export type KnownVocabulary = Readonly<{
  key: string;
  baselineKey: string | null;
  lemma: string;
  reading: string;
  meaning: string;
  partOfSpeech: string | null;
  source: "baseline" | "card";
  senseIds: readonly string[];
}>;

export type KnownGrammar = Readonly<{
  cardId: CardId;
  canonicalForm: string;
}>;

export type KnowledgeSnapshot = Readonly<{
  vocabulary: readonly KnownVocabulary[];
  grammar: readonly KnownGrammar[];
  baseline: Readonly<{
    id: string;
    version: string | null;
    availability: "available" | "unavailable";
    enabledCount: number;
    entries: readonly Readonly<{
      key: string;
      lemma: string;
      reading: string;
      meaning: string;
      enabled: boolean;
    }>[];
  }>;
}>;

export type StudyPreparationCard = Readonly<{
  cardId: CardId;
  type: CardType;
  state: CardState;
  supportReady: boolean;
  content: CardContent;
  identityClaims: readonly Readonly<{
    authority: string;
    claimKey: string;
  }>[];
}>;

export type StudyPreparationSnapshot = Readonly<{
  digest: string;
  vocabulary: readonly KnownVocabulary[];
  grammar: readonly KnownGrammar[];
  cards: readonly StudyPreparationCard[];
}>;

export type KnownWordSeedEntry = Readonly<{
  key: string;
  lemma: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
}>;

export type KnownWordSeed = Readonly<{
  id: string;
  version: string | null;
  availability: "available" | "unavailable";
  entries: readonly KnownWordSeedEntry[];
}>;

export type StudyBackup = Readonly<{
  bytes: Uint8Array;
  filename: string;
  createdAt: string;
  schemaVersion: number;
}>;

export type StudyFailure =
  | { readonly kind: "openFailed"; readonly detail: string }
  | { readonly kind: "migrationFailed"; readonly detail: string }
  | {
      readonly kind: "unsupportedSchema";
      readonly found: number;
      readonly supported: number;
    }
  | { readonly kind: "readFailed"; readonly detail: string }
  | { readonly kind: "writeFailed"; readonly detail: string }
  | { readonly kind: "backupFailed"; readonly detail: string }
  | { readonly kind: "invalidCard"; readonly field: string; readonly detail: string }
  | {
      readonly kind: "invalidPreference";
      readonly field: string;
      readonly detail: string;
    }
  | { readonly kind: "cardNotFound"; readonly cardId: string }
  | { readonly kind: "identityConflict"; readonly existingCardId: string }
  | {
      readonly kind: "invalidStateTransition";
      readonly state: CardState;
      readonly action: CardStateCommand["action"];
    }
  | PresentationPermitFailure
  | { readonly kind: "presentationForWrongCard" }
  | { readonly kind: "presentationAlreadyUsed" }
  | { readonly kind: "cardNotAnswerable"; readonly state: CardState }
  | { readonly kind: "schedulerFailed"; readonly detail: string }
  | { readonly kind: "clockFailed"; readonly detail: string }
  | { readonly kind: "invalidPlanDraft"; readonly detail: string }
  | { readonly kind: "planOperationConflict" }
  | { readonly kind: "planNotFound"; readonly planId: string }
  | { readonly kind: "invalidPlanTransition"; readonly detail: string }
  | { readonly kind: "invalidCapture"; readonly detail: string }
  | { readonly kind: "captureOperationConflict" };

export type Study = Readonly<{
  createCard: (input: CreateCard) => Result<CreateCardOutcome, StudyFailure>;
  listCards: (query?: CardQuery) => Result<readonly CardSummary[], StudyFailure>;
  /** How many Cards the query matches, ignoring limit and offset. */
  countCards: (query?: CardQuery) => Result<number, StudyFailure>;
  /**
   * How many vocabulary Cards became support-ready on or after an instant.
   *
   * Known vocabulary grows when a Card is *learned*, not when it is admitted:
   * a Card answered wrongly every day sits in rotation costing reviews and
   * adding nothing. The rate this counts is therefore the honest one to set
   * a daily new-Card limit against.
   */
  countSupportReadySince: (instant: Date) => Result<number, StudyFailure>;
  updateCard: (
    cardId: CardId,
    content: CardContent,
  ) => Result<CardSummary, StudyFailure>;
  setCardState: (command: CardStateCommand) => Result<CardSummary, StudyFailure>;
  studyQueue: () => Result<StudyQueue, StudyFailure>;
  status: () => Result<StudyStatus, StudyFailure>;
  answer: (command: AnswerCard) => Result<AnswerOutcome, StudyFailure>;
  recordTeaching: (cardId: CardId) => Result<CardSummary, StudyFailure>;
  knowledgeSnapshot: () => Result<KnowledgeSnapshot, StudyFailure>;
  preparationSnapshot: () => Result<StudyPreparationSnapshot, StudyFailure>;
  preferences: () => Result<StudyPreferences, StudyFailure>;
  setPreferences: (change: PreferenceChange) => Result<StudyPreferences, StudyFailure>;
  setBaselineWordEnabled: (
    key: string,
    enabled: boolean,
  ) => Result<BaselineWordOutcome, StudyFailure>;
  exportBackup: () => Result<StudyBackup, StudyFailure>;
  /**
   * Rebuilds the database file so space freed by deleted rows is returned.
   * Reports the file size before and after. Meant for a quiet moment: it
   * holds the database while it runs.
   */
  compact: () => Result<
    Readonly<{ beforeBytes: number; afterBytes: number }>,
    StudyFailure
  >;
  startPlan: (command: StartPlan) => Result<PlanSnapshot, StudyFailure>;
  listPlans: () => Result<readonly PlanSummary[], StudyFailure>;
  plan: (id: PlanId) => Result<PlanSnapshot, StudyFailure>;
  setPlanState: (command: PlanStateCommand) => Result<PlanSnapshot, StudyFailure>;
  deletePlan: (id: PlanId, confirmation: "delete") => Result<void, StudyFailure>;
  captureVocabulary: (
    command: SubtitleVocabularyCapture,
  ) => Result<CaptureCardOutcome, StudyFailure>;
  close: () => void;
}>;

export type StudyDependencies = Readonly<{
  databasePath: string;
  clock: () => Date;
  nextId: () => string;
  permitVerifier: PresentationPermitVerifier;
  knownWordSeed: KnownWordSeed;
  /**
   * Whether material can be generated for a Grammar Card naming this form.
   * Checked when the Card is created, because the generator checks it too and
   * a Card that fails there is not merely unteachable: it stops the session
   * that reaches it, so one unstudiable Card blocks the whole queue.
   */
  grammarTargetSupported: (canonicalForm: string) => boolean;
}>;

export const asCardId = (value: string): CardId => value as CardId;
