import { decodePathSegment, readBoundedBody, readBoundedJson } from "../local-api.ts";
import type { PlanSnapshot } from "../preparation-plan-contracts.ts";
import type { Result } from "../result.ts";
import type { Study, StudyFailure } from "../study/contracts.ts";
import type {
  CorrectionCommand,
  Preparation,
  PreparationFailure,
} from "./contracts.ts";
import {
  asSubtitleSetId,
  type CommitImport,
  type ImportFile,
} from "./import-contracts.ts";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (detail: string): Response =>
  Response.json({ error: { kind: "invalidRequest", detail } }, { status: 400 });

const status = (failure: PreparationFailure): number => {
  switch (failure.kind) {
    case "subtitleSetNotFound":
    case "findingNotFound":
      return 404;
    case "providerNotConfigured":
      return 401;
    case "staleImport":
    case "stalePreflight":
      return 409;
    case "batchFailure":
      return failure.failure.kind === "authentication"
        ? 401
        : failure.failure.kind === "permission"
          ? 403
          : failure.failure.kind === "rateLimit"
            ? 429
            : 503;
    case "mixedImportMode":
    case "emptyImport":
    case "entryLimitExceeded":
    case "archiveTooLarge":
    case "inflationLimitExceeded":
    case "decodedLimitExceeded":
    case "corruptArchive":
    case "noAcceptedFiles":
    case "invalidCommit":
    case "noJapaneseCues":
    case "incompleteEvidence":
    case "invalidCorrection":
    case "analysisNotComplete":
    case "planDraftEmpty":
      return 422;
    case "analysisUnavailable":
      return 503;
    case "invalidClock":
    case "migrationFailed":
    case "unsupportedSchema":
    case "readFailed":
    case "writeFailed":
    case "deleteFailed":
      return 500;
  }
};

const resultResponse = <Value>(
  result: Result<Value, PreparationFailure>,
  successStatus = 200,
): Response =>
  result.ok
    ? Response.json(result.value === undefined ? { ok: true } : result.value, {
        status: successStatus,
      })
    : Response.json({ error: result.error }, { status: status(result.error) });

const planResultResponse = (result: Result<PlanSnapshot, StudyFailure>): Response => {
  if (result.ok) return Response.json(result.value, { status: 201 });
  const code =
    result.error.kind === "planNotFound"
      ? 404
      : result.error.kind === "planOperationConflict" ||
          result.error.kind === "identityConflict"
        ? 409
        : result.error.kind === "invalidPlanDraft"
          ? 422
          : 500;
  return Response.json({ error: result.error }, { status: code });
};

const json = async (request: Request): Promise<unknown | Response> => {
  const parsed = await readBoundedJson(request);
  if (parsed.ok) return parsed.value;
  return parsed.error.kind === "bodyTooLarge"
    ? Response.json(
        { error: { kind: "requestTooLarge", maximumBytes: parsed.error.maximumBytes } },
        { status: 413 },
      )
    : invalid(
        parsed.error.kind === "contentTypeInvalid"
          ? "Request body must use application/json."
          : "Request body must be valid JSON.",
      );
};

const decodeCommit = (value: unknown): CommitImport | null => {
  if (
    !isRecord(value) ||
    typeof value["pendingImportToken"] !== "string" ||
    typeof value["operationKey"] !== "string" ||
    typeof value["title"] !== "string" ||
    !Array.isArray(value["episodes"])
  ) {
    return null;
  }
  const episodes = value["episodes"];
  if (
    !episodes.every(
      (episode) =>
        isRecord(episode) &&
        typeof episode["entryId"] === "string" &&
        typeof episode["title"] === "string",
    )
  ) {
    return null;
  }
  return {
    pendingImportToken: value["pendingImportToken"],
    operationKey: value["operationKey"],
    title: value["title"],
    episodes: episodes.map((episode) => ({
      entryId: String((episode as JsonRecord)["entryId"]),
      title: String((episode as JsonRecord)["title"]),
    })),
  };
};

