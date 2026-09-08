import { mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import type { BroadPartOfSpeech } from "../analysis/contracts.ts";
import { createKuromojiAnalyzer } from "../analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../analysis/loaders.ts";
import { declaredGrammarDetector } from "../learning-material/declared-grammar.ts";
import type {
  LearningMaterial,
  MaterialFailure,
} from "../learning-material/generated-contracts.ts";
import { createGeneratedMaterialValidator } from "../learning-material/generated-validator.ts";
import { openLearningMaterial } from "../learning-material/learning-material.ts";
import { createOpenAiMaterialProvider } from "../learning-material/openai-provider.ts";
import { createDeterministicMaterialProvider } from "../learning-material/scripted-provider.ts";
import { createDeterministicPreparationProvider } from "../preparation/deterministic-provider.ts";
import { createSubtitleImportInspector } from "../preparation/import.ts";
import { phase3ImportPolicy } from "../preparation/import-contracts.ts";
import { createOpenAiBatchProvider } from "../preparation/openai-batch-provider.ts";
import { openPreparation } from "../preparation/preparation.ts";
import { handlePreparationApi } from "../preparation/server.ts";
import { asPlanId } from "../preparation-plan-contracts.ts";
import type { Result } from "../result.ts";
import { ok } from "../result.ts";
import {
  createOpenAiKeyVerifier,
  createProviderKeyCustody,
} from "../topology/provider-key-custody.ts";
import { handleWatchApi } from "../watch/server.ts";
import { createWatch } from "../watch/watch.ts";
import type {
  AnswerGrade,
  CardContent,
  CardStateCommand,
  CreateCard,
  PreferenceChange,
  Study,
  StudyFailure,
} from "./contracts.ts";
import { asCardId } from "./contracts.ts";
import { openStudy, unavailableKaishiSeed } from "./study.ts";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (record: JsonRecord, field: string): string | null =>
  typeof record[field] === "string" ? record[field] : null;

const invalidRequest = (detail: string): Response =>
  Response.json({ error: { kind: "invalidRequest", detail } }, { status: 400 });

const decodeCreateCard = (value: unknown): CreateCard | null => {
  if (!isRecord(value) || !isRecord(value["content"])) return null;
  const content = value["content"];
  const priority = value["stagingPriority"];
  if (priority !== undefined && typeof priority !== "number") return null;
  if (value["type"] === "grammar") {
    const canonicalForm = stringField(content, "canonicalForm");
    const meaning = stringField(content, "meaning");
    const formation = stringField(content, "formation");
    const usageNotes = stringField(content, "usageNotes");
    if (
      canonicalForm === null ||
      meaning === null ||
      formation === null ||
      usageNotes === null
    ) {
      return null;
    }
    return {
      type: "grammar",
      content: { canonicalForm, meaning, formation, usageNotes },
      ...(priority === undefined ? {} : { stagingPriority: priority }),
    };
  }
  if (value["type"] === "vocabulary") {
    const lemma = stringField(content, "lemma");
    const reading = stringField(content, "reading");
    const partOfSpeech = stringField(content, "partOfSpeech");
    const meaning = stringField(content, "meaning");
    const usageNotes = stringField(content, "usageNotes");
    if (
      lemma === null ||
      reading === null ||
      partOfSpeech === null ||
      meaning === null ||
      usageNotes === null
    ) {
      return null;
    }
    return {
      type: "vocabulary",
      content: { lemma, reading, partOfSpeech, meaning, usageNotes },
      ...(priority === undefined ? {} : { stagingPriority: priority }),
    };
  }
  return null;
};

const decodeContent = (type: string, value: unknown): CardContent | null => {
  const decoded = decodeCreateCard({ type, content: value });
  return decoded?.content ?? null;
};

const failureStatus = (failure: StudyFailure): number => {
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

const failureResponse = (failure: StudyFailure): Response =>
  Response.json({ error: failure }, { status: failureStatus(failure) });

const jsonResult = <Value>(
  result: Result<Value, StudyFailure>,
  successStatus = 200,
): Response =>
  result.ok
    ? Response.json(result.value === undefined ? { ok: true } : result.value, {
        status: successStatus,
      })
    : failureResponse(result.error);

const materialFailureStatus = (failure: MaterialFailure): number => {
  switch (failure.kind) {
    case "providerNotConfigured":
    case "authentication":
      return 401;
    case "permission":
      return 403;
    case "rateLimit":
      return 429;
    case "unsupportedGrammarTarget":
    case "unsupportedVocabularyPartOfSpeech":
    case "validationRejected":
    case "tooSimilar":
    case "noValidCandidate":
    case "teachingNotAcknowledged":
    case "presentationNotFound":
    case "presentationAlreadyShown":
      return 422;
    case "inspectionDisabled":
      return 404;
    case "cancelled":
      return 409;
    case "offline":
    case "timeout":
    case "refusal":
    case "incompleteResponse":
    case "malformedResponse":
    case "temporarilyUnavailable":
      return 503;
    case "migrationFailed":
    case "readFailed":
    case "writeFailed":
    case "clockFailed":
      return 500;
  }
};

const materialResponse = <Value>(result: Result<Value, MaterialFailure>): Response =>
  result.ok
    ? Response.json(result.value)
    : Response.json(
        { error: { kind: result.error.kind } },
        { status: materialFailureStatus(result.error) },
      );

const readJson = async (request: Request): Promise<unknown | Response> => {
  try {
    return await request.json();
  } catch {
    return invalidRequest("Request body must be valid JSON.");
  }
};

const snapshot = (study: Study): Response => {
  const cards = study.listCards();
  if (!cards.ok) return failureResponse(cards.error);
  const preferences = study.preferences();
  if (!preferences.ok) return failureResponse(preferences.error);
  const knowledge = study.knowledgeSnapshot();
  if (!knowledge.ok) return failureResponse(knowledge.error);
  const status = study.status();
  if (!status.ok) return failureResponse(status.error);
  return Response.json({
    cards: cards.value,
    preferences: preferences.value,
    knowledge: knowledge.value,
    status: status.value,
  });
};

const handleApi = async (
  request: Request,
  study: Study,
  material: LearningMaterial,
): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/provider") {
    return Response.json(material.providerStatus());
  }
  if (request.method === "PUT" && url.pathname === "/api/provider/key") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (!isRecord(body) || typeof body["apiKey"] !== "string") {
      return invalidRequest("apiKey must be a string.");
    }
    return materialResponse(await material.replaceProviderKey(body["apiKey"]));
  }
  if (request.method === "DELETE" && url.pathname === "/api/provider/key") {
    return Response.json(material.removeProviderKey());
  }
  if (request.method === "GET" && url.pathname === "/api/provider/last-request") {
    return materialResponse(material.inspectLastRequest());
  }
  if (request.method === "POST" && url.pathname === "/api/study/session") {
    const queue = study.studyQueue();
    if (!queue.ok) return failureResponse(queue.error);
    const first = queue.value.due[0];
    if (first === undefined)
      return Response.json({ error: { kind: "nothingDue" } }, { status: 409 });
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) return failureResponse(knowledge.error);
    const prepared = await material.prepare({
      card: first.card,
      knowledge: knowledge.value,
    });
    if (!prepared.ok) return materialResponse(prepared);
    const current = study.studyQueue();
    if (!current.ok) return failureResponse(current.error);
    if (!current.value.due.some((item) => item.card.id === prepared.value.cardId)) {
      return Response.json({ error: { kind: "cardNotDue" } }, { status: 409 });
    }
    return Response.json(prepared.value);
  }
  if (request.method === "POST" && url.pathname === "/api/study/session/teach") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (
      !isRecord(body) ||
      typeof body["cardId"] !== "string" ||
      typeof body["presentationId"] !== "string"
    )
      return invalidRequest("Teaching acknowledgement is invalid.");
    const queue = study.studyQueue();
    if (!queue.ok) return failureResponse(queue.error);
    const card = queue.value.due.find((item) => item.card.id === body["cardId"]);
    if (card === undefined)
      return Response.json({ error: { kind: "cardNotDue" } }, { status: 409 });
    const acknowledged = material.acknowledgeTeaching(
      asCardId(body["cardId"]),
      body["presentationId"],
    );
    if (!acknowledged.ok) return materialResponse(acknowledged);
    const knowledge = study.knowledgeSnapshot();
    if (!knowledge.ok) return failureResponse(knowledge.error);
    const prepared = await material.prepare({
      card: card.card,
      knowledge: knowledge.value,
    });
    if (!prepared.ok) return materialResponse(prepared);
    const current = study.studyQueue();
    if (!current.ok) return failureResponse(current.error);
    if (!current.value.due.some((item) => item.card.id === prepared.value.cardId)) {
      return Response.json({ error: { kind: "cardNotDue" } }, { status: 409 });
    }
    return Response.json(prepared.value);
  }
  if (request.method === "POST" && url.pathname === "/api/study/session/answer") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const grades: readonly AnswerGrade[] = ["again", "hard", "good", "easy"];
    if (
      !isRecord(body) ||
      typeof body["cardId"] !== "string" ||
      typeof body["permit"] !== "string" ||
      !grades.includes(body["grade"] as AnswerGrade)
    )
      return invalidRequest("Review answer is invalid.");
    return jsonResult(
      study.answer({
        cardId: asCardId(body["cardId"]),
        grade: body["grade"] as AnswerGrade,
        permit: { token: body["permit"] },
      }),
    );
  }
  if (request.method === "GET" && url.pathname === "/api/study") {
    return snapshot(study);
  }
  if (request.method === "GET" && url.pathname === "/api/study/plans") {
    return jsonResult(study.listPlans());
  }
  const planMatch = url.pathname.match(/^\/api\/study\/plans\/([^/]+)$/u);
  if (planMatch !== null) {
    const rawPlanId = planMatch[1];
    if (rawPlanId === undefined) return invalidRequest("Missing Plan ID.");
    const planId = asPlanId(decodeURIComponent(rawPlanId));
    if (request.method === "GET") return jsonResult(study.plan(planId));
    if (request.method === "POST") {
      const body = await readJson(request);
      if (
        body instanceof Response ||
        !isRecord(body) ||
        (body["action"] !== "pause" && body["action"] !== "resume")
      ) {
        return body instanceof Response
          ? body
          : invalidRequest("Plan action must be pause or resume.");
      }
      return jsonResult(study.setPlanState({ planId, action: body["action"] }));
    }
    if (request.method === "DELETE") {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      return !isRecord(body) || body["confirmation"] !== "delete"
        ? invalidRequest("Plan deletion requires confirmation=delete.")
        : jsonResult(study.deletePlan(planId, "delete"));
    }
  }
  if (request.method === "POST" && url.pathname === "/api/study/cards") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const input = decodeCreateCard(body);
    return input === null
      ? invalidRequest("Card body does not match a Grammar or Vocabulary Card.")
      : jsonResult(study.createCard(input), 201);
  }
  const cardMatch = url.pathname.match(/^\/api\/study\/cards\/([^/]+)$/u);
  if (request.method === "PATCH" && cardMatch !== null) {
    const cardId = cardMatch[1];
    if (cardId === undefined) return invalidRequest("Missing Card ID.");
    const cards = study.listCards();
    if (!cards.ok) return failureResponse(cards.error);
    const card = cards.value.find((candidate) => candidate.id === cardId);
    if (card === undefined) {
      return failureResponse({ kind: "cardNotFound", cardId });
    }
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const content = decodeContent(card.type, body);
    return content === null
      ? invalidRequest("Card content does not match its immutable type.")
      : jsonResult(study.updateCard(asCardId(cardId), content));
  }
  const stateMatch = url.pathname.match(/^\/api\/study\/cards\/([^/]+)\/state$/u);
  if (request.method === "POST" && stateMatch !== null) {
    const cardId = stateMatch[1];
    if (cardId === undefined) return invalidRequest("Missing Card ID.");
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (!isRecord(body)) return invalidRequest("Missing state action.");
    const action = body["action"];
    if (
      action !== "markKnown" &&
      action !== "markNotKnown" &&
      action !== "suspend" &&
      action !== "restore"
    ) {
      return invalidRequest("Unknown state action.");
    }
    const command: CardStateCommand = { cardId: asCardId(cardId), action };
    return jsonResult(study.setCardState(command));
  }
  if (request.method === "PUT" && url.pathname === "/api/study/preferences") {
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (!isRecord(body)) return invalidRequest("Invalid preferences.");
    const change: PreferenceChange = {};
    if (body["newCardsPerDay"] !== undefined) {
      if (typeof body["newCardsPerDay"] !== "number") {
        return invalidRequest("newCardsPerDay must be a number.");
      }
      Object.assign(change, { newCardsPerDay: body["newCardsPerDay"] });
    }
    if (body["timeZone"] !== undefined) {
      if (typeof body["timeZone"] !== "string") {
        return invalidRequest("timeZone must be a string.");
      }
      Object.assign(change, { timeZone: body["timeZone"] });
    }
    return jsonResult(study.setPreferences(change));
  }
  const baselineMatch = url.pathname.match(/^\/api\/study\/baseline\/([^/]+)$/u);
  if (request.method === "POST" && baselineMatch !== null) {
    const key = baselineMatch[1];
    if (key === undefined) return invalidRequest("Missing baseline word key.");
    const body = await readJson(request);
    if (body instanceof Response) return body;
    if (!isRecord(body) || typeof body["enabled"] !== "boolean") {
      return invalidRequest("enabled must be a boolean.");
    }
    return jsonResult(
      study.setBaselineWordEnabled(decodeURIComponent(key), body["enabled"]),
    );
  }
  if (request.method === "GET" && url.pathname === "/api/study/backup") {
    const backup = study.exportBackup();
    if (!backup.ok) return failureResponse(backup.error);
    return new Response(Uint8Array.from(backup.value.bytes).buffer, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${backup.value.filename}"`,
        "X-Gafu-Schema-Version": String(backup.value.schemaVersion),
      },
    });
  }
  return Response.json({ error: { kind: "notFound" } }, { status: 404 });
};

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const staticResponse = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const normalized = normalize(requested);
  if (
    normalized.startsWith("..") ||
    normalize(join("dist", normalized)).startsWith("..")
  ) {
    return new Response("Not found", { status: 404 });
  }
  let file = Bun.file(join("dist", normalized));
  if (!(await file.exists())) file = Bun.file(join("dist", "index.html"));
  return new Response(file, {
    headers: {
      "Content-Type":
        contentTypes[extname(file.name ?? "")] ?? "application/octet-stream",
    },
  });
};

