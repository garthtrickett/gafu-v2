import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result.ts";
import {
  MAX_V1_RECORDS,
  MAX_V1_SNAPSHOT_BYTES,
  type MigrationFailure,
  V1_SNAPSHOT_VERSION,
  type V1KnowledgePoint,
  type V1Progress,
  type V1Snapshot,
} from "./contracts.ts";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const optionalArray = (recordValue: JsonRecord, key: string): readonly unknown[] =>
  Array.isArray(recordValue[key]) ? recordValue[key] : [];
const forbiddenKey =
  /authorization|cookie|credential|password|secret|token|api[-_]?key/iu;

const containsCredentialKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsCredentialKey);
  if (!record(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => forbiddenKey.test(key) || containsCredentialKey(child),
  );
};

const point = (value: unknown): V1KnowledgePoint => {
  const item = record(value) ? value : {};
  return {
    id: text(item["id"]),
    kind: text(item["kind"]),
    canonicalKey: text(item["canonical_key"] ?? item["canonicalKey"]),
    catalogueStatus: text(item["catalogue_status"] ?? item["catalogueStatus"]),
    formalName: text(item["formal_name"] ?? item["formalName"]),
    baseMeaning: text(item["base_meaning"] ?? item["baseMeaning"]),
    lemma: text(item["lemma"]),
    reading: text(item["reading"]),
    partOfSpeech: text(item["part_of_speech"] ?? item["partOfSpeech"]),
    senseKey: text(item["sense_key"] ?? item["senseKey"]),
    meaning: text(item["meaning"]),
    register: text(item["register"]),
  };
};

const progress = (value: unknown): V1Progress => {
  const item = record(value) ? value : {};
  return {
    knowledgePointId: text(
      item["knowledgePointId"] ??
        item["knowledge_point_id"] ??
        item["grammar_point_id"],
    ),
    repetitions: number(item["repetitions"]),
    intervalDays: number(item["intervalDays"] ?? item["interval_days"]),
    nextReview: text(item["nextReview"] ?? item["next_review"]),
    difficulty: number(item["difficulty"]),
    stability: number(item["stability"]),
    lastReviewedAt: text(item["lastReviewedAt"] ?? item["last_reviewed_at"]),
    participationStatus: text(
      item["participationStatus"] ?? item["participation_status"],
    ),
    learningState: text(item["learningState"] ?? item["learning_state"]),
    introducedAt: text(item["introducedAt"] ?? item["introduced_at"]),
  };
};

const uniqueNonNull = (
  values: readonly (string | null)[],
  label: string,
): Result<void, MigrationFailure> => {
  const seen = new Set<string>();
  for (const value of values) {
    if (value === null) continue;
    if (seen.has(value)) {
      return err({ kind: "snapshotInvalid", detail: `${label} IDs must be unique.` });
    }
    seen.add(value);
  }
  return ok(undefined);
};

export const snapshotDigest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const parseV1Snapshot = (
  bytes: Uint8Array,
): Result<V1Snapshot, MigrationFailure> => {
  if (bytes.byteLength > MAX_V1_SNAPSHOT_BYTES) {
    return err({ kind: "snapshotTooLarge", maximumBytes: MAX_V1_SNAPSHOT_BYTES });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return err({
      kind: "snapshotInvalid",
      detail: "Snapshot must be strict UTF-8 JSON.",
    });
  }
  if (!record(decoded) || decoded["contractVersion"] !== V1_SNAPSHOT_VERSION) {
    return err({ kind: "snapshotInvalid", detail: "Snapshot version is unsupported." });
  }
  if (containsCredentialKey(decoded)) {
    return err({
      kind: "snapshotInvalid",
      detail: "Snapshot contains a credential field.",
    });
  }
  const capturedAt = text(decoded["capturedAt"]);
  const sourceOrigin = text(decoded["sourceOrigin"]);
  const sync = decoded["sync"];
  if (
    capturedAt === null ||
    !Number.isFinite(new Date(capturedAt).getTime()) ||
    sourceOrigin === null ||
    sourceOrigin.length === 0 ||
    sourceOrigin.length > 500 ||
    !record(sync)
  ) {
    return err({ kind: "snapshotInvalid", detail: "Snapshot metadata is invalid." });
  }
  const knowledgeValues = optionalArray(sync, "knowledgePoints");
  const grammarValues = optionalArray(sync, "grammarPoints");
  const progressValues = optionalArray(sync, "srsUpdates");
  if (
    knowledgeValues.length + grammarValues.length > MAX_V1_RECORDS ||
    progressValues.length > MAX_V1_RECORDS
  ) {
    return err({ kind: "snapshotInvalid", detail: "Snapshot has too many records." });
  }
  const grammarIds = uniqueNonNull(
    grammarValues.map((value) => (record(value) ? text(value["id"]) : null)),
    "Grammar point",
  );
  if (!grammarIds.ok) return grammarIds;
  const grammarById = new Map(
    grammarValues
      .filter(record)
      .map((item) => [text(item["id"]), item] as const)
      .filter((entry): entry is readonly [string, JsonRecord] => entry[0] !== null),
  );
  const points = knowledgeValues.map((value) => {
    const knowledge = point(value);
    const grammar = knowledge.id === null ? undefined : grammarById.get(knowledge.id);
    return grammar === undefined
      ? knowledge
      : {
          ...knowledge,
          kind: knowledge.kind ?? "grammar",
          formalName: knowledge.formalName ?? text(grammar["formal_name"]),
          baseMeaning: knowledge.baseMeaning ?? text(grammar["base_meaning"]),
        };
  });
  const existingPointIds = new Set(points.map((item) => item.id));
  for (const [id, grammar] of grammarById) {
    if (existingPointIds.has(id)) continue;
    points.push({
      ...point(grammar),
      id,
      kind: "grammar",
      catalogueStatus: "active",
    });
    existingPointIds.add(id);
  }
  const progressRows = progressValues.map(progress);
  const pointIds = uniqueNonNull(
    points.map((item) => item.id),
    "Knowledge point",
  );
  if (!pointIds.ok) return pointIds;
  const progressIds = uniqueNonNull(
    progressRows.map((item) => item.knowledgePointId),
    "Progress",
  );
  if (!progressIds.ok) return progressIds;
  const preference = record(sync["userPreference"]) ? sync["userPreference"] : {};
  return ok({
    contractVersion: V1_SNAPSHOT_VERSION,
    capturedAt: new Date(capturedAt).toISOString(),
    sourceOrigin,
    knowledgePoints: points,
    progress: progressRows,
    preferences: {
      newCardsPerDay: number(
        preference["dailyNewRuleLimit"] ?? preference["daily_new_rule_limit"],
      ),
      timeZone: text(preference["learnerTimeZone"] ?? preference["learner_time_zone"]),
    },
  });
};
