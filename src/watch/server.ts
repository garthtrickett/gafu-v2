import { readBoundedJson } from "../local-api.ts";
import type { StudyFailure } from "../study/contracts.ts";
import type { Watch, WatchFailure } from "./contracts.ts";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const body = async (request: Request): Promise<unknown | Response> => {
  const parsed = await readBoundedJson(request);
  if (parsed.ok) return parsed.value;
  return Response.json(
    parsed.error.kind === "bodyTooLarge"
      ? { error: { kind: "requestTooLarge", maximumBytes: parsed.error.maximumBytes } }
      : {
          error: {
            kind: "invalidRequest",
            detail:
              parsed.error.kind === "contentTypeInvalid"
                ? "Body must use application/json."
                : "Body must be valid JSON.",
          },
        },
    { status: parsed.error.kind === "bodyTooLarge" ? 413 : 400 },
  );
};

const studyStatus = (failure: StudyFailure): number => {
  switch (failure.kind) {
    case "cardNotFound":
    case "planNotFound":
      return 404;
    case "invalidCard":
    case "invalidPreference":
    case "presentationMissing":
    case "presentationInvalid":
    case "presentationExpired":
    case "presentationForWrongCard":
    case "invalidPlanDraft":
    case "invalidCapture":
      return 422;
    case "invalidStateTransition":
    case "identityConflict":
    case "presentationAlreadyUsed":
    case "cardNotAnswerable":
    case "unsupportedSchema":
    case "planOperationConflict":
    case "invalidPlanTransition":
    case "captureOperationConflict":
      return 409;
    case "openFailed":
    case "migrationFailed":
    case "readFailed":
    case "writeFailed":
    case "backupFailed":
    case "schedulerFailed":
    case "clockFailed":
      return 500;
  }
};

const status = (failure: WatchFailure): number => {
  switch (failure.kind) {
    case "pendingCaptureMissing":
    case "pendingCaptureExpired":
      return 409;
    case "analyzerUnavailable":
      return 503;
    case "studyFailure":
      return studyStatus(failure.failure);
    case "clockFailed":
    case "tokenFailed":
      return 500;
    case "invalidCaptureSelection":
    case "noContentCandidate":
    case "captureCandidateMissing":
    case "invalidCaptureIdentity":
      return 422;
  }
};

const response = <Value>(
  result:
    | { readonly ok: true; readonly value: Value }
    | { readonly ok: false; readonly error: WatchFailure },
): Response =>
  result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error }, { status: status(result.error) });

export const handleWatchApi = async (
  request: Request,
  watch: Watch,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/watch")) return null;
  if (request.method === "POST" && url.pathname === "/api/watch/capture/resolve") {
    const value = await body(request);
    if (value instanceof Response) return value;
    if (
      !record(value) ||
      value["sourceVersion"] !== "watch-source-v1" ||
      typeof value["episodeKey"] !== "string" ||
      typeof value["cueKey"] !== "string" ||
      typeof value["cueStartMs"] !== "number" ||
      typeof value["cueEndMs"] !== "number" ||
      typeof value["cueText"] !== "string" ||
      typeof value["selectedSurface"] !== "string" ||
      !record(value["selectedSpan"]) ||
      typeof value["selectedSpan"]["start"] !== "number" ||
      typeof value["selectedSpan"]["end"] !== "number"
    ) {
      return Response.json({ error: { kind: "invalidRequest" } }, { status: 400 });
    }
    return response(
      await watch.resolve({
        sourceVersion: "watch-source-v1",
        episodeKey: value["episodeKey"],
        cueKey: value["cueKey"],
        cueStartMs: value["cueStartMs"],
        cueEndMs: value["cueEndMs"],
        cueText: value["cueText"],
        selectedSurface: value["selectedSurface"],
        selectedSpan: {
          start: value["selectedSpan"]["start"],
          end: value["selectedSpan"]["end"],
        },
      }),
    );
  }
  if (request.method === "POST" && url.pathname === "/api/watch/capture/commit") {
    const value = await body(request);
    if (value instanceof Response) return value;
    if (
      !record(value) ||
      typeof value["token"] !== "string" ||
      typeof value["candidateKey"] !== "string" ||
      typeof value["meaning"] !== "string" ||
      typeof value["senseId"] !== "string" ||
      typeof value["operationKey"] !== "string"
    ) {
      return Response.json({ error: { kind: "invalidRequest" } }, { status: 400 });
    }
    return response(
      watch.commit({
        token: value["token"],
        candidateKey: value["candidateKey"],
        meaning: value["meaning"],
        senseId: value["senseId"],
        operationKey: value["operationKey"],
      }),
    );
  }
  return Response.json({ error: { kind: "notFound" } }, { status: 404 });
};
