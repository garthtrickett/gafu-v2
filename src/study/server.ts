import { mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import type { Result } from "../result.ts";
import type {
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
      return 404;
    case "invalidCard":
    case "invalidPreference":
    case "presentationMissing":
    case "presentationInvalid":
    case "presentationExpired":
    case "presentationForWrongCard":
      return 422;
    case "invalidStateTransition":
    case "identityConflict":
    case "presentationAlreadyUsed":
    case "cardNotAnswerable":
    case "unsupportedSchema":
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
    ? Response.json(result.value, { status: successStatus })
    : failureResponse(result.error);

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

const handleApi = async (request: Request, study: Study): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/study") {
    return snapshot(study);
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

const opened = openStudy({
  databasePath,
  clock: () => new Date(),
  nextId: () => crypto.randomUUID(),
  permitVerifier: {
    verify: () => ({ ok: false, error: { kind: "presentationMissing" } }),
  },
  knownWordSeed: unavailableKaishiSeed,
});

if (!opened.ok) {
  throw new Error(`Study failed to open: ${opened.error.kind}`);
}

const port = Number(process.env["GAFU_SERVER_PORT"] ?? 42070);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: (request) =>
    new URL(request.url).pathname.startsWith("/api/")
      ? handleApi(request, opened.value)
      : staticResponse(request),
});

console.info(`Gafu V2 local server listening on ${server.url}`);

const close = () => {
  opened.value.close();
  void server.stop();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