const decodeCorrection = (value: unknown): CorrectionCommand | null => {
  if (
    !isRecord(value) ||
    typeof value["subtitleSetId"] !== "string" ||
    typeof value["findingKey"] !== "string"
  ) {
    return null;
  }
  const classification = value["classification"];
  const disposition = value["disposition"];
  if (
    classification !== undefined &&
    classification !== "required" &&
    classification !== "helpful" &&
    classification !== "incidental"
  ) {
    return null;
  }
  if (
    disposition !== undefined &&
    disposition !== "include" &&
    disposition !== "defer" &&
    disposition !== "dismiss"
  ) {
    return null;
  }
  if (value["knownForSet"] !== undefined && typeof value["knownForSet"] !== "boolean") {
    return null;
  }
  if (value["meaning"] !== undefined && typeof value["meaning"] !== "string")
    return null;
  if (value["senseId"] !== undefined && typeof value["senseId"] !== "string")
    return null;
  return {
    subtitleSetId: asSubtitleSetId(value["subtitleSetId"]),
    findingKey: value["findingKey"],
    ...(classification === undefined ? {} : { classification }),
    ...(disposition === undefined ? {} : { disposition }),
    ...(value["knownForSet"] === undefined
      ? {}
      : { knownForSet: value["knownForSet"] as boolean }),
    ...(value["meaning"] === undefined ? {} : { meaning: value["meaning"] as string }),
    ...(value["senseId"] === undefined ? {} : { senseId: value["senseId"] as string }),
  };
};

