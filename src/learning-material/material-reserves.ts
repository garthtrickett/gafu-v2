import type { Database } from "bun:sqlite";
import { err, ok, type Result } from "../result.ts";
import type { CardId, PresentationPermitVerifier } from "../study/contracts.ts";
import { PRESENTATION_PERMIT_LIFETIME_MS } from "../study/contracts.ts";
import type {
  GeneratedMaterial,
  MaterialFailure,
  MaterialMode,
  PreparedMaterial,
  PrepareMaterial,
} from "./generated-contracts.ts";
import {
  contextMatches,
  materialContext,
  readMaterialContext,
} from "./material-context.ts";

type Row = {
  id: string;
  card_id: CardId;
  payload_json: string;
  provider: string;
  context_json: string | null;
  shown_at: string | null;
  validation_version: string;
};
type PermitRow = {
  token: string;
  id: string;
  card_id: CardId;
  presentation_id: string;
  issued_at: string;
  contract_version: string;
  context_json: string | null;
};
type Options = {
  database: Database;
  clock: () => Date;
  nextId: () => string;
  nextToken: () => string;
  validationVersion: string;
  validate: (
    input: PrepareMaterial & { value: unknown; mode: MaterialMode },
  ) => Promise<Result<GeneratedMaterial, MaterialFailure>>;
};
const failed = (cause: unknown): Result<never, MaterialFailure> =>
  err({
    kind: "writeFailed",
    detail: cause instanceof Error ? cause.message : "Material store failed",
  });

