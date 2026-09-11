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
import { exactSignature, isNearCopy, nearSignature } from "./variation.ts";

export const MATERIAL_SCHEMA_VERSION = 2;
export const MATERIAL_VALIDATION_VERSION = "material-v1";
const PRESENTATION_PERMIT_TTL_MS = 10 * 60 * 1_000;
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
      if (current.version >= 2) return;
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
      // Review batches: one row per card, advanced one card per status poll.
      // Generation banks reserves without taking, so work-through serves with
      // fresh permits through the normal path.
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

  const permits = new Map<string, StoredPermit>();
  const prunePermits = (time: number): void => {
    for (const [token, permit] of permits) {
      if (time - permit.issuedAt.getTime() > PRESENTATION_PERMIT_TTL_MS) {
        permits.delete(token);
      }
    }
    while (permits.size >= MAXIMUM_PENDING_PERMITS) {
      const oldest = permits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      permits.delete(oldest);
    }
  };
  const permitVerifier: PresentationPermitVerifier = {
    verify: (
      permit: PresentationPermit,
      now: Date,
    ): Result<VerifiedPresentationPermit, PresentationPermitFailure> => {
      prunePermits(now.getTime());
      const stored = permits.get(permit.token);
      return stored === undefined
        ? err({ kind: "presentationInvalid", detail: "unknown presentation permit" })
        : ok(stored);
    },
  };

  const status = (): ProviderStatus => ({
    provider: options.provider.identity.provider,
    model: options.provider.identity.model,
    configured: options.keyCustody.isConfigured(),
    keyPersistence: "server-memory",
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
        permits.set(token, {
          token,
          id: options.nextId(),
          cardId,
          presentationId: row.id,
          issuedAt: observedAt.value,
          contractVersion: MATERIAL_VALIDATION_VERSION,
        });
        permit = { token };
      }
      return ok({ id: row.id, cardId, mode, material, permit, source });
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

  const storeCandidate = (
    cardId: CardId,
    mode: "teach" | "review",
    material: GeneratedMaterial,
    generatedAt: Date,
  ): Result<boolean, MaterialFailure> => {
    const prior = signatures(cardId);
    if (!prior.ok) return prior;
    if (isNearCopy(material.japanese, material.targetSurface, prior.value))
      return ok(false);
    try {
      database
        .query(`INSERT INTO validated_presentation(
        id, card_id, mode, payload_json, normalized_japanese, exact_signature,
        near_signature, generated_at, provider, model, prompt_version, validation_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          options.nextId(),
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
      return ok(true);
    } catch (cause) {
      if (String(cause).includes("validated_presentation.card_id")) return ok(false);
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
      let stored = 0;
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
        if (saved.value) stored += 1;
      }
      if (stored > 0) return ok(undefined);
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
    if (reserve.value !== null) return ok(reserve.value);
    if (mode === "teach") return err({ kind: "teachingNotPrepared" });
    const stocked = await stockReserve(input, mode);
    if (!stocked.ok) return stocked;
    const prepared = takeReserve(input.card.id, mode, "generated");
    if (!prepared.ok) return prepared;
    if (prepared.value !== null) return ok(prepared.value);
    return err({ kind: "noValidCandidate" });
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
              `SELECT card_id, status, failure_kind FROM review_batch_item
               WHERE batch_id = ? ORDER BY seq`,
            )
            .all(batchId) as {
            card_id: CardId;
            status: string;
            failure_kind: string | null;
          }[];
          if (rows.length === 0) return err({ kind: "reviewBatchNotFound", batchId });
          const completed: CardId[] = [];
          const failed: ReviewBatchFailure[] = [];
          let pending = 0;
          for (const row of rows) {
            if (row.status === "ready") completed.push(row.card_id);
            else if (row.status === "failed")
              failed.push({
                cardId: row.card_id,
                kind: (row.failure_kind ?? "offline") as ReviewBatchFailure["kind"],
              });
            else pending += 1;
          }
          const snapshot: ReviewBatchProgress = {
            batchId,
            done: pending === 0,
            pending,
            completed,
            failed,
          };
          return ok(snapshot);
        } catch (cause) {
          return err({ kind: "readFailed", detail: detail(cause) });
        }
      };
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
    permitVerifier,
    close: () => database.close(),
  });
};
