import {
  type Card,
  type CardInput,
  createEmptyCard,
  FSRSVersion,
  fsrs,
  Rating,
  State,
} from "ts-fsrs";
import { err, ok, type Result } from "../result.ts";
import type { AnswerGrade, SchedulePhase, StudyFailure } from "./contracts.ts";

// v3: learning steps for new Cards, none for relearning. The two are
// different problems and v2 answered both the same way.
//
// Relearning is unchanged: a Card you have learned and then failed is
// scheduled by its stability and lands days away, never the same day. That
// gap is the one that helps, and re-testing a consolidated memory an hour
// later adds little to it.
//
// A new Card is the opposite case. It has no stability to schedule by, and
// one exposure followed by the first retrieval three days later is a single
// massed trial and a long silence — the spacing effect governs the gap
// between successful retrievals, and there had not been one yet. So a new
// Card is retrieved at five and ten minutes and an hour before it graduates
// to the multi-day ladder. What it is retrieved from is a freshly generated
// sentence each time, never the one just seen, so what is practised is the
// word and not the line it appeared in.
export const SCHEDULER_VERSION = `${FSRSVersion};gafu-parameters-v3`;

export type StoredSchedule = Readonly<{
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  phase: SchedulePhase;
  lastReviewAt: string | null;
}>;

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36_500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ["5m", "10m", "1h"],
  relearning_steps: [],
});

const phases: Record<State, SchedulePhase> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const states: Record<SchedulePhase, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const ratings: Record<AnswerGrade, Exclude<Rating, Rating.Manual>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const store = (card: Card): StoredSchedule => ({
  dueAt: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsedDays: card.elapsed_days,
  scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  phase: phases[card.state],
  lastReviewAt: card.last_review?.toISOString() ?? null,
});

const restore = (value: StoredSchedule): CardInput => ({
  due: value.dueAt,
  stability: value.stability,
  difficulty: value.difficulty,
  elapsed_days: value.elapsedDays,
  scheduled_days: value.scheduledDays,
  learning_steps: value.learningSteps,
  reps: value.reps,
  lapses: value.lapses,
  state: states[value.phase],
  ...(value.lastReviewAt === null ? {} : { last_review: value.lastReviewAt }),
});

export const newSchedule = (now: Date): StoredSchedule => store(createEmptyCard(now));

export const scheduleAnswer = (
  current: StoredSchedule,
  grade: AnswerGrade,
  now: Date,
): Result<StoredSchedule, StudyFailure> => {
  try {
    return ok(store(scheduler.next(restore(current), now, ratings[grade]).card));
  } catch (cause) {
    return err({
      kind: "schedulerFailed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
