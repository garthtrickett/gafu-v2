import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type {
  CardId,
  CardSummary,
  PresentationPermit,
  PresentationPermitFailure,
  PresentationPermitVerifier,
  KnowledgeSnapshot as StudyKnowledgeSnapshot,
  VerifiedPresentationPermit,
} from "../study/contracts.ts";
import { PRESENTATION_PERMIT_LIFETIME_MS } from "../study/contracts.ts";
import type { ProviderKeyCustody } from "../topology/provider-key-custody.ts";
import type {
  GeneratedMaterial,
  LearningMaterial,
  MaterialFailure,
  MaterialProvider,
  PreparedMaterial,
  ProviderStatus,
  ReviewBatchFailure,
  ReviewBatchProgress,
} from "./generated-contracts.ts";
import { MAX_REVIEW_BATCH_ROUNDS } from "./generated-contracts.ts";
import type { SpeechProvider } from "./speech-contracts.ts";
import { exactSignature, isNearCopy, nearSignature } from "./variation.ts";

export const MATERIAL_SCHEMA_VERSION = 6;
export const MATERIAL_VALIDATION_VERSION = "material-v1";
// One lifetime, owned by Study's contract, enforced here and there.
const PRESENTATION_PERMIT_TTL_MS = PRESENTATION_PERMIT_LIFETIME_MS;
const MAXIMUM_PENDING_PERMITS = 1_024;

type MaterialRow = Readonly<{
  id: string;
  card_id: string;
  mode: "teach" | "review";
  payload_json: string;
}>;

type StoredPermit = VerifiedPresentationPermit & Readonly<{ token: string }>;

export type OpenLearningMaterialOptions = Readonly<{
  databasePath: string;
  clock: () => Date;
  nextId: () => string;
  nextToken: () => string;
  provider: MaterialProvider;
  keyCustody: ProviderKeyCustody;
  validate: (
    input: Parameters<LearningMaterial["prepare"]>[0] & {
      value: unknown;
      mode: "teach" | "review";
    },
  ) => Promise<Result<GeneratedMaterial, MaterialFailure>>;
  inspectionEnabled: boolean;
  maximumValidationAttempts?: number;
  /**
   * Says each sentence once it is banked. Optional: without it no clip is
   * made and every presentation serves with `audioUrl: null`.
   */
  speech?: SpeechProvider | undefined;
  /** Synthesis attempts per UTC day before new clips stop; default 200. */
  speechDailyLimit?: number;
}>;

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const safeNow = (clock: () => Date): Result<Date, MaterialFailure> => {
  try {
    const now = clock();
    return Number.isFinite(now.getTime())
      ? ok(new Date(now.getTime()))
      : err({ kind: "clockFailed", detail: "clock returned an invalid date" });
  } catch {
    return err({ kind: "clockFailed", detail: "clock failed" });
  }
};

