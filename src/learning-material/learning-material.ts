import { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type {
  CardId,
  CardSummary,
  KnowledgeSnapshot as StudyKnowledgeSnapshot,
} from "../study/contracts.ts";
import type { ProviderKeyCustody } from "../topology/provider-key-custody.ts";
import { createBatchExecution } from "./batch-execution.ts";
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
import { parseBroadPartOfSpeech } from "./generated-decode.ts";
import {
  type MaterialContext,
  materialContext,
  readMaterialContext,
} from "./material-context.ts";
import { MATERIAL_SCHEMA_VERSION, migrateMaterial } from "./material-migrations.ts";
import { createMaterialReserves } from "./material-reserves.ts";
import { createMaterialSpeech } from "./material-speech.ts";
import type { SpeechProvider } from "./speech-contracts.ts";
import { exactSignature, isNearCopy, nearSignature } from "./variation.ts";

export { MATERIAL_SCHEMA_VERSION };

/** Marks a row written for a word Card rather than generated as a sentence. */
const WORD_CARD_PROVIDER = "word-card";
export const MATERIAL_VALIDATION_VERSION = "material-v2";
const BACKGROUND_RETRY_COOLDOWN_MS = 24 * 60 * 60_000;

type MaterialRow = Readonly<{
  id: string;
  card_id: string;
  mode: "teach" | "review";
  payload_json: string;
}>;

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
  /** Learner setting, checked again when a banked presentation is served. */
  speechEnabled?: () => boolean;
  /** Synthesis attempts per UTC day before new clips stop; default 200. */
  speechDailyLimit?: number;
  providerConfigurationId?: string;
  automaticSpeechCurrent?: (cardId: CardId, context: MaterialContext) => boolean;
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
  const migrated = migrateMaterial(database, now.value.toISOString());
  if (!migrated.ok) {
    database.close();
    return migrated;
  }

  let closed = false;
  const reserves = createMaterialReserves({
    database,
    clock: options.clock,
    nextId: options.nextId,
    nextToken: options.nextToken,
    validationVersion: MATERIAL_VALIDATION_VERSION,
    validate: options.validate,
  });
  const permitVerifier = reserves.verifier;
  const speech = createMaterialSpeech({
    database,
    clock: options.clock,
    provider: options.speech,
    enabled: () => !closed && options.speechEnabled?.() !== false,
    dailyLimit: options.speechDailyLimit ?? 200,
    currentAutomatic: (id) => {
      const row = database
        .query("SELECT card_id,context_json FROM validated_presentation WHERE id=?")
        .get(id) as { card_id: CardId; context_json: string | null } | null;
      const context = row ? readMaterialContext(row.context_json) : null;
      return (
        row !== null &&
        context !== null &&
        options.automaticSpeechCurrent?.(row.card_id, context) !== false
      );
    },
  });
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
        WHERE card_id = ? AND shown_at IS NOT NULL AND provider <> '${WORD_CARD_PROVIDER}'
        ORDER BY shown_at DESC LIMIT 5`)
        .all(cardId) as { normalized_japanese: string }[];
      return ok(rows.map((row) => row.normalized_japanese));
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  const audioUrlFor = (presentationId: string): string =>
    `/api/study/presentations/${encodeURIComponent(presentationId)}/audio`;

  const hasAudio = (id: string): boolean =>
    database
      .query("SELECT 1 FROM presentation_audio WHERE presentation_id=?")
      .get(id) !== null;
  const synthesizeAudio = async (
    id: string,
    japanese: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    speech.enqueue(id, japanese, false, true);
    for (let round = 0; round < 8 && !speech.hasCurrent(id); round++) {
      const before = database
        .query("SELECT count(*) AS n FROM material_speech_job WHERE state='queued'")
        .get() as { n: number };
      await speech.tick(signal);
      const after = database
        .query("SELECT count(*) AS n FROM material_speech_job WHERE state='queued'")
        .get() as { n: number };
      if (after.n >= before.n) break;
    }
  };
  const withAudio = async (
    prepared: PreparedMaterial,
    signal?: AbortSignal,
    nonblocking = false,
  ): Promise<PreparedMaterial> => {
    if (nonblocking) return speech.attach(prepared);
    if (options.speechEnabled?.() === false) return { ...prepared, audioUrl: null };
    await synthesizeAudio(prepared.id, prepared.material.japanese, signal);
    return {
      ...prepared,
      audioUrl: hasAudio(prepared.id) ? audioUrlFor(prepared.id) : null,
    };
  };

  /**
   * Teaching is display-only, so a teach presentation stays servable until
   * the learner says Seen it. Taking it set `shown_at`; a tab closed before
   * the acknowledgement must not strand the Card with nothing to show.
   */
  const latestShownTeaching = (
    card: CardSummary,
  ): Result<PreparedMaterial | null, MaterialFailure> => {
    try {
      const row = database
        .query(`SELECT id, card_id, mode, payload_json
        FROM validated_presentation
        WHERE card_id = ? AND mode = 'teach' AND shown_at IS NOT NULL
          AND (? <> 'grammar' OR provider <> 'word-card')
        ORDER BY shown_at DESC, id DESC LIMIT 1`)
        .get(card.id, card.type) as MaterialRow | null;
      if (row === null) return ok(null);
      return ok({
        id: row.id,
        cardId: card.id,
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
            `SELECT 1 FROM validated_presentation
             WHERE card_id = ? AND mode = 'teach'
               AND (provider <> ? OR json_extract(payload_json, '$.targetKind') <> 'grammar')`,
          )
          .get(cardId, WORD_CARD_PROVIDER) !== null,
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
              `SELECT DISTINCT card_id FROM validated_presentation
               WHERE mode = 'teach'
                 AND (provider <> ? OR json_extract(payload_json, '$.targetKind') <> 'grammar')`,
            )
            .all(WORD_CARD_PROVIDER) as { card_id: CardId }[]
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

  const signatures = (cardId: CardId): Result<readonly string[], MaterialFailure> => {
    try {
      const rows = database
        .query(`SELECT near_signature FROM validated_presentation
        WHERE card_id = ? AND ((shown_at IS NULL AND coalesce(context_json,'')!='rejected') OR id IN (
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
    input: Parameters<LearningMaterial["prepare"]>[0],
    queueAudio = false,
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
        near_signature, generated_at, provider, model, prompt_version, validation_version, context_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
          JSON.stringify(materialContext(input)),
        );
      if (queueAudio) speech.enqueue(id, material.japanese, input.automatic ?? false);
      return ok(id);
    } catch (cause) {
      if (String(cause).includes("validated_presentation.card_id")) return ok(null);
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const reserveFlags: LearningMaterial["reserveFlags"] = (inputs) =>
    reserves.flags(inputs);
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
        if (input.isCurrent?.() === false) return err({ kind: "presentationNotFound" });
        const saved = storeCandidate(
          input.card.id,
          mode,
          validated.value,
          generatedAt.value,
          input,
          true,
        );
        if (!saved.ok) return saved;
        if (saved.value !== null)
          banked.push({ id: saved.value, japanese: validated.value.japanese });
      }
      if (banked.length > 0) {
        // Say every banked sentence now, concurrently, so a later serve is
        // instant. Each is best effort; none can fail the material.
        if (mode === "review") {
          for (const item of banked)
            await synthesizeAudio(item.id, item.japanese, input.signal);
        }
        return ok(undefined);
      }
    }
    return rejectionReasons.length > 0
      ? err({ kind: "validationRejected", reasons: rejectionReasons })
      : err({ kind: "noValidCandidate" });
  };

  /**
   * Which mode a Card wants: a first exposure while it is new and unseen,
   * a review once its teaching has been acknowledged. The batch asks the
   * same question, so what it banks is what the serve will take.
   */
  const modeFor = (card: CardSummary): Result<"teach" | "review", MaterialFailure> => {
    const taught = hasTeaching(card.id);
    if (!taught.ok) return taught;
    return ok(card.schedulePhase === "new" && !taught.value ? "teach" : "review");
  };

  /** Whether a first exposure can use the word when no sentence is writable. */
  const _unwritable = (kind: string | null): boolean =>
    kind === "noValidCandidate" ||
    kind === "validationRejected" ||
    kind === "malformedResponse";

  /**
   * Banks the Card itself as a first exposure when no sentence can be written.
   *
   * Some words cannot have an i+1 sentence yet: 頬袋 wants ハムスター, which
   * the learner has not met, so every round refused it and the Card was
   * admitted and then unservable for ever. First exposure may show the Card's
   * own writing, reading and meaning. Reviews stay due until a sentence is
   * validated; repeating the bare word would never test it in context.
   */
  const bankWordPresentation = (
    card: CardSummary,
    mode: "teach" | "review",
  ): Result<void, MaterialFailure> => {
    if (card.type !== "vocabulary") return err({ kind: "noValidCandidate" });
    const observedAt = safeNow(options.clock);
    if (!observedAt.ok) return observedAt;
    const content = card.content as Record<string, string>;
    const written = content["lemma"] ?? "";
    if (written === "") return err({ kind: "noValidCandidate" });
    const meaning = content["meaning"] ?? "";
    const reading = content["reading"] ?? "";
    const shared = {
      mode,
      context: "",
      prompt: mode === "teach" ? "A new word." : "What does this word mean?",
      japanese: written,
      targetSurface: written,
      targetSpan: {
        start: 0,
        end: written.length,
        unit: "utf16-code-unit" as const,
        normalization: "nfkc-v1" as const,
      },
      // The reading is shown with the word rather than held back: what is
      // being asked for here is the meaning, not the reading.
      readingSegments: [{ written, reading }],
      answer: meaning,
      explanation: meaning,
      usageNote: content["usageNotes"] ?? "",
    };
    // The target travels with the material, because the page reads it to show
    // what the Card claims.
    const material: GeneratedMaterial = {
      ...shared,
      targetKind: "vocabulary",
      target: {
        lemma: written,
        reading,
        partOfSpeech: parseBroadPartOfSpeech(content["partOfSpeech"] ?? "") ?? "noun",
        meaning,
      },
    };
    const id = options.nextId();
    try {
      database
        .query(
          `INSERT INTO validated_presentation(
             id, card_id, mode, payload_json, normalized_japanese, exact_signature,
             near_signature, generated_at, shown_at, provider, model, prompt_version,
             validation_version
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '-', '-', ?)`,
        )
        .run(
          id,
          card.id,
          mode,
          JSON.stringify(material),
          written,
          `word:${id}`,
          `word:${id}`,
          observedAt.value.toISOString(),
          WORD_CARD_PROVIDER,
          MATERIAL_VALIDATION_VERSION,
        );
      return ok(undefined);
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const prepare: LearningMaterial["prepare"] = async (input) => {
    const wanted = modeFor(input.card);
    if (!wanted.ok) return wanted;
    const mode = wanted.value;
    const reserve = await reserves.take(input, mode, "reserve");
    if (!reserve.ok) return reserve;
    if (reserve.value !== null)
      return ok(await withAudio(reserve.value, input.signal, input.cachedOnly));
    if (input.cachedOnly) return err({ kind: "teachingNotPrepared" });
    if (mode === "teach") {
      // A first exposure already shown is shown again rather than rewritten:
      // the Card is met once, and meeting it twice in different words is a
      // different Card as far as the learner is concerned.
      const shown = latestShownTeaching(input.card);
      if (!shown.ok) return shown;
      if (shown.value !== null) return ok(await withAudio(shown.value, input.signal));
    }
    // Both modes generate rather than give up. First exposures used not to:
    // they were expected to come from teaching authored when the Card was
    // made, or from the batch. A Card made through the API has no authored
    // teaching, so at fifty new Cards a day against twenty a batch press the
    // learner reaches them first and meets a bare word — which is the thing
    // the fallback exists to avoid, not a first exposure it should produce.
    const stocked = await stockReserve(input, mode);
    if (stocked.ok) {
      const prepared = await reserves.take(input, mode, "generated");
      if (!prepared.ok) return prepared;
      if (prepared.value !== null)
        return ok(await withAudio(prepared.value, input.signal, input.cachedOnly));
    }
    // A review with no validated sentence stays due. A word-only first
    // exposure may still introduce a vocabulary Card whose context cannot
    // yet be written using the learner's known language.
    if (mode === "review" || input.card.type === "grammar")
      return stocked.ok ? err({ kind: "noValidCandidate" }) : stocked;
    const word = bankWordPresentation(input.card, mode);
    if (!word.ok) return word;
    const fallback = await reserves.take(input, mode, "reserve");
    if (!fallback.ok) return fallback;
    if (fallback.value !== null)
      return ok(await withAudio(fallback.value, input.signal));
    return err({ kind: "noValidCandidate" });
  };

  type BatchInput = {
    card: CardSummary;
    knowledge: StudyKnowledgeSnapshot;
    automatic?: boolean;
  };

  /** Deletes every batch with nothing pending and no change since the cutoff. */
  const deleteFinishedBatches = (now: Date, olderThanMs: number): number => {
    const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
    const finished = (
      database
        .query(
          `SELECT batch_id FROM review_batch_item
           GROUP BY batch_id
           HAVING sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) = 0
              AND max(updated_at) < ?`,
        )
        .all(cutoff) as { batch_id: string }[]
    ).map((row) => row.batch_id);
    for (const old of finished) {
      if (
        database
          .query(
            "SELECT 1 FROM review_batch_job WHERE batch_id=? AND phase='uncertain'",
          )
          .get(old)
      )
        continue;
      database.query("DELETE FROM review_batch_claim WHERE batch_id=?").run(old);
      database.query("DELETE FROM review_batch_attempt WHERE batch_id=?").run(old);
      database.query("DELETE FROM review_batch_item WHERE batch_id = ?").run(old);
      database.query("DELETE FROM review_batch_job WHERE batch_id = ?").run(old);
      database.query("DELETE FROM review_batch WHERE batch_id = ?").run(old);
    }
    return finished.length;
  };

  const purgeFinishedBatches: LearningMaterial["purgeFinishedBatches"] = (
    olderThanMs,
  ) => {
    const now = safeNow(options.clock);
    if (!now.ok) return now;
    try {
      let removed = 0;
      const apply = database.transaction(() => {
        removed = deleteFinishedBatches(now.value, olderThanMs);
      });
      apply.immediate();
      return ok(removed);
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  /**
   * The knowledge a batch was begun with: from the batch row, or, for items
   * written before it existed, from the copy inside the item itself.
   */
  const batchInput = (batchId: string, inputJson: string): BatchInput | null => {
    let parsed: { card?: CardSummary; knowledge?: StudyKnowledgeSnapshot };
    try {
      parsed = JSON.parse(inputJson) as typeof parsed;
    } catch {
      return null;
    }
    if (parsed.card === undefined) return null;
    if (parsed.knowledge !== undefined)
      return { card: parsed.card, knowledge: parsed.knowledge };
    const row = database
      .query("SELECT knowledge_json,origin FROM review_batch WHERE batch_id = ?")
      .get(batchId) as { knowledge_json: string; origin: string } | null;
    if (row === null) return null;
    try {
      return {
        card: parsed.card,
        knowledge: JSON.parse(row.knowledge_json) as StudyKnowledgeSnapshot,
        automatic: row.origin !== "manual",
      };
    } catch {
      return null;
    }
  };

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

  const setBackgroundRetryCooldown = (
    cardId: CardId,
    status: "ready" | "failed",
    at: string,
  ): void => {
    if (status === "ready") {
      database.query("DELETE FROM review_batch_cooldown WHERE card_id = ?").run(cardId);
    } else {
      database
        .query(
          `INSERT INTO review_batch_cooldown(card_id, failed_at) VALUES (?, ?)
           ON CONFLICT(card_id) DO UPDATE SET failed_at = excluded.failed_at`,
        )
        .run(cardId, at);
    }
  };

  const executor = createBatchExecution({
    database,
    clock: options.clock,
    nextId: options.nextId,
    ownerToken: options.nextToken(),
    provider: options.provider,
    providerBinding: JSON.stringify({
      ...options.provider.identity,
      configuration: options.providerConfigurationId ?? "default",
    }),
    input: batchInput,
    mode: (input) => modeFor(input.card),
    hasReserve: (input, mode) => {
      const flags = reserves.flags([input]);
      return flags.ok ? ok(flags.value[mode].has(input.card.id)) : flags;
    },
    recent: recentJapanese,
    validate: options.validate,
    store: (input, mode, value, at) =>
      storeCandidate(input.card.id, mode, value, at, input, true),
    word: (input, mode) => {
      const saved = bankWordPresentation(input.card, mode);
      if (saved.ok)
        database
          .query(
            "UPDATE validated_presentation SET context_json=? WHERE card_id=? AND mode=? AND provider='word-card' AND context_json IS NULL AND shown_at IS NULL",
          )
          .run(JSON.stringify(materialContext(input)), input.card.id, mode);
      return saved;
    },
    cooldown: setBackgroundRetryCooldown,
    ready: () => {},
  });
  const reviewBatchProgress: LearningMaterial["reviewBatchProgress"] = (batchId) => {
    try {
      const rows = database
        .query(
          "SELECT card_id,status,failure_kind,attempts,hints_json FROM review_batch_item WHERE batch_id=? ORDER BY seq",
        )
        .all(batchId) as {
        card_id: CardId;
        status: string;
        failure_kind: ReviewBatchFailure["kind"] | null;
        attempts: number;
        hints_json: string | null;
      }[];
      if (!rows.length) return err({ kind: "reviewBatchNotFound", batchId });
      const pending = rows.filter((r) => r.status === "pending");
      return ok({
        batchId,
        done: !pending.length,
        pending: pending.length,
        completed: rows.filter((r) => r.status === "ready").map((r) => r.card_id),
        failed: rows
          .filter((r) => r.status === "failed")
          .map((r) => ({
            cardId: r.card_id,
            kind: r.failure_kind ?? "noValidCandidate",
            reasons: JSON.parse(r.hints_json ?? "[]") as string[],
          })),
        round: Math.max(1, ...pending.map((r) => r.attempts + 1)),
        requestInFlight:
          pending.length > 0 &&
          database
            .query("SELECT 1 FROM review_batch_job WHERE batch_id=?")
            .get(batchId) !== null,
      });
    } catch (cause) {
      return err({ kind: "readFailed", detail: detail(cause) });
    }
  };

  return ok({
    prepare,
    reviewBatchProgress,
    checkReserves: async (input) => {
      const mode = modeFor(input.card);
      return mode.ok ? reserves.check(input, mode.value) : mode;
    },
    presentationSpeech: (id) => {
      try {
        return ok(speech.status(id));
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    retrySpeech: (id, confirmed) => {
      try {
        return speech.retry(id, confirmed)
          ? ok(undefined)
          : err({ kind: "presentationNotFound" });
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    advanceSpeech: (signal, allowAutomatic) => speech.tick(signal, allowAutomatic),
    promoteReviewBatch: (batchId) => {
      database
        .query("UPDATE review_batch SET origin='manual' WHERE batch_id=?")
        .run(batchId);
      return ok(undefined);
    },
    resumePreparation: () => {
      executor.resume();
      return ok(undefined);
    },
    pauseRestoredPreparation: () => {
      database
        .query(
          "UPDATE review_batch_job SET phase='uncertain' WHERE job_id='' OR phase='dispatching'",
        )
        .run();
      return ok(undefined);
    },
    reconcilePreparation: (obsolete) => {
      try {
        const items = database
          .query(`SELECT batch_id,seq,card_id,input_json FROM review_batch_item
          WHERE status='pending' OR failure_kind='dispatchUncertain'`)
          .all() as {
          batch_id: string;
          seq: number;
          card_id: CardId;
          input_json: string;
        }[];
        const stale = items.filter((item) => {
          try {
            const card = JSON.parse(item.input_json).card as CardSummary | undefined;
            return (
              card !== undefined &&
              typeof card.id === "string" &&
              typeof card.reviewCount === "number" &&
              card.content !== null &&
              typeof card.content === "object" &&
              obsolete(card)
            );
          } catch {
            return false;
          }
        });
        database
          .transaction(() => {
            for (const item of stale) {
              database
                .query(
                  "UPDATE review_batch_item SET status='failed',failure_kind='presentationNotFound',updated_at=? WHERE batch_id=? AND seq=?",
                )
                .run(options.clock().toISOString(), item.batch_id, item.seq);
              database
                .query("DELETE FROM review_batch_claim WHERE batch_id=? AND card_id=?")
                .run(item.batch_id, item.card_id);
            }
            // Retain remote IDs as evidence even when every local target is obsolete.
            database.exec(`UPDATE review_batch_job SET phase='uncertain' WHERE NOT EXISTS(
            SELECT 1 FROM review_batch_item i WHERE i.batch_id=review_batch_job.batch_id AND i.status='pending');
            INSERT OR IGNORE INTO review_batch_claim(card_id,batch_id,context_json)
            SELECT card_id,batch_id,'{}' FROM review_batch_item
            WHERE status='pending' OR failure_kind='dispatchUncertain' ORDER BY updated_at,batch_id;`);
          })
          .immediate();
        return ok(stale.length);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    preparationState: () => {
      try {
        const state = executor.state();
        const uncertain = database
          .query(
            "SELECT j.batch_id FROM review_batch_job j WHERE phase='uncertain' AND EXISTS(SELECT 1 FROM review_batch_claim c WHERE c.batch_id=j.batch_id)",
          )
          .all() as { batch_id: string }[];
        const claims = database
          .query(
            "SELECT c.card_id,j.phase FROM review_batch_claim c LEFT JOIN review_batch_job j ON j.batch_id=c.batch_id",
          )
          .all() as { card_id: CardId; phase: string | null }[];
        return ok({
          blockedReason: state.blocked_reason || null,
          retryAt: state.retry_at,
          activeCardIds: claims
            .filter((c) => c.phase !== "uncertain")
            .map((c) => c.card_id),
          uncertainCardIds: claims
            .filter((c) => c.phase === "uncertain")
            .map((c) => c.card_id),
          uncertainBatches: uncertain.map((b) => b.batch_id),
        });
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    batchExecution: (batchId) => {
      const row = database
        .query(
          "SELECT b.origin,b.blocked_reason,b.retry_at,j.phase FROM review_batch b LEFT JOIN review_batch_job j ON j.batch_id=b.batch_id WHERE b.batch_id=?",
        )
        .get(batchId) as {
        origin: "manual" | "whileOpen" | "server";
        blocked_reason: string | null;
        retry_at: string | null;
        phase: string | null;
      } | null;
      return row
        ? ok({
            origin: row.origin,
            phase: row.phase ?? "queued",
            blockedReason: row.blocked_reason,
            retryAt: row.retry_at,
          })
        : err({ kind: "reviewBatchNotFound", batchId });
    },
    retryUncertainBatch: (batchId, recovery = {}) => {
      try {
        const row = database
          .query(
            "SELECT phase,job_id,provider_identity FROM review_batch_job WHERE batch_id=?",
          )
          .get(batchId) as {
          phase: string;
          job_id: string;
          provider_identity: string | null;
        } | null;
        if (row?.phase !== "uncertain")
          return err({ kind: "reviewBatchNotFound", batchId });
        const binding = JSON.stringify({
          ...options.provider.identity,
          configuration: options.providerConfigurationId ?? "default",
        });
        if (row.provider_identity !== binding && !recovery.confirmProviderChange)
          return err({ kind: "dispatchUncertain" });
        if ((!row.job_id || recovery.abandonKnownRequest) && !recovery.allowRepurchase)
          return err({ kind: "dispatchUncertain" });
        database.transaction(() => {
          database
            .query(
              "UPDATE review_batch_attempt SET disposition='explicitly-retried' WHERE batch_id=? AND disposition NOT IN ('settled','cancelled')",
            )
            .run(batchId);
          if (row.job_id && !recovery.abandonKnownRequest)
            database
              .query(
                "UPDATE review_batch_job SET phase='recovering',provider_identity=? WHERE batch_id=?",
              )
              .run(binding, batchId);
          else
            database
              .query("DELETE FROM review_batch_job WHERE batch_id=?")
              .run(batchId);
          database
            .query(
              "UPDATE review_batch SET origin='manual',blocked_reason=NULL,retry_at=NULL WHERE batch_id=?",
            )
            .run(batchId);
          if (recovery.currentInputs) {
            const fresh = new Map(
              recovery.currentInputs.map((input) => [input.card.id, input]),
            );
            const rows = database
              .query(
                "SELECT seq,card_id FROM review_batch_item WHERE batch_id=? AND failure_kind='dispatchUncertain'",
              )
              .all(batchId) as { seq: number; card_id: CardId }[];
            let knowledge: StudyKnowledgeSnapshot | undefined;
            for (const item of rows) {
              const input = fresh.get(item.card_id);
              if (input) {
                knowledge = input.knowledge;
                database
                  .query(
                    "UPDATE review_batch_item SET input_json=? WHERE batch_id=? AND seq=?",
                  )
                  .run(JSON.stringify({ card: input.card }), batchId, item.seq);
                database
                  .query(
                    "UPDATE review_batch_claim SET context_json=? WHERE batch_id=? AND card_id=?",
                  )
                  .run(JSON.stringify(materialContext(input)), batchId, item.card_id);
              } else {
                database
                  .query(
                    "UPDATE review_batch_item SET failure_kind='presentationNotFound' WHERE batch_id=? AND seq=?",
                  )
                  .run(batchId, item.seq);
                database
                  .query(
                    "DELETE FROM review_batch_claim WHERE batch_id=? AND card_id=?",
                  )
                  .run(batchId, item.card_id);
              }
            }
            if (knowledge)
              database
                .query("UPDATE review_batch SET knowledge_json=? WHERE batch_id=?")
                .run(JSON.stringify(knowledge), batchId);
          }
          database
            .query(
              "UPDATE review_batch_item SET status='pending',failure_kind=NULL WHERE batch_id=? AND failure_kind='dispatchUncertain'",
            )
            .run(batchId);
        })();
        return ok(undefined);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    hasTeaching,
    hasReserve,
    backgroundRetryBlockedCards: () => {
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      const since = new Date(
        observedAt.value.getTime() - BACKGROUND_RETRY_COOLDOWN_MS,
      ).toISOString();
      try {
        const rows = database
          .query("SELECT card_id FROM review_batch_cooldown WHERE failed_at > ?")
          .all(since) as { card_id: CardId }[];
        return ok(new Set(rows.map((row) => row.card_id)));
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    resetPreparationFailure: (cardId) => {
      try {
        database.query("DELETE FROM review_batch_cooldown WHERE card_id=?").run(cardId);
        return ok(undefined);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    pendingReviewBatch: () => {
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      try {
        const row = database
          .query(`SELECT b.batch_id AS batchId,count(i.seq) AS total
          FROM review_batch b JOIN review_batch_item i ON i.batch_id=b.batch_id
          WHERE EXISTS(SELECT 1 FROM review_batch_item p WHERE p.batch_id=b.batch_id AND p.status='pending')
          GROUP BY b.batch_id ORDER BY EXISTS(SELECT 1 FROM review_batch_job j WHERE j.batch_id=b.batch_id AND j.phase!='uncertain') DESC,b.created_at,b.batch_id LIMIT 1`)
          .get() as { batchId: string; total: number } | null;
        return ok(row);
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    beginReviewBatch: (cards, batchOptions) => {
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      const batchId = options.nextId();
      const first = cards[0];
      try {
        const insert = database.transaction(() => {
          const active = database
            .query(`SELECT b.batch_id FROM review_batch b
            WHERE EXISTS(SELECT 1 FROM review_batch_item i WHERE i.batch_id=b.batch_id AND i.status='pending')
            ORDER BY b.created_at,b.batch_id LIMIT 1`)
            .get() as { batch_id: string } | null;
          const focused = batchOptions?.focusCardId
            ? (database
                .query("SELECT batch_id FROM review_batch_claim WHERE card_id=?")
                .get(batchOptions.focusCardId) as { batch_id: string } | null)
            : null;
          if (focused) {
            if (batchOptions?.origin === "manual")
              database
                .query("UPDATE review_batch SET origin='manual' WHERE batch_id=?")
                .run(focused.batch_id);
            return focused.batch_id;
          }
          if (active && !batchOptions?.queue) {
            if (batchOptions?.origin === "manual")
              database
                .query("UPDATE review_batch SET origin='manual' WHERE batch_id=?")
                .run(active.batch_id);
            return active.batch_id;
          }
          // Housekeeping: a batch finished more than an hour ago has been
          // worked through or abandoned; its rows only take space.
          deleteFinishedBatches(observedAt.value, 60 * 60 * 1_000);
          if (first !== undefined) {
            database
              .query(
                "INSERT INTO review_batch(batch_id, knowledge_json, created_at,origin) VALUES (?, ?, ?, ?)",
              )
              .run(
                batchId,
                JSON.stringify(first.knowledge),
                observedAt.value.toISOString(),
                batchOptions?.origin ?? "manual",
              );
          }
          const add = database.query(
            `INSERT INTO review_batch_item(batch_id, seq, card_id, input_json, status, updated_at)
             VALUES (?, ?, ?, ?, 'pending', ?)`,
          );
          cards.forEach((input, index) => {
            const claim = database
              .query("SELECT batch_id FROM review_batch_claim WHERE card_id=?")
              .get(input.card.id);
            if (claim && batchOptions?.queue) return;
            if (claim) throw new Error("Card already has preparation work");
            database
              .query("INSERT INTO review_batch_claim VALUES (?,?,?)")
              .run(input.card.id, batchId, JSON.stringify(materialContext(input)));
            add.run(
              batchId,
              index,
              input.card.id,
              JSON.stringify({ card: input.card }),
              observedAt.value.toISOString(),
            );
          });
          return batchId;
        });
        return ok(insert.immediate());
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    advanceReviewBatch: async (
      batchId: string,
      policy = {},
    ): Promise<Result<ReviewBatchProgress, MaterialFailure>> => {
      const progress = () => reviewBatchProgress(batchId);
      if (options.provider.batch !== undefined) {
        const advanced = await executor.advance(
          batchId,
          options.provider.batch,
          policy,
        );
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
      const input = batchInput(batchId, item.input_json);
      if (input === null) {
        return err({ kind: "writeFailed", detail: "review batch input is corrupt" });
      }
      const observedAt = safeNow(options.clock);
      if (!observedAt.ok) return observedAt;
      const finish = (
        status: "ready" | "failed",
        failureKind: string | null,
      ): Result<ReviewBatchProgress, MaterialFailure> => {
        try {
          const at = observedAt.value.toISOString();
          const settle = database.transaction(() => {
            setItemStatus(batchId, item.seq, status, failureKind, at);
            database
              .query("DELETE FROM review_batch_claim WHERE card_id=? AND batch_id=?")
              .run(item.card_id, batchId);
            setBackgroundRetryCooldown(item.card_id, status, at);
          });
          settle.immediate();
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
    discardReserves: (cardId) => {
      try {
        let discarded = 0;
        const discard = database.transaction(() => {
          database
            .query(`DELETE FROM presentation_audio WHERE presentation_id IN (
              SELECT id FROM validated_presentation
              WHERE card_id = ? AND mode = 'review' AND shown_at IS NULL)`)
            .run(cardId);
          discarded = database
            .query(`DELETE FROM validated_presentation
            WHERE card_id = ? AND mode = 'review' AND shown_at IS NULL`)
            .run(cardId).changes;
        });
        discard.immediate();
        return ok(discarded);
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
        { card, knowledge },
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
    reserveFlags,
    purgeFinishedBatches,
    permitVerifier,
    close: () => {
      closed = true;
      database.close();
    },
  });
};
