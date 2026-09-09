import { readBoundedBody } from "../local-api.ts";
import { err, ok, type Result } from "../result.ts";
import { MAX_V1_SNAPSHOT_BYTES, V1_SNAPSHOT_VERSION } from "./contracts.ts";
import { parseV1Snapshot } from "./snapshot.ts";

export type FetchV1SnapshotFailure =
  | { readonly kind: "credentialMissing" }
  | { readonly kind: "originInvalid" }
  | { readonly kind: "authentication" }
  | { readonly kind: "remoteUnavailable"; readonly status: number | null }
  | { readonly kind: "remoteInvalid"; readonly detail: string };

export type FetchV1SnapshotDependencies = Readonly<{
  fetch: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  clock: () => Date;
}>;

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeShape = (value: unknown): string => {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return "null";
  return typeof value;
};

const legacyProgress = (
  grammarPoints: readonly unknown[],
  srsUpdates: readonly unknown[],
): readonly unknown[] => {
  const progressIds = new Set<string>();
  const normalized = srsUpdates.map((value) => {
    if (!record(value)) return value;
    const pointId =
      value["knowledgePointId"] ??
      value["knowledge_point_id"] ??
      value["grammarPointId"] ??
      value["grammar_point_id"];
    if (typeof pointId === "string" && pointId !== "") progressIds.add(pointId);
    const repetitions = value["repetitions"];
    const stability = value["stability"];
    return {
      ...value,
      knowledgePointId: pointId,
      participationStatus: value["participationStatus"] ?? "active",
      learningState:
        value["learningState"] ??
        (typeof stability === "number" && stability >= 21
          ? "stable"
          : typeof repetitions === "number" && repetitions > 0
            ? "learning"
            : "unintroduced"),
      introducedAt: value["introducedAt"] ?? null,
    };
  });
  for (const value of grammarPoints) {
    if (!record(value)) continue;
    const id = value["id"];
    if (typeof id !== "string" || id === "" || progressIds.has(id)) continue;
    progressIds.add(id);
    normalized.push({
      knowledgePointId: id,
      repetitions: 0,
      intervalDays: 0,
      nextReview: null,
      difficulty: null,
      stability: 0,
      lastReviewedAt: null,
      participationStatus: "active",
      learningState: "unintroduced",
      introducedAt: null,
    });
  }
  return normalized;
};

const validatedOrigin = (value: string): Result<URL, FetchV1SnapshotFailure> => {
  try {
    const origin = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname);
    if (
      (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/"
    ) {
      return err({ kind: "originInvalid" });
    }
    return ok(origin);
  } catch {
    return err({ kind: "originInvalid" });
  }
};

const responseJson = async (
  response: Response,
): Promise<Result<unknown, FetchV1SnapshotFailure>> => {
  if (response.status === 401 || response.status === 403) {
    return err({ kind: "authentication" });
  }
  if (!response.ok) {
    return err({ kind: "remoteUnavailable", status: response.status });
  }
  try {
    const body = await readBoundedBody(response, MAX_V1_SNAPSHOT_BYTES);
    if (!body.ok) {
      return err({
        kind: "remoteInvalid",
        detail:
          body.error.kind === "bodyTooLarge"
            ? "V1 sync response exceeds the snapshot limit."
            : "V1 sync response could not be read.",
      });
    }
    return ok(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.value)));
  } catch {
    return err({ kind: "remoteInvalid", detail: "V1 returned invalid JSON." });
  }
};

export const fetchV1Snapshot = async (
  originValue: string,
  bearerToken: string,
  dependencies: FetchV1SnapshotDependencies,
): Promise<Result<Uint8Array, FetchV1SnapshotFailure>> => {
  const token = bearerToken.trim();
  if (token === "") return err({ kind: "credentialMissing" });
  const origin = validatedOrigin(originValue);
  if (!origin.ok) return origin;
  const pull = new URL("api/sync/pull", origin.value);
  const request = async (
    url: URL,
  ): Promise<Result<unknown, FetchV1SnapshotFailure>> => {
    try {
      return await responseJson(
        await dependencies.fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: "error",
        }),
      );
    } catch {
      return err({ kind: "remoteUnavailable", status: null });
    }
  };
  const handshake = await request(pull);
  if (!handshake.ok) return handshake;
  if (!record(handshake.value)) {
    return err({ kind: "remoteInvalid", detail: "V1 sync handshake is invalid." });
  }
  let sync = handshake.value;
  if (handshake.value["resetSync"] === true) {
    const epochId = handshake.value["epochId"];
    if (typeof epochId !== "string" || epochId === "") {
      return err({ kind: "remoteInvalid", detail: "V1 sync epoch is missing." });
    }
    pull.searchParams.set("since", "0000000000000:0000:initial");
    pull.searchParams.set("epochId", epochId);
    const completed = await request(pull);
    if (!completed.ok) return completed;
    if (!record(completed.value) || completed.value["resetSync"] === true) {
      return err({ kind: "remoteInvalid", detail: "V1 sync epoch changed." });
    }
    sync = completed.value;
  }
  let now: Date;
  try {
    now = dependencies.clock();
  } catch {
    return err({ kind: "remoteInvalid", detail: "Snapshot clock is invalid." });
  }
  if (!Number.isFinite(now.getTime())) {
    return err({ kind: "remoteInvalid", detail: "Snapshot clock is invalid." });
  }
  const grammarPoints = sync["grammarPoints"];
  const rawProgress = sync["srsUpdates"];
  const grammarOnlyLegacy = sync["knowledgePoints"] === undefined;
  if (
    !(grammarOnlyLegacy || Array.isArray(sync["knowledgePoints"])) ||
    !Array.isArray(grammarPoints) ||
    !Array.isArray(rawProgress) ||
    !(
      sync["userPreference"] === undefined ||
      sync["userPreference"] === null ||
      record(sync["userPreference"])
    )
  ) {
    return err({
      kind: "remoteInvalid",
      detail: [
        "V1 sync response has invalid collection fields:",
        `knowledgePoints=${safeShape(sync["knowledgePoints"])},`,
        `grammarPoints=${safeShape(sync["grammarPoints"])},`,
        `srsUpdates=${safeShape(sync["srsUpdates"])},`,
        `userPreference=${safeShape(sync["userPreference"])}.`,
      ].join(" "),
    });
  }
  const progress = grammarOnlyLegacy
    ? legacyProgress(grammarPoints, rawProgress)
    : rawProgress;
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      contractVersion: V1_SNAPSHOT_VERSION,
      capturedAt: now.toISOString(),
      sourceOrigin: origin.value.origin,
      sync: {
        knowledgePoints: grammarOnlyLegacy ? [] : sync["knowledgePoints"],
        grammarPoints,
        srsUpdates: progress,
        userPreference: sync["userPreference"] ?? null,
      },
    }),
  );
  const parsed = parseV1Snapshot(bytes);
  return parsed.ok
    ? ok(bytes)
    : err({
        kind: "remoteInvalid",
        detail:
          parsed.error.kind === "snapshotInvalid"
            ? parsed.error.detail
            : parsed.error.kind,
      });
};