/** Current-context validation and atomic reserve/permit consumption; no provider calls. */
export function createMaterialReserves(o: Options) {
  const db = o.database;
  const cutoff = () =>
    new Date(o.clock().getTime() - PRESENTATION_PERMIT_LIFETIME_MS).toISOString();
  const permits = (cardId: CardId) =>
    db
      .query(`SELECT * FROM presentation_permit
    WHERE card_id=? AND issued_at>? ORDER BY issued_at DESC,id DESC`)
      .all(cardId, cutoff()) as PermitRow[];
  const rows = (cardId: CardId, mode: MaterialMode) =>
    db
      .query(`SELECT * FROM validated_presentation
    WHERE card_id=? AND mode=? AND coalesce(context_json,'')!='rejected'
      AND (shown_at IS NULL OR ?='teach' OR id IN
        (SELECT presentation_id FROM presentation_permit WHERE card_id=? AND issued_at>?))
    ORDER BY generated_at,id`)
      .all(cardId, mode, mode, cardId, cutoff()) as Row[];
  const fence = (input: PrepareMaterial) =>
    input.signal?.aborted !== true && input.isCurrent?.() !== false;
  const check = async (
    input: PrepareMaterial,
    mode: MaterialMode,
  ): Promise<Result<boolean, MaterialFailure>> => {
    try {
      for (const row of rows(input.card.id, mode)) {
        if (
          contextMatches(row.context_json, input) &&
          row.validation_version === o.validationVersion
        )
          continue;
        const old = readMaterialContext(row.context_json),
          expected = materialContext(input);
        let valid = !(
          old &&
          ((old.cardRevision !== expected.cardRevision && mode !== "teach") ||
            old.targetHash !== expected.targetHash)
        );
        // A pre-upgrade issued row from an already-graded review is history, never coverage.
        if (
          mode === "review" &&
          row.shown_at !== null &&
          old === null &&
          !permits(input.card.id).some(
            (p) =>
              p.presentation_id === row.id &&
              (!input.card.lastReviewedAt || p.issued_at > input.card.lastReviewedAt),
          )
        )
          valid = false;
        const currentProof =
          valid &&
          old !== null &&
          old.knowledgeRevision === expected.knowledgeRevision &&
          row.validation_version === o.validationVersion;
        if (valid && !currentProof) {
          const value = JSON.parse(row.payload_json) as GeneratedMaterial;
          if (row.provider === "word-card")
            valid =
              mode === "teach" &&
              input.card.type === "vocabulary" &&
              "lemma" in input.card.content &&
              value.japanese === input.card.content.lemma &&
              value.target.meaning === input.card.content.meaning;
          else {
            const checked = await o.validate({ ...input, value, mode });
            valid = checked.ok;
          }
        }
        if (!fence(input)) return err({ kind: "presentationNotFound" });
        db.query(
          "UPDATE validated_presentation SET context_json=?,validation_version=? WHERE id=?",
        ).run(
          valid ? JSON.stringify(expected) : "rejected",
          o.validationVersion,
          row.id,
        );
      }
      return ok(
        rows(input.card.id, mode).some((row) =>
          contextMatches(row.context_json, input),
        ),
      );
    } catch (cause) {
      return failed(cause);
    }
  };
  const issue = (row: Row, input: PrepareMaterial, at: Date) => {
    const token = o.nextToken();
    db.query(`INSERT INTO presentation_permit(token,id,card_id,presentation_id,issued_at,contract_version,context_json)
      VALUES (?,?,?,?,?,?,?)`).run(
      token,
      o.nextId(),
      row.card_id,
      row.id,
      at.toISOString(),
      o.validationVersion,
      JSON.stringify(materialContext(input)),
    );
    return {
      token,
      expiresAt: new Date(at.getTime() + PRESENTATION_PERMIT_LIFETIME_MS).toISOString(),
    };
  };
  const take = async (
    input: PrepareMaterial,
    mode: MaterialMode,
    source: PreparedMaterial["source"],
  ): Promise<Result<PreparedMaterial | null, MaterialFailure>> => {
    const checked = await check(input, mode);
    if (!checked.ok) return checked;
    try {
      if (!fence(input)) return err({ kind: "presentationNotFound" });
      return db
        .transaction((): Result<PreparedMaterial | null, MaterialFailure> => {
          const available = rows(input.card.id, mode).filter((row) =>
            contextMatches(row.context_json, input),
          );
          let row: Row | undefined,
            permit: PreparedMaterial["permit"] = null;
          if (mode === "review") {
            const issued = permits(input.card.id).find(
              (p) =>
                contextMatches(p.context_json, input) &&
                available.some((r) => r.id === p.presentation_id),
            );
            if (issued) {
              row = available.find((r) => r.id === issued.presentation_id);
              permit = {
                token: issued.token,
                expiresAt: new Date(
                  Date.parse(issued.issued_at) + PRESENTATION_PERMIT_LIFETIME_MS,
                ).toISOString(),
              };
            }
          }
          if (!row && mode === "teach")
            row = available.find((r) => r.shown_at !== null);
          if (!row && mode === "review") {
            // A legacy permit has no authority to grade, but its ungraded material can be recovered locally.
            const legacy = permits(input.card.id).find(
              (p) =>
                p.context_json === null &&
                available.some((r) => r.id === p.presentation_id) &&
                (!input.card.lastReviewedAt || p.issued_at > input.card.lastReviewedAt),
            );
            if (legacy) {
              row = available.find((r) => r.id === legacy.presentation_id);
              if (row) permit = issue(row, input, new Date(legacy.issued_at));
            }
          }
          if (!row) row = available.find((r) => r.shown_at === null);
          if (!row) return ok(null);
          if (row.shown_at === null)
            db.query(
              "UPDATE validated_presentation SET shown_at=? WHERE id=? AND shown_at IS NULL",
            ).run(o.clock().toISOString(), row.id);
          if (mode === "review" && !permit) permit = issue(row, input, o.clock());
          return ok({
            id: row.id,
            cardId: row.card_id,
            mode,
            material: JSON.parse(row.payload_json) as GeneratedMaterial,
            permit,
            source,
            audioUrl: null,
          });
        })
        .immediate();
    } catch (cause) {
      return failed(cause);
    }
  };
  const verifier: PresentationPermitVerifier = {
    verify: (permit, now) => {
      try {
        const row = db
          .query("SELECT * FROM presentation_permit WHERE token=?")
          .get(permit.token) as PermitRow | null;
        if (
          !row ||
          Date.parse(row.issued_at) + PRESENTATION_PERMIT_LIFETIME_MS < now.getTime()
        )
          return err({
            kind: "presentationInvalid",
            detail: "Unknown or expired presentation permit",
          });
        const context = readMaterialContext(row.context_json);
        return ok({
          id: row.id,
          cardId: row.card_id,
          presentationId: row.presentation_id,
          issuedAt: new Date(row.issued_at),
          contractVersion: row.contract_version,
          context: context
            ? {
                cardRevision: context.cardRevision,
                knowledgeRevision: context.knowledgeRevision,
              }
            : null,
        });
      } catch {
        return err({ kind: "presentationInvalid", detail: "Permit store unavailable" });
      }
    },
  };
  const flags = (
    inputs?: readonly PrepareMaterial[],
  ): Result<{ teach: Set<CardId>; review: Set<CardId> }, MaterialFailure> => {
    try {
      const result = { teach: new Set<CardId>(), review: new Set<CardId>() };
      if (inputs) {
        // One query for the entire due scope; this path never validates or performs paid work.
        const all = db
          .query(`SELECT p.card_id,p.mode,p.context_json,p.shown_at,
          EXISTS(SELECT 1 FROM presentation_permit q WHERE q.presentation_id=p.id AND q.issued_at>?) AS issued
          FROM validated_presentation p WHERE coalesce(p.context_json,'')!='rejected'
            AND (p.shown_at IS NULL OR p.mode='teach' OR issued=1)`)
          .all(cutoff()) as {
          card_id: CardId;
          mode: MaterialMode;
          context_json: string | null;
          shown_at: string | null;
          issued: number;
        }[];
        const byId = new Map(inputs.map((input) => [input.card.id, input]));
        for (const row of all) {
          const input = byId.get(row.card_id);
          if (input && contextMatches(row.context_json, input))
            result[row.mode].add(row.card_id);
        }
      } else {
        for (const row of db
          .query(`SELECT DISTINCT card_id,mode FROM validated_presentation WHERE coalesce(context_json,'')!='rejected'
          AND (shown_at IS NULL OR mode='teach' OR id IN(SELECT presentation_id FROM presentation_permit WHERE issued_at>?))`)
          .all(cutoff()) as { card_id: CardId; mode: MaterialMode }[])
          result[row.mode].add(row.card_id);
      }
      return ok(result);
    } catch (cause) {
      return failed(cause);
    }
  };
  return { check, take, verifier, flags };
}