const readFiles = async (
  request: Request,
): Promise<readonly ImportFile[] | Response> => {
  const maximumBodyBytes = 40 * 1024 * 1024;
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader === null ? null : Number(declaredHeader);
  if (
    declared !== null &&
    (!Number.isSafeInteger(declared) || declared < 0 || declared > maximumBodyBytes)
  ) {
    return new Response("Import body is too large.", { status: 413 });
  }
  const contentType = request.headers.get("content-type");
  if (contentType?.toLocaleLowerCase().startsWith("multipart/form-data") !== true) {
    return invalid("Import must be multipart form data.");
  }
  const body = await readBoundedBody(request, maximumBodyBytes);
  if (!body.ok) {
    return body.error.kind === "bodyTooLarge"
      ? new Response("Import body is too large.", { status: 413 })
      : invalid("Import body could not be read.");
  }
  let form: FormData;
  try {
    form = await new Response(body.value.buffer as ArrayBuffer, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    return invalid("Import must be multipart form data.");
  }
  const files: ImportFile[] = [];
  for (const value of form.getAll("files")) {
    if (!(value instanceof File)) return invalid("Every import item must be a file.");
    files.push({ name: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
  }
  return files;
};

export const handlePreparationApi = async (
  request: Request,
  preparation: Preparation,
  study: Study,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/preparation")) return null;

  if (request.method === "GET" && url.pathname === "/api/preparation") {
    return resultResponse(preparation.listSubtitleSets());
  }
  if (request.method === "POST" && url.pathname === "/api/preparation/import") {
    const files = await readFiles(request);
    if (files instanceof Response) return files;
    if (files.length === 0) return invalid("Choose at least one SRT or one ZIP.");
    const zip = files.filter((file) => file.name.toLocaleLowerCase().endsWith(".zip"));
    const input =
      zip.length === 1 && files.length === 1
        ? ({ mode: "zip", archive: zip[0] as ImportFile } as const)
        : ({ mode: "direct", files } as const);
    return resultResponse(await preparation.inspectImport(input));
  }
  if (request.method === "POST" && url.pathname === "/api/preparation/coverage") {
    const body = await json(request);
    if (body instanceof Response) return body;
    const token =
      typeof body === "object" && body !== null && "pendingImportToken" in body
        ? (body as { pendingImportToken: unknown }).pendingImportToken
        : null;
    if (typeof token !== "string" || token === "") {
      return invalid("Coverage needs the token from the inspected import.");
    }
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) return invalid("Known words could not be read.");
    return resultResponse(
      await preparation.measureCoverage(token, knowledge.value.vocabulary),
    );
  }
  if (request.method === "POST" && url.pathname === "/api/preparation/commit") {
    const body = await json(request);
    if (body instanceof Response) return body;
    const command = decodeCommit(body);
    return command === null
      ? invalid("Import commit is invalid.")
      : resultResponse(preparation.commitImport(command), 201);
  }
  if (request.method === "POST" && url.pathname === "/api/preparation/corrections") {
    const body = await json(request);
    if (body instanceof Response) return body;
    const command = decodeCorrection(body);
    if (command === null) return invalid("Correction is invalid.");
    const corrected = preparation.correct(command);
    if (!corrected.ok) return resultResponse(corrected);
    const snapshot = study.preparationSnapshot();
    return snapshot.ok
      ? resultResponse(preparation.recompare(command.subtitleSetId, snapshot.value))
      : Response.json({ error: snapshot.error }, { status: 500 });
  }
  const match = url.pathname.match(
    /^\/api\/preparation\/sets\/([^/]+)(?:\/(preflight|analyze|recompare|evidence|plan-draft|start-plan))?$/u,
  );
  if (match !== null) {
    const rawId = match[1];
    if (rawId === undefined) return invalid("Subtitle Set ID is missing.");
    const decodedId = decodePathSegment(rawId);
    if (!decodedId.ok) return invalid("Subtitle Set ID encoding is invalid.");
    const id = asSubtitleSetId(decodedId.value);
    const operation = match[2];
    if (request.method === "GET" && operation === undefined) {
      return resultResponse(preparation.getSubtitleSet(id));
    }
    if (request.method === "POST" && operation === "preflight") {
      const snapshot = study.preparationSnapshot();
      return snapshot.ok
        ? resultResponse(await preparation.preflight(id, snapshot.value))
        : Response.json({ error: snapshot.error }, { status: 500 });
    }
    if (request.method === "POST" && operation === "analyze") {
      const body = await json(request);
      if (body instanceof Response) return body;
      if (!isRecord(body) || typeof body["preflightToken"] !== "string") {
        return invalid("Analysis requires a preflight token.");
      }
      const analyzed = await preparation.analyze({
        preflightToken: body["preflightToken"],
        ...(body["retryUncertain"] === true ? { retryUncertain: true } : {}),
        ...(typeof body["maxBatches"] === "number" &&
        Number.isInteger(body["maxBatches"]) &&
        (body["maxBatches"] as number) > 0
          ? { maxBatches: body["maxBatches"] as number }
          : {}),
        signal: request.signal,
      });
      if (!analyzed.ok || analyzed.value.state !== "complete") {
        return resultResponse(analyzed);
      }
      const currentStudy = study.preparationSnapshot();
      return currentStudy.ok
        ? resultResponse(preparation.recompare(id, currentStudy.value))
        : Response.json({ error: currentStudy.error }, { status: 500 });
    }
    if (request.method === "POST" && operation === "recompare") {
      const snapshot = study.preparationSnapshot();
      return snapshot.ok
        ? resultResponse(preparation.recompare(id, snapshot.value))
        : Response.json({ error: snapshot.error }, { status: 500 });
    }
    if (request.method === "GET" && operation === "evidence") {
      const findingKey = url.searchParams.get("findingKey");
      if (findingKey === null) return invalid("findingKey is required.");
      return resultResponse(
        preparation.evidence({
          subtitleSetId: id,
          findingKey,
          offset: Number(url.searchParams.get("offset") ?? "0"),
          limit: Number(url.searchParams.get("limit") ?? "20"),
        }),
      );
    }
    if (request.method === "GET" && operation === "plan-draft") {
      return resultResponse(preparation.planDraft(id));
    }
    if (request.method === "POST" && operation === "start-plan") {
      const body = await json(request);
      if (body instanceof Response) return body;
      if (
        !isRecord(body) ||
        typeof body["operationKey"] !== "string" ||
        typeof body["draftDigest"] !== "string"
      ) {
        return invalid("Plan start requires operationKey and draftDigest.");
      }
      const draft = preparation.planDraft(id);
      if (!draft.ok) return resultResponse(draft);
      if (draft.value.digest !== body["draftDigest"]) {
        return Response.json({ error: { kind: "stalePlanDraft" } }, { status: 409 });
      }
      return planResultResponse(
        study.startPlan({ operationKey: body["operationKey"], draft: draft.value }),
      );
    }
    if (request.method === "DELETE" && operation === undefined) {
      const body = await json(request);
      if (body instanceof Response) return body;
      return !isRecord(body) || body["confirmation"] !== "delete"
        ? invalid("Deletion requires confirmation=delete.")
        : resultResponse(preparation.deleteSubtitleSet(id, "delete"));
    }
  }
  return Response.json({ error: { kind: "notFound" } }, { status: 404 });
};