const databasePath = process.env["GAFU_DATABASE_PATH"] ?? "data/gafu-v2.sqlite";
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

const fakeAi = process.env["GAFU_FAKE_AI"] === "1";
const openAiModel = process.env["GAFU_OPENAI_MODEL"] ?? "gpt-5.6-luna";
const keyCustody = createProviderKeyCustody(
  fakeAi
    ? { verify: async () => ok(undefined) }
    : createOpenAiKeyVerifier({ timeoutMs: 10_000, model: openAiModel }),
);
const materialProvider = fakeAi
  ? createDeterministicMaterialProvider()
  : createOpenAiMaterialProvider({
      apiKey: keyCustody.readForServerAdapter,
      model: openAiModel,
      promptVersion: "study-v1",
      timeoutMs: 30_000,
    });
const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const transparentPartOfSpeech = new Set<BroadPartOfSpeech>([
  "particle",
  "auxiliary",
  "copula",
  "symbol",
]);
const validator = createGeneratedMaterialValidator({
  analyzer,
  grammar: declaredGrammarDetector,
  senses: { resolve: () => [] },
  policy: { transparentPartOfSpeech },
});
const openedMaterial = openLearningMaterial({
  databasePath,
  clock: () => new Date(),
  nextId: () => crypto.randomUUID(),
  nextToken: () => crypto.randomUUID(),
  provider: materialProvider,
  keyCustody,
  validate: validator,
  inspectionEnabled: process.env["GAFU_DEVELOPER_INSPECTION"] === "1",
});
if (!openedMaterial.ok) {
  throw new Error(`Learning Material failed to open: ${openedMaterial.error.kind}`);
}

