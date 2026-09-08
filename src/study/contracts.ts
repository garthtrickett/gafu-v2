import type { Result } from "../result.ts";

declare const cardIdBrand: unique symbol;
export type CardId = string & { readonly [cardIdBrand]: true };

export type CardType = "grammar" | "vocabulary";
export type CardState = "staged" | "active" | "known" | "suspended";
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
}>;

export type CreateCardOutcome = Readonly<{
  outcome: "created" | "existing";
  card: CardSummary;
}>;

export type CardQuery = Readonly<{
  search?: string;
  type?: CardType;
  state?: CardState;
}>;

export type CardStateCommand = Readonly<{
  cardId: CardId;
  action: "markKnown" | "markNotKnown" | "suspend" | "restore";
}>;

export type StudyPreferences = Readonly<{
  newCardsPerDay: number;
  timeZone: string;
}>;

export type PreferenceChange = Readonly<{
  newCardsPerDay?: number;
  timeZone?: string;
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
  knownCount: number;
  suspendedCount: number;
}>;

export type PresentationPermit = Readonly<{ token: string }>;

export type VerifiedPresentationPermit = Readonly<{
  id: string;
  cardId: CardId;
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
  source: "baseline" | "card";
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

export type KnownWordSeedEntry = Readonly<{
  key: string;
  lemma: string;
  reading: string;
  meaning: string;
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
  | { readonly kind: "clockFailed"; readonly detail: string };

export type Study = Readonly<{
  createCard: (input: CreateCard) => Result<CreateCardOutcome, StudyFailure>;
  listCards: (query?: CardQuery) => Result<readonly CardSummary[], StudyFailure>;
  updateCard: (
    cardId: CardId,
    content: CardContent,
  ) => Result<CardSummary, StudyFailure>;
  setCardState: (command: CardStateCommand) => Result<CardSummary, StudyFailure>;
  studyQueue: () => Result<StudyQueue, StudyFailure>;
  status: () => Result<StudyStatus, StudyFailure>;
  answer: (command: AnswerCard) => Result<AnswerOutcome, StudyFailure>;
  knowledgeSnapshot: () => Result<KnowledgeSnapshot, StudyFailure>;
  preferences: () => Result<StudyPreferences, StudyFailure>;
  setPreferences: (change: PreferenceChange) => Result<StudyPreferences, StudyFailure>;
  setBaselineWordEnabled: (
    key: string,
    enabled: boolean,
  ) => Result<KnowledgeSnapshot, StudyFailure>;
  exportBackup: () => Result<StudyBackup, StudyFailure>;
  close: () => void;
}>;

export type StudyDependencies = Readonly<{
  databasePath: string;
  clock: () => Date;
  nextId: () => string;
  permitVerifier: PresentationPermitVerifier;
  knownWordSeed: KnownWordSeed;
}>;

export const asCardId = (value: string): CardId => value as CardId;
