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

export const SCHEDULER_VERSION = `${FSRSVersion};gafu-parameters-v1`;

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
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
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