const migrate = (
  database: Database,
  appliedAt: string,
): Result<void, MaterialFailure> => {
  try {
    const apply = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS learning_material_migration (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      const current = database
        .query(
          "SELECT coalesce(max(version), 0) AS version FROM learning_material_migration",
        )
        .get() as { version: number };
      if (current.version > MATERIAL_SCHEMA_VERSION) {
        throw new Error(`unsupported Learning Material schema ${current.version}`);
      }
      const applied = database
        .query("SELECT version FROM learning_material_migration ORDER BY version")
        .all() as { version: number }[];
      if (!applied.every(({ version }, index) => version === index + 1)) {
        throw new Error("Learning Material migration history is not contiguous");
      }
      // Each step applies when the database is below its version. No step
      // returns early: a database at version 2 must still receive 3 and 4.
      // (An early return here once left production without the tables the
      // later steps create, while fresh databases in tests had them all.)
      if (current.version < 1) {
        database.exec(`
        CREATE TABLE validated_presentation (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('teach', 'review')),
          payload_json TEXT NOT NULL,
          normalized_japanese TEXT NOT NULL,
          exact_signature TEXT NOT NULL,
          near_signature TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          shown_at TEXT,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          validation_version TEXT NOT NULL,
          UNIQUE(card_id, exact_signature)
        );
        CREATE INDEX validated_reserve_idx
          ON validated_presentation(card_id, mode, shown_at, generated_at);
        CREATE TABLE teaching_acknowledgement (
          card_id TEXT PRIMARY KEY,
          presentation_id TEXT NOT NULL,
          acknowledged_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (1, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 2) {
        // Review batches: one row per card. Generation banks reserves without
        // taking, so work-through serves with fresh permits through the
        // normal path.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch_item (
          batch_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          card_id TEXT NOT NULL,
          input_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
          failure_kind TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (batch_id, seq)
        );
        CREATE INDEX IF NOT EXISTS review_batch_pending_idx
          ON review_batch_item(batch_id, status, seq);
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (2, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 3) {
        // Spoken sentences, one clip per presentation, and the daily ceiling
        // that bounds what a runaway session can spend on synthesis.
        database.exec(`
        CREATE TABLE IF NOT EXISTS presentation_audio (
          presentation_id TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          bytes BLOB NOT NULL,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          voice TEXT NOT NULL,
          synthesis_version INTEGER NOT NULL,
          generated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS speech_daily_usage (
          usage_date TEXT PRIMARY KEY,
          attempted_count INTEGER NOT NULL DEFAULT 0 CHECK (attempted_count >= 0),
          updated_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (3, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 4) {
        // The provider job a review batch dispatched, so polls across
        // processes find it again instead of generating twice.
        database.exec(`
        CREATE TABLE IF NOT EXISTS review_batch_job (
          batch_id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          dispatched_at TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (4, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 5) {
        // Retry rounds: how many whole-batch requests a Card has been in, and
        // why its last candidates were refused, fed back to the next request.
        const columns = new Set(
          (
            database.query("PRAGMA table_info(review_batch_item)").all() as {
              name: string;
            }[]
          ).map((column) => column.name),
        );
        if (!columns.has("attempts")) {
          database.exec(
            "ALTER TABLE review_batch_item ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
          );
        }
        if (!columns.has("hints_json")) {
          database.exec("ALTER TABLE review_batch_item ADD COLUMN hints_json TEXT");
        }
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (5, ?)",
          )
          .run(appliedAt);
      }
      if (current.version < 6) {
        // Permits outlive a process now that a session is downloaded whole:
        // a deploy mid-session must not strand twenty answers in the outbox.
        database.exec(`
        CREATE TABLE IF NOT EXISTS presentation_permit (
          token TEXT PRIMARY KEY,
          id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          presentation_id TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          contract_version TEXT NOT NULL
        );
      `);
        database
          .query(
            "INSERT INTO learning_material_migration(version, applied_at) VALUES (6, ?)",
          )
          .run(appliedAt);
      }
    });
    apply.immediate();
    return ok(undefined);
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
};

export const openLearningMaterial = (
  options: OpenLearningMaterialOptions,
): Result<LearningMaterial, MaterialFailure> => {
  let database: Database;
  try {
    database = new Database(options.databasePath, { create: true });
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA journal_mode = WAL");
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
  const now = safeNow(options.clock);
  if (!now.ok) {
    database.close();
    return now;
  }
  const migrated = migrate(database, now.value.toISOString());
  if (!migrated.ok) {
    database.close();
    return migrated;
  }

  type PermitRow = {
    token: string;
    id: string;
    card_id: CardId;
    presentation_id: string;
    issued_at: string;
    contract_version: string;
  };
  const prunePermits = (time: number): void => {
    database
      .query("DELETE FROM presentation_permit WHERE issued_at < ?")
      .run(new Date(time - PRESENTATION_PERMIT_TTL_MS).toISOString());
    const { count } = database
      .query("SELECT count(*) AS count FROM presentation_permit")
      .get() as { count: number };
    if (count >= MAXIMUM_PENDING_PERMITS) {
      database
        .query(
          `DELETE FROM presentation_permit WHERE token IN (
             SELECT token FROM presentation_permit ORDER BY issued_at, token LIMIT ?
           )`,
        )
        .run(count - MAXIMUM_PENDING_PERMITS + 1);
    }
  };
  const issuePermit = (permit: StoredPermit): void => {
    database
      .query(
        `INSERT INTO presentation_permit(
           token, id, card_id, presentation_id, issued_at, contract_version
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        permit.token,
        permit.id,
        permit.cardId,
        permit.presentationId,
        permit.issuedAt.toISOString(),
        permit.contractVersion,
      );
  };
  const permitVerifier: PresentationPermitVerifier = {
    verify: (
      permit: PresentationPermit,
      now: Date,
    ): Result<VerifiedPresentationPermit, PresentationPermitFailure> => {
      try {
        prunePermits(now.getTime());
        const row = database
          .query(
            `SELECT token, id, card_id, presentation_id, issued_at, contract_version
             FROM presentation_permit WHERE token = ?`,
          )
          .get(permit.token) as PermitRow | null;
        if (row === null) {
          return err({
            kind: "presentationInvalid",
            detail: "unknown presentation permit",
          });
        }
        return ok({
          token: row.token,
          id: row.id,
          cardId: row.card_id,
          presentationId: row.presentation_id,
          issuedAt: new Date(row.issued_at),
          contractVersion: row.contract_version,
        });
      } catch {
        return err({ kind: "presentationInvalid", detail: "permit store unavailable" });
      }
    },
  };

  const status = (): ProviderStatus => ({
    provider: options.provider.identity.provider,
    model: options.provider.identity.model,
    configured: options.keyCustody.isConfigured(),
    keyPersistence: "server-memory",
    speech:
      options.speech === undefined
        ? null
        : {
            provider: options.speech.identity.provider,
            voice: options.speech.identity.voice,
          },
  });

  const hasTeaching = (cardId: CardId): Result<boolean, MaterialFailure> => {
    try {
      return ok(
        database
          .query("SELECT 1 FROM teaching_acknowledgement WHERE card_id = ?")
          .get(cardId) !== null,
      );
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const recentJapanese = (
    cardId: CardId,
  ): Result<readonly string[], MaterialFailure> => {
    try {
      const rows = database
        .query(`SELECT normalized_japanese FROM validated_presentation
        WHERE card_id = ? AND shown_at IS NOT NULL ORDER BY shown_at DESC LIMIT 5`)
        .all(cardId) as { normalized_japanese: string }[];
      return ok(rows.map((row) => row.normalized_japanese));
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const audioUrlFor = (presentationId: string): string =>
    `/api/study/presentations/${encodeURIComponent(presentationId)}/audio`;

  const hasAudio = (presentationId: string): boolean =>
    database
      .query("SELECT 1 FROM presentation_audio WHERE presentation_id = ?")
      .get(presentationId) !== null;

  /**
   * Whether the stored clip was made by the voice in use now. A clip from
   * another provider, voice, or synthesis version is stale: the sentence is
   * re-spoken on its next serve, so a voice change reaches banked material.
   */
  const hasCurrentAudio = (presentationId: string, speech: SpeechProvider): boolean => {
    const row = database
      .query(
        `SELECT provider, model, voice, synthesis_version
         FROM presentation_audio WHERE presentation_id = ?`,
      )
      .get(presentationId) as {
      provider: string;
      model: string;
      voice: string;
      synthesis_version: number;
    } | null;
    if (row === null) return false;
    const identity = speech.identity;
    return (
      row.provider === identity.provider &&
      row.model === identity.model &&
      row.voice === identity.voice &&
      row.synthesis_version === identity.synthesisVersion
    );
  };

  /**
   * One synthesis attempt counts against the day, cache hits do not. The
   * conditional upsert is atomic, so concurrent stocking cannot overshoot.
   */
  const reserveSpeechBudget = (now: Date): boolean => {
    const limit = options.speechDailyLimit ?? 200;
    const day = now.toISOString().slice(0, 10);
    const changed = database
      .query(
        `INSERT INTO speech_daily_usage(usage_date, attempted_count, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(usage_date) DO UPDATE SET
           attempted_count = attempted_count + 1,
           updated_at = excluded.updated_at
         WHERE attempted_count < ?`,
      )
      .run(day, now.toISOString(), limit);
    return changed.changes === 1;
  };

  /**
   * Best effort: says the sentence and stores the clip. Any failure — no
   * provider, ceiling reached, provider error — leaves the presentation
   * without audio and is never surfaced as a material failure.
   */
  const synthesizeAudio = async (
    presentationId: string,
    japanese: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    const speech = options.speech;
    if (speech === undefined) return;
    try {
      if (hasCurrentAudio(presentationId, speech)) return;
      const now = safeNow(options.clock);
      if (!now.ok) return;
      if (!reserveSpeechBudget(now.value)) return;
      const spoken = await speech.synthesize(japanese, signal);
      if (!spoken.ok) return;
      // A stale clip from another voice gives way; the old one still served
      // until this moment, so a failed synthesis above kept it.
      database
        .query("DELETE FROM presentation_audio WHERE presentation_id = ?")
        .run(presentationId);
      database
        .query(
          `INSERT OR IGNORE INTO presentation_audio(
             presentation_id, content_type, bytes, provider, model, voice,
             synthesis_version, generated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          presentationId,
          spoken.value.contentType,
          spoken.value.bytes,
          speech.identity.provider,
          speech.identity.model,
          speech.identity.voice,
          speech.identity.synthesisVersion,
          now.value.toISOString(),
        );
    } catch {
      // Audio is an extra; the sentence still serves.
    }
  };

  /** Fills in a missing clip for a taken presentation, then labels it. */
  const withAudio = async (
    prepared: PreparedMaterial,
    signal?: AbortSignal,
  ): Promise<PreparedMaterial> => {
    await synthesizeAudio(prepared.id, prepared.material.japanese, signal);
    let present = false;
    try {
      present = hasAudio(prepared.id);
    } catch {
      present = false;
    }
    return { ...prepared, audioUrl: present ? audioUrlFor(prepared.id) : null };
  };

  /**
   * Teaching is display-only, so a teach presentation stays servable until
   * the learner says Seen it. Taking it set `shown_at`; a tab closed before
   * the acknowledgement must not strand the Card with nothing to show.
   */
  const latestShownTeaching = (
    cardId: CardId,
  ): Result<PreparedMaterial | null, MaterialFailure> => {
    try {
      const row = database
        .query(`SELECT id, card_id, mode, payload_json
        FROM validated_presentation
        WHERE card_id = ? AND mode = 'teach' AND shown_at IS NOT NULL
        ORDER BY shown_at DESC, id DESC LIMIT 1`)
        .get(cardId) as MaterialRow | null;
      if (row === null) return ok(null);
      return ok({
        id: row.id,
        cardId,
        mode: "teach",
        material: JSON.parse(row.payload_json) as GeneratedMaterial,
        permit: null,
        source: "reserve",
        audioUrl: null,
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const canTeach: LearningMaterial["canTeach"] = (cardId) => {
    try {
      return ok(
        database
          .query(
            "SELECT 1 FROM validated_presentation WHERE card_id = ? AND mode = 'teach'",
          )
          .get(cardId) !== null,
      );
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const teachingFlags: LearningMaterial["teachingFlags"] = () => {
    try {
      const taught = new Set(
        (
          database.query("SELECT card_id FROM teaching_acknowledgement").all() as {
            card_id: CardId;
          }[]
        ).map((row) => row.card_id),
      );
      const teachable = new Set(
        (
          database
            .query(
              "SELECT DISTINCT card_id FROM validated_presentation WHERE mode = 'teach'",
            )
            .all() as { card_id: CardId }[]
        ).map((row) => row.card_id),
      );
      return ok({ taught, teachable });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const presentationAudio: LearningMaterial["presentationAudio"] = (presentationId) => {
    try {
      const row = database
        .query(
          "SELECT content_type, bytes FROM presentation_audio WHERE presentation_id = ?",
        )
        .get(presentationId) as { content_type: string; bytes: Uint8Array } | null;
      if (row === null) return ok(null);
      return ok({
        contentType: row.content_type === "audio/wav" ? "audio/wav" : "audio/mpeg",
        bytes: row.bytes,
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const takeReserve = (
    cardId: CardId,
    mode: "teach" | "review",
    source: PreparedMaterial["source"],
  ): Result<PreparedMaterial | null, MaterialFailure> => {
    const observedAt = safeNow(options.clock);
    if (!observedAt.ok) return observedAt;
    try {
      let selected: MaterialRow | null = null;
      const take = database.transaction(() => {
        selected = database
          .query(`SELECT id, card_id, mode, payload_json
          FROM validated_presentation WHERE card_id = ? AND mode = ? AND shown_at IS NULL
          ORDER BY generated_at, id LIMIT 1`)
          .get(cardId, mode) as MaterialRow | null;
        if (selected === null) return;
        const changed = database
          .query(
            "UPDATE validated_presentation SET shown_at = ? WHERE id = ? AND shown_at IS NULL",
          )
          .run(observedAt.value.toISOString(), selected.id);
        if (changed.changes !== 1) selected = null;
      });
      take.immediate();
      if (selected === null) return ok(null);
      const row = selected as MaterialRow;
      const material = JSON.parse(row.payload_json) as GeneratedMaterial;
      let permit: PresentationPermit | null = null;
      if (mode === "review") {
        prunePermits(observedAt.value.getTime());
        const token = options.nextToken();
        issuePermit({
          token,
          id: options.nextId(),
          cardId,
          presentationId: row.id,
          issuedAt: observedAt.value,
          contractVersion: MATERIAL_VALIDATION_VERSION,
        });
        permit = { token };
      }
      return ok({ id: row.id, cardId, mode, material, permit, source, audioUrl: null });
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const signatures = (cardId: CardId): Result<readonly string[], MaterialFailure> => {
    try {
      const rows = database
        .query(`SELECT near_signature FROM validated_presentation
        WHERE card_id = ? AND (shown_at IS NULL OR id IN (
          SELECT id FROM validated_presentation WHERE card_id = ? AND shown_at IS NOT NULL
          ORDER BY shown_at DESC LIMIT 5))`)
        .all(cardId, cardId) as { near_signature: string }[];
      return ok(rows.map((row) => row.near_signature));
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  /** Banks a validated candidate; returns its id, or null when it is a near copy. */
  const storeCandidate = (
    cardId: CardId,
    mode: "teach" | "review",
    material: GeneratedMaterial,
    generatedAt: Date,
  ): Result<string | null, MaterialFailure> => {
    const prior = signatures(cardId);
    if (!prior.ok) return prior;
    if (isNearCopy(material.japanese, material.targetSurface, prior.value))
      return ok(null);
    const id = options.nextId();
    try {
      database
        .query(`INSERT INTO validated_presentation(
        id, card_id, mode, payload_json, normalized_japanese, exact_signature,
        near_signature, generated_at, provider, model, prompt_version, validation_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          cardId,
          mode,
          JSON.stringify(material),
          material.japanese.normalize("NFKC"),
          exactSignature(material.japanese),
          nearSignature(material.japanese, material.targetSurface),
          generatedAt.toISOString(),
          options.provider.identity.provider,
          options.provider.identity.model,
          options.provider.identity.promptVersion,
          MATERIAL_VALIDATION_VERSION,
        );
      return ok(id);
    } catch (cause) {
      if (String(cause).includes("validated_presentation.card_id")) return ok(null);
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const hasReserve = (
    cardId: CardId,
    mode: "teach" | "review",
  ): Result<boolean, MaterialFailure> => {
    try {
      return ok(
        database
          .query(`SELECT 1 FROM validated_presentation
          WHERE card_id = ? AND mode = ? AND shown_at IS NULL`)
          .get(cardId, mode) !== null,
      );
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  /**
   * Runs bounded provider attempts and banks every validated candidate,
   * without taking. Shared by interactive prepare (which takes next) and
   * review-batch advances (which leave work-through to the normal path, so
   * permits stay fresh).
   */
  const stockReserve = async (
    input: Parameters<LearningMaterial["prepare"]>[0],
    mode: "teach" | "review",
  ): Promise<Result<void, MaterialFailure>> => {
    const recent = recentJapanese(input.card.id);
    if (!recent.ok) return recent;
    const attempts = options.maximumValidationAttempts ?? 3;
    let rejectionReasons: readonly string[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const generated = await options.provider.generate(
        {
          mode,
          card: input.card,
          knowledge: input.knowledge,
          recentJapanese: recent.value,
          candidateCount: 3,
        },
        input.signal,
      );
      if (!generated.ok) return generated;
      const generatedAt = safeNow(options.clock);
      if (!generatedAt.ok) return generatedAt;
      const banked: { id: string; japanese: string }[] = [];
      for (const value of generated.value.candidates) {
        const validated = await options.validate({ ...input, value, mode });
        if (!validated.ok) {
          if (validated.error.kind === "validationRejected")
            rejectionReasons = validated.error.reasons;
          else if (validated.error.kind === "malformedResponse")
            rejectionReasons = [validated.error.kind];
          else return validated;
          continue;
        }
        const saved = storeCandidate(
          input.card.id,
          mode,
          validated.value,
          generatedAt.value,
        );
        if (!saved.ok) return saved;
        if (saved.value !== null)
          banked.push({ id: saved.value, japanese: validated.value.japanese });
      }
      if (banked.length > 0) {
        // Say every banked sentence now, concurrently, so a later serve is
        // instant. Each is best effort; none can fail the material.
        if (mode === "review") {
          await Promise.all(
            banked.map((item) => synthesizeAudio(item.id, item.japanese, input.signal)),
          );
        }
        return ok(undefined);
      }
    }
    return rejectionReasons.length > 0
      ? err({ kind: "validationRejected", reasons: rejectionReasons })
      : err({ kind: "noValidCandidate" });
  };

  const prepare: LearningMaterial["prepare"] = async (input) => {
    const taught = hasTeaching(input.card.id);
    if (!taught.ok) return taught;
    const mode =
      input.card.schedulePhase === "new" && !taught.value ? "teach" : "review";
    const reserve = takeReserve(input.card.id, mode, "reserve");
    if (!reserve.ok) return reserve;
    if (reserve.value !== null) return ok(await withAudio(reserve.value, input.signal));
    if (mode === "teach") {
      const shown = latestShownTeaching(input.card.id);
      if (!shown.ok) return shown;
      if (shown.value !== null) return ok(await withAudio(shown.value, input.signal));
      return err({ kind: "teachingNotPrepared" });
    }
    const stocked = await stockReserve(input, mode);
    if (!stocked.ok) return stocked;
    const prepared = takeReserve(input.card.id, mode, "generated");
    if (!prepared.ok) return prepared;
    if (prepared.value !== null)
      return ok(await withAudio(prepared.value, input.signal));
    return err({ kind: "noValidCandidate" });
  };

  type PendingItem = {
    seq: number;
    card_id: CardId;
    input_json: string;
    attempts: number;
    hints_json: string | null;
  };
  type BatchInput = { card: CardSummary; knowledge: StudyKnowledgeSnapshot };

  const setItemStatus = (
    batchId: string,
    seq: number,
    status: "ready" | "failed",
    failureKind: string | null,
    at: string,
  ): void => {
    database
      .query(
        `UPDATE review_batch_item SET status = ?, failure_kind = ?, updated_at = ?
         WHERE batch_id = ? AND seq = ?`,
      )
      .run(status, failureKind, at, batchId, seq);
  };

  /** Speaks the banked sentences a few at a time, as V1 did. */
  const speakAll = async (
    banked: readonly { id: string; japanese: string }[],
    concurrency = 3,
  ): Promise<void> => {
    for (let index = 0; index < banked.length; index += concurrency) {
      await Promise.all(
        banked
          .slice(index, index + concurrency)
          .map((item) => synthesizeAudio(item.id, item.japanese)),
      );
    }
  };

  /**
   * One provider request for every pending Card. The first advance dispatches
   * it and records the job; later advances poll; the completing advance
   * validates and banks every Card's candidates, marks each ready or failed,
   * then speaks the banked sentences. A Card the provider returned nothing
   * usable for fails alone. A provider-level failure fails every pending Card
   * with its kind, so the learner can batch again; nothing is retried here.
   */
  const advanceWholeBatch = async (
    batchId: string,
    batch: NonNullable<MaterialProvider["batch"]>,
  ): Promise<Result<void, MaterialFailure>> => {
    let pending: PendingItem[];
    let job: { job_id: string } | null;
    try {
      pending = database
        .query(
          `SELECT seq, card_id, input_json, attempts, hints_json FROM review_batch_item
           WHERE batch_id = ? AND status = 'pending' ORDER BY seq`,
        )
        .all(batchId) as PendingItem[];
      job = database
        .query("SELECT job_id FROM review_batch_job WHERE batch_id = ?")
        .get(batchId) as { job_id: string } | null;
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
    if (pending.length === 0) return ok(undefined);
    const observedAt = safeNow(options.clock);
    if (!observedAt.ok) return observedAt;
    const at = observedAt.value.toISOString();
    const inputs = new Map<number, BatchInput>();
    for (const item of pending) {
      try {
        inputs.set(item.seq, JSON.parse(item.input_json) as BatchInput);
      } catch {
        return err({ kind: "writeFailed", detail: "review batch input is corrupt" });
      }
    }
    const failAll = (kind: string): Result<void, MaterialFailure> => {
      try {
        const apply = database.transaction(() => {
          for (const item of pending)
            setItemStatus(batchId, item.seq, "failed", kind, at);
          database
            .query("DELETE FROM review_batch_job WHERE batch_id = ?")
            .run(batchId);
        });
        apply.immediate();
        return ok(undefined);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    };

    if (job === null) {
      // Cards that already hold a review reserve need no generation.
      const targets: { item: PendingItem; input: BatchInput }[] = [];
      for (const item of pending) {
        const input = inputs.get(item.seq);
        if (input === undefined) continue;
        const reserve = hasReserve(item.card_id, "review");
        if (!reserve.ok) return reserve;
        if (reserve.value) {
          try {
            setItemStatus(batchId, item.seq, "ready", null, at);
          } catch (cause) {
            return err({ kind: "writeFailed", detail: detail(cause) });
          }
          continue;
        }
        targets.push({ item, input });
      }
      const first = targets[0];
      if (first === undefined) return ok(undefined);
      const batchTargets = [];
      for (const target of targets) {
        const recent = recentJapanese(target.item.card_id);
        if (!recent.ok) return recent;
        let previousRejections: readonly string[] = [];
        try {
          const parsed: unknown =
            target.item.hints_json === null ? [] : JSON.parse(target.item.hints_json);
          if (Array.isArray(parsed))
            previousRejections = parsed.filter(
              (hint): hint is string => typeof hint === "string",
            );
        } catch {
          previousRejections = [];
        }
        batchTargets.push({
          mode: "review" as const,
          card: target.input.card,
          recentJapanese: recent.value,
          previousRejections,
        });
      }
      const dispatched = await batch.dispatch(batchTargets, first.input.knowledge);
      if (!dispatched.ok) return failAll(dispatched.error.kind);
      try {
        database
          .query(
            "INSERT INTO review_batch_job(batch_id, job_id, dispatched_at) VALUES (?, ?, ?)",
          )
          .run(batchId, dispatched.value.jobId, at);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
      return ok(undefined);
    }

    const polled = await batch.poll(job.job_id);
    if (!polled.ok) return failAll(polled.error.kind);
    if (polled.value.status === "pending") return ok(undefined);
    const byCard = new Map(
      polled.value.items.map((item) => [item.cardId, item.candidates]),
    );
    const banked: { id: string; japanese: string }[] = [];
    for (const item of pending) {
      const input = inputs.get(item.seq);
      const candidates = byCard.get(item.card_id);
      let status: "ready" | "failed" = "failed";
      let failureKind: string | null = "noValidCandidate";
      const hints: string[] = [];
      if (input !== undefined && candidates !== undefined) {
        for (const value of candidates) {
          const validated = await options.validate({ ...input, value, mode: "review" });
          if (!validated.ok) {
            failureKind = validated.error.kind;
            if (validated.error.kind === "validationRejected")
              hints.push(...validated.error.reasons);
            continue;
          }
          const saved = storeCandidate(
            item.card_id,
            "review",
            validated.value,
            observedAt.value,
          );
          if (!saved.ok) return saved;
          if (saved.value !== null)
            banked.push({ id: saved.value, japanese: validated.value.japanese });
          status = "ready";
          failureKind = null;
        }
      }
      try {
        const attempts = item.attempts + 1;
        if (status === "failed" && attempts < MAX_REVIEW_BATCH_ROUNDS) {
          // Back into the next round, carrying why this one was refused.
          database
            .query(
              `UPDATE review_batch_item
               SET attempts = ?, hints_json = ?, failure_kind = ?, updated_at = ?
               WHERE batch_id = ? AND seq = ?`,
            )
            .run(
              attempts,
              JSON.stringify([...new Set(hints)]),
              failureKind,
              at,
              batchId,
              item.seq,
            );
        } else {
          database
            .query(
              `UPDATE review_batch_item
               SET status = ?, attempts = ?, failure_kind = ?, updated_at = ?
               WHERE batch_id = ? AND seq = ?`,
            )
            .run(status, attempts, failureKind, at, batchId, item.seq);
        }
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    }
    try {
      database.query("DELETE FROM review_batch_job WHERE batch_id = ?").run(batchId);
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
    await speakAll(banked);
    return ok(undefined);
  };

  return ok({
    prepare,
    hasTeaching,
    hasReserve,
    beginReviewBatch: (cards) => {
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      const batchId = options.nextId();
      try {
        const insert = database.transaction(() => {
          const add = database.query(
            `INSERT INTO review_batch_item(batch_id, seq, card_id, input_json, status, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`,
          );
          cards.forEach((input, index) => {
            add.run(
              batchId,
              index,
              input.card.id,
              JSON.stringify({ card: input.card, knowledge: input.knowledge }),
              observedAt.value.toISOString(),
            );
          });
        });
        insert.immediate();
        return ok(batchId);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    advanceReviewBatch: async (
      batchId: string,
    ): Promise<Result<ReviewBatchProgress, MaterialFailure>> => {
      const progress = (): Result<ReviewBatchProgress, MaterialFailure> => {
        try {
          const rows = database
            .query(
              `SELECT card_id, status, failure_kind, attempts FROM review_batch_item
               WHERE batch_id = ? ORDER BY seq`,
            )
            .all(batchId) as {
            card_id: CardId;
            status: string;
            failure_kind: string | null;
            attempts: number;
          }[];
          if (rows.length === 0) return err({ kind: "reviewBatchNotFound", batchId });
          const completed: CardId[] = [];
          const failed: ReviewBatchFailure[] = [];
          let pending = 0;
          let round = 1;
          for (const row of rows) {
            if (row.status === "ready") completed.push(row.card_id);
            else if (row.status === "failed")
              failed.push({
                cardId: row.card_id,
                kind: (row.failure_kind ?? "offline") as ReviewBatchFailure["kind"],
              });
            else {
              pending += 1;
              round = Math.max(round, row.attempts + 1);
            }
          }
          const snapshot: ReviewBatchProgress = {
            batchId,
            done: pending === 0,
            pending,
            completed,
            failed,
            round,
          };
          return ok(snapshot);
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      };
      if (options.provider.batch !== undefined) {
        const advanced = await advanceWholeBatch(batchId, options.provider.batch);
        if (!advanced.ok) return advanced;
        return progress();
      }
      let next: { seq: number; card_id: CardId; input_json: string } | null;
      try {
        next = database
          .query(
            `SELECT seq, card_id, input_json FROM review_batch_item
             WHERE batch_id = ? AND status = 'pending' ORDER BY seq LIMIT 1`,
          )
          .get(batchId) as typeof next;
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
      if (next === null) return progress();
      const item = next;
      let input: { card: CardSummary; knowledge: StudyKnowledgeSnapshot };
      try {
        input = JSON.parse(item.input_json) as typeof input;
      } catch {
        return err({ kind: "writeFailed", detail: "review batch input is corrupt" });
      }
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      const finish = (
        status: "ready" | "failed",
        failureKind: string | null,
      ): Result<ReviewBatchProgress, MaterialFailure> => {
        try {
          database
            .query(
              `UPDATE review_batch_item SET status = ?, failure_kind = ?, updated_at = ?
               WHERE batch_id = ? AND seq = ?`,
            )
            .run(
              status,
              failureKind,
              observedAt.value.toISOString(),
              batchId,
              item.seq,
            );
        } catch (cause) {
          return err({ kind: "writeFailed", detail: detail(cause) });
        }
        return progress();
      };
      const reserve = hasReserve(item.card_id, "review");
      if (!reserve.ok) return reserve;
      if (reserve.value) return finish("ready", null);
      const stocked = await stockReserve(
        { card: input.card, knowledge: input.knowledge },
        "review",
      );
      if (!stocked.ok) return finish("failed", stocked.error.kind);
      return finish("ready", null);
    },
    acknowledgeTeaching: (cardId, presentationId) => {
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      try {
        const material = database
          .query(`SELECT 1 FROM validated_presentation
          WHERE id = ? AND card_id = ? AND mode = 'teach' AND shown_at IS NOT NULL`)
          .get(presentationId, cardId);
        if (material === null) return err({ kind: "presentationNotFound" });
        database
          .query(`INSERT INTO teaching_acknowledgement(card_id, presentation_id, acknowledged_at)
          VALUES (?, ?, ?) ON CONFLICT(card_id) DO NOTHING`)
          .run(cardId, presentationId, observedAt.value.toISOString());
        return ok(undefined);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    providerStatus: status,
    storeAuthoredTeaching: async ({ card, knowledge, value }) => {
      const validated = await options.validate({
        card,
        knowledge,
        value,
        mode: "teach",
      });
      if (!validated.ok) return validated;
      const authoredAt = safeNow(options.clock);
      if (!authoredAt.ok) return authoredAt;
      const stored = storeCandidate(
        card.id,
        "teach",
        validated.value,
        authoredAt.value,
      );
      return stored.ok ? ok(undefined) : stored;
    },
    inspectLastRequest: () => {
      if (!options.inspectionEnabled) return err({ kind: "inspectionDisabled" });
      const request = options.provider.inspectLastRequest();
      return request === null ? err({ kind: "presentationNotFound" }) : ok(request);
    },
    presentationAudio,
    canTeach,
    teachingFlags,
    permitVerifier,
    close: () => database.close(),
  });
};