const opened = openStudy({
  databasePath,
  clock: () => new Date(),
  nextId: () => crypto.randomUUID(),
  permitVerifier: openedMaterial.value.permitVerifier,
  knownWordSeed: unavailableKaishiSeed,
});

if (!opened.ok) {
  throw new Error(`Study failed to open: ${opened.error.kind}`);
}

const watch = createWatch({
  analyzer,
  clock: () => new Date(),
  nextToken: () => crypto.randomUUID(),
  captureVocabulary: opened.value.captureVocabulary,
  pendingTtlMs: 10 * 60 * 1_000,
  maximumPending: 128,
});

const preparationProvider = fakeAi
  ? createDeterministicPreparationProvider()
  : createOpenAiBatchProvider({
      apiKey: keyCustody.readForServerAdapter,
      model: openAiModel,
      promptVersion: "preparation-v2",
      timeoutMs: 60_000,
    });
const openedPreparation = openPreparation({
  databasePath,
  clock: () => new Date(),
  nextId: () => crypto.randomUUID(),
  nextToken: () => crypto.randomUUID(),
  importPolicy: phase3ImportPolicy,
  inspector: createSubtitleImportInspector(phase3ImportPolicy),
  analyzer,
  grammar: declaredGrammarDetector,
  provider: preparationProvider,
  providerConfigured: () => fakeAi || keyCustody.isConfigured(),
  batchSize: 20,
});
if (!openedPreparation.ok) {
  throw new Error(`Preparation failed to open: ${openedPreparation.error.kind}`);
}

const port = Number(process.env["GAFU_SERVER_PORT"] ?? 42070);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: async (request) => {
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      return staticResponse(request);
    }
    const watchResponse = await handleWatchApi(request, watch);
    if (watchResponse !== null) return watchResponse;
    const preparationResponse = await handlePreparationApi(
      request,
      openedPreparation.value,
      opened.value,
    );
    return (
      preparationResponse ?? handleApi(request, opened.value, openedMaterial.value)
    );
  },
});

console.info(`Gafu V2 local server listening on ${server.url}`);

const close = () => {
  opened.value.close();
  openedMaterial.value.close();
  openedPreparation.value.close();
  void server.stop();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
