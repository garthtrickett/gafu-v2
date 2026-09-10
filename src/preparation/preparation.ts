import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { err, ok, type Result } from "../result.ts";
import type { StudyPreparationSnapshot } from "../study/contracts.ts";
import { createPreparationBatching } from "./batching.ts";
import type {
  AnalysisManifest,
  AnalysisRunSnapshot,
  AnalyzedCue,
  BatchCheckpoint,
  MergedCandidate,
} from "./batching-contracts.ts";
import type {
  AnalysisPreflight,
  CorrectionCommand,
  Preparation,
  PreparationDependencies,
  PreparationFailure,
  PreparationFinding,
  PreparationSnapshot,
} from "./contracts.ts";
import type {
  CommitImport,
  ImportReport,
  ParsedEpisode,
  SubtitleSetId,
  SubtitleSetSnapshot,
} from "./import-contracts.ts";
import { asSubtitleSetId } from "./import-contracts.ts";
import { projectPlanDraft } from "./plan.ts";
import {
  findingCounts,
  projectFindings,
  providerUsage,
  type StoredFinding,
  validateCompleteEvidence,
} from "./projection.ts";
import { createSqliteCheckpointStore } from "./sqlite-checkpoint-store.ts";

export const PREPARATION_SCHEMA_VERSION = 2;
const NORMALIZATION_VERSION = "nfkc-v1";

type PendingImport = Readonly<{
  report: ImportReport;
  episodes: readonly ParsedEpisode[];
  expiresAt: number;
}>;

type PendingPreflight = Readonly<{
  value: AnalysisPreflight;
  manifest: AnalysisManifest;
  study: StudyPreparationSnapshot;
  expiresAt: number;
}>;

type SetRow = Readonly<{
  id: string;
  title: string;
  source_revision: string;
  created_at: string;
}>;

type EpisodeRow = Readonly<{
  episode_key: string;
  title: string;
  episode_order: number;
  display_name: string;
  cue_count: number;
  duration_ms: number;
}>;

type CueRow = Readonly<{
  episode_key: string;
  episode_title: string;
  episode_order: number;
  cue_key: string;
  cue_order: number;
  start_ms: number;
  end_ms: number;
  raw_text: string;
  normalized_text: string;
}>;

type RunRow = Readonly<{
  run_id: string;
  manifest_json: string;
  state: PreparationSnapshot["state"];
  failure_json: string | null;
  merged_json: string | null;
  findings_json: string | null;
  study_digest: string | null;
}>;

const detail = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const safeNow = (
  clock: () => Date,
): Result<Date, Extract<PreparationFailure, { kind: "invalidClock" }>> => {
  try {
    const value = clock();
    return Number.isFinite(value.getTime())
      ? ok(new Date(value.getTime()))
      : err({ kind: "invalidClock" });
  } catch {
    return err({ kind: "invalidClock" });
  }
};

const migrate = (
  database: Database,
  appliedAt: string,
): Result<void, PreparationFailure> => {
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA journal_mode = WAL");
    database.exec(`
      CREATE TABLE IF NOT EXISTS preparation_migration (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const current = database
      .query("SELECT coalesce(max(version), 0) AS version FROM preparation_migration")
      .get() as { version: number };
    if (current.version > PREPARATION_SCHEMA_VERSION) {
      return err({ kind: "unsupportedSchema", found: current.version });
    }
    const applied = database
      .query("SELECT version FROM preparation_migration ORDER BY version")
      .all() as { version: number }[];
    if (!applied.every(({ version }, index) => version === index + 1)) {
      return err({
        kind: "migrationFailed",
        detail: "Preparation migration history is not contiguous.",
      });
    }
    if (current.version >= PREPARATION_SCHEMA_VERSION) return ok(undefined);
    if (current.version === 1) {
      const addDispatchId = database.transaction(() => {
        database.exec(
          "ALTER TABLE preparation_batch ADD COLUMN provider_response_id TEXT",
        );
        database
          .query("INSERT INTO preparation_migration(version, applied_at) VALUES (2, ?)")
          .run(appliedAt);
      });
      addDispatchId.immediate();
      return ok(undefined);
    }
    const apply = database.transaction(() => {
      database.exec(`
        CREATE TABLE subtitle_set (
          id TEXT PRIMARY KEY,
          operation_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          source_revision TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE subtitle_episode (
          subtitle_set_id TEXT NOT NULL REFERENCES subtitle_set(id) ON DELETE CASCADE,
          episode_key TEXT NOT NULL,
          source_digest TEXT NOT NULL,
          title TEXT NOT NULL,
          episode_order INTEGER NOT NULL,
          display_name TEXT NOT NULL,
          PRIMARY KEY (subtitle_set_id, episode_key),
          UNIQUE (subtitle_set_id, episode_order)
        );
        CREATE TABLE subtitle_cue (
          subtitle_set_id TEXT NOT NULL,
          episode_key TEXT NOT NULL,
          cue_key TEXT NOT NULL,
          cue_order INTEGER NOT NULL,
          source_label TEXT,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          raw_text TEXT NOT NULL,
          normalized_text TEXT NOT NULL,
          PRIMARY KEY (subtitle_set_id, cue_key),
          FOREIGN KEY (subtitle_set_id, episode_key)
            REFERENCES subtitle_episode(subtitle_set_id, episode_key) ON DELETE CASCADE,
          UNIQUE (subtitle_set_id, episode_key, cue_order)
        );
        CREATE TABLE preparation_run (
          run_id TEXT PRIMARY KEY,
          subtitle_set_id TEXT NOT NULL REFERENCES subtitle_set(id) ON DELETE CASCADE,
          source_revision TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'paused', 'complete', 'failed')),
          failure_json TEXT,
          merged_json TEXT,
          findings_json TEXT,
          study_digest TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX preparation_run_set_idx
          ON preparation_run(subtitle_set_id, updated_at DESC);
        CREATE TABLE preparation_batch (
          run_id TEXT NOT NULL REFERENCES preparation_run(run_id) ON DELETE CASCADE,
          input_digest TEXT NOT NULL,
          batch_order INTEGER NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'requested', 'uncertain', 'completed')),
          request_key TEXT,
          provider_response_id TEXT,
          response_json TEXT,
          PRIMARY KEY (run_id, input_digest),
          UNIQUE (run_id, batch_order)
        );
        CREATE TABLE preparation_correction (
          subtitle_set_id TEXT NOT NULL REFERENCES subtitle_set(id) ON DELETE CASCADE,
          finding_key TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          corrected_at TEXT NOT NULL,
          PRIMARY KEY (subtitle_set_id, finding_key)
        );
      `);
      database
        .query(
          `INSERT INTO preparation_migration(version, applied_at)
           VALUES (1, ?), (2, ?)`,
        )
        .run(appliedAt, appliedAt);
    });
    apply.immediate();
    return ok(undefined);
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
};

const clean = (value: string): string => value.normalize("NFKC").trim();

const requireText = (
  field: string,
  value: string,
): Result<string, PreparationFailure> => {
  const normalized = clean(value);
  return normalized.length > 0 && normalized.length <= 500
    ? ok(normalized)
    : err({ kind: "invalidCommit", detail: `${field} must be 1–500 characters.` });
};

const hasJapanese = (value: string): boolean =>
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value);

const readSet = (
  database: Database,
  id: SubtitleSetId,
): Result<SubtitleSetSnapshot, PreparationFailure> => {
  try {
    const row = database
      .query(
        "SELECT id, title, source_revision, created_at FROM subtitle_set WHERE id = ?",
      )
      .get(id) as SetRow | null;
    if (row === null) return err({ kind: "subtitleSetNotFound", subtitleSetId: id });
    const episodes = database
      .query(
        `SELECT e.episode_key, e.title, e.episode_order, e.display_name,
                count(c.cue_key) AS cue_count, coalesce(max(c.end_ms), 0) AS duration_ms
         FROM subtitle_episode e
         LEFT JOIN subtitle_cue c
           ON c.subtitle_set_id = e.subtitle_set_id AND c.episode_key = e.episode_key
         WHERE e.subtitle_set_id = ? GROUP BY e.episode_key
         ORDER BY e.episode_order`,
      )
      .all(id) as EpisodeRow[];
    const run = database
      .query(
        `SELECT r.state,
                sum(CASE WHEN b.state = 'completed' THEN 1 ELSE 0 END) AS completed,
                count(b.input_digest) AS total
         FROM preparation_run r
         LEFT JOIN preparation_batch b ON b.run_id = r.run_id
         WHERE r.subtitle_set_id = ?
         GROUP BY r.run_id ORDER BY r.updated_at DESC LIMIT 1`,
      )
      .get(id) as {
      state: SubtitleSetSnapshot["analysis"] extends infer Analysis
        ? Analysis extends { state: infer State }
          ? State
          : never
        : never;
      completed: number;
      total: number;
    } | null;
    return ok({
      id: asSubtitleSetId(row.id),
      title: row.title,
      sourceRevision: row.source_revision,
      createdAt: row.created_at,
      episodes: episodes.map((episode) => ({
        episodeKey: episode.episode_key,
        title: episode.title,
        order: episode.episode_order,
        displayName: episode.display_name,
        cueCount: episode.cue_count,
        durationMs: episode.duration_ms,
      })),
      analysis:
        run === null
          ? null
          : {
              state: run.state,
              completedBatches: run.completed,
              totalBatches: run.total,
            },
    });
  } catch (cause) {
    return err({ kind: "readFailed", detail: detail(cause) });
  }
};

const allCues = (database: Database, id: SubtitleSetId): readonly CueRow[] =>
  database
    .query(
      `SELECT c.episode_key, e.title AS episode_title, e.episode_order,
              c.cue_key, c.cue_order, c.start_ms, c.end_ms,
              c.raw_text, c.normalized_text
       FROM subtitle_cue c
       JOIN subtitle_episode e
         ON e.subtitle_set_id = c.subtitle_set_id AND e.episode_key = c.episode_key
       WHERE c.subtitle_set_id = ?
       ORDER BY e.episode_order, c.cue_order`,
    )
    .all(id) as CueRow[];

const latestRun = (database: Database, id: SubtitleSetId): RunRow | null =>
  database
    .query(
      `SELECT run_id, manifest_json, state, failure_json, merged_json,
              findings_json, study_digest
       FROM preparation_run WHERE subtitle_set_id = ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(id) as RunRow | null;

export const openPreparation = (
  dependencies: PreparationDependencies,
): Result<Preparation, PreparationFailure> => {
  let database: Database;
  try {
    database = new Database(dependencies.databasePath, { create: true, strict: true });
  } catch (cause) {
    return err({ kind: "migrationFailed", detail: detail(cause) });
  }
  const openedAt = safeNow(dependencies.clock);
  if (!openedAt.ok) {
    database.close();
    return openedAt;
  }
  const migrated = migrate(database, openedAt.value.toISOString());
  if (!migrated.ok) {
    database.close();
    return migrated;
  }
  const pendingImports = new Map<string, PendingImport>();
  const preflights = new Map<string, PendingPreflight>();
  const prunePending = (nowMs: number): void => {
    for (const [token, pending] of pendingImports) {
      if (pending.expiresAt < nowMs) pendingImports.delete(token);
    }
    for (const [token, pending] of preflights) {
      if (pending.expiresAt < nowMs) preflights.delete(token);
    }
  };
  const makeRoom = <Value>(values: Map<string, Value>, maximum: number): void => {
    while (values.size >= maximum) {
      const oldest = values.keys().next().value;
      if (oldest === undefined) return;
      values.delete(oldest);
    }
  };
  const batching = createPreparationBatching({
    provider: dependencies.provider,
    store: createSqliteCheckpointStore(database, dependencies.clock),
    normalizationVersion: NORMALIZATION_VERSION,
    analyzerVersion: dependencies.analyzer.name,
  });

  const snapshotFromRun = (
    id: SubtitleSetId,
    run: RunRow,
    comparisonStale = false,
  ): Result<PreparationSnapshot, PreparationFailure> => {
    const set = readSet(database, id);
    if (!set.ok) return set;
    const checkpoints = (
      database
        .query(
          `SELECT input_digest, state, request_key, provider_response_id, response_json
           FROM preparation_batch WHERE run_id = ? ORDER BY batch_order`,
        )
        .all(run.run_id) as {
        input_digest: string;
        state: BatchCheckpoint["state"];
        request_key: string | null;
        provider_response_id: string | null;
        response_json: string | null;
      }[]
    ).map((row): BatchCheckpoint => {
      if (row.state === "pending")
        return { state: "pending", inputDigest: row.input_digest };
      if (row.request_key === null) throw new Error("stored request key missing");
      if (row.state === "requested") {
        return {
          state: "requested",
          inputDigest: row.input_digest,
          requestKey: row.request_key,
        };
      }
      if (row.state === "uncertain") {
        return {
          state: "uncertain",
          inputDigest: row.input_digest,
          requestKey: row.request_key,
          providerResponseId: row.provider_response_id,
        };
      }
      if (row.response_json === null) throw new Error("stored response missing");
      return {
        state: "completed",
        inputDigest: row.input_digest,
        requestKey: row.request_key,
        response: JSON.parse(row.response_json),
      };
    });
    const storedFindings =
      run.findings_json === null
        ? []
        : (JSON.parse(run.findings_json) as readonly StoredFinding[]);
    const findings: readonly PreparationFinding[] = storedFindings.map(
      ({ evidence: _evidence, ...finding }) => finding,
    );
    return ok({
      subtitleSet: set.value,
      runId: run.run_id,
      state: run.state,
      completedBatches: checkpoints.filter((batch) => batch.state === "completed")
        .length,
      totalBatches: checkpoints.length,
      possibleDuplicateCharge: checkpoints.some((batch) => batch.state === "uncertain"),
      failure:
        run.failure_json === null
          ? null
          : (JSON.parse(run.failure_json) as AnalysisRunSnapshot["failure"]),
      usage: providerUsage(checkpoints),
      studyDigest: run.study_digest,
      comparisonStale,
      counts: findingCounts(findings),
      findings,
    });
  };

  const persistProjection = (
    id: SubtitleSetId,
    run: RunRow,
    study: StudyPreparationSnapshot,
  ): Result<PreparationSnapshot, PreparationFailure> => {
    if (run.merged_json === null) return err({ kind: "analysisNotComplete" });
    try {
      const set = readSet(database, id);
      if (!set.ok) return set;
      const manifest = JSON.parse(run.manifest_json) as AnalysisManifest;
      const merged = JSON.parse(run.merged_json) as readonly MergedCandidate[];
      const findings = projectFindings(database, set.value, manifest, merged, study);
      database
        .query(
          `UPDATE preparation_run SET findings_json = ?, study_digest = ?, updated_at = ?
           WHERE run_id = ?`,
        )
        .run(
          JSON.stringify(findings),
          study.digest,
          dependencies.clock().toISOString(),
          run.run_id,
        );
      const refreshed = latestRun(database, id);
      return refreshed === null
        ? err({ kind: "analysisNotComplete" })
        : snapshotFromRun(id, refreshed);
    } catch (cause) {
      return err({ kind: "writeFailed", detail: detail(cause) });
    }
  };

  const getComplete = (
    id: SubtitleSetId,
  ): Result<
    Readonly<{ run: RunRow; snapshot: PreparationSnapshot }>,
    PreparationFailure
  > => {
    const run = latestRun(database, id);
    if (run === null || run.state !== "complete")
      return err({ kind: "analysisNotComplete" });
    const snapshot = snapshotFromRun(id, run);
    return snapshot.ok ? ok({ run, snapshot: snapshot.value }) : snapshot;
  };

  return ok({
    inspectImport: async (input) => {
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      prunePending(now.value.getTime());
      const token = dependencies.nextToken();
      const inspected = await dependencies.inspector.inspect(input, token, now.value);
      if (!inspected.ok) return inspected;
      makeRoom(pendingImports, 8);
      pendingImports.set(token, {
        report: inspected.value.report,
        episodes: inspected.value.episodes,
        expiresAt: new Date(inspected.value.report.expiresAt).getTime(),
      });
      return ok(inspected.value.report);
    },
    commitImport: (command: CommitImport) => {
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      if (command.operationKey.trim() === "" || command.operationKey.length > 200) {
        return err({ kind: "invalidCommit", detail: "operationKey is required." });
      }
      const existing = database
        .query("SELECT id FROM subtitle_set WHERE operation_key = ?")
        .get(command.operationKey) as { id: string } | null;
      if (existing !== null) return readSet(database, asSubtitleSetId(existing.id));
      const pending = pendingImports.get(command.pendingImportToken);
      if (pending === undefined || pending.expiresAt < now.value.getTime()) {
        pendingImports.delete(command.pendingImportToken);
        return err({ kind: "staleImport" });
      }
      const title = requireText("title", command.title);
      if (!title.ok) return title;
      if (command.episodes.length === 0) {
        return err({ kind: "invalidCommit", detail: "Select at least one episode." });
      }
      const byId = new Map(
        pending.episodes.map((episode) => [episode.entryId, episode]),
      );
      const selected: { episode: ParsedEpisode; title: string }[] = [];
      const used = new Set<string>();
      for (const item of command.episodes) {
        const episode = byId.get(item.entryId);
        const episodeTitle = requireText("episode title", item.title);
        if (episode === undefined || used.has(item.entryId) || !episodeTitle.ok) {
          return err({
            kind: "invalidCommit",
            detail: "Episode selection is stale or duplicated.",
          });
        }
        used.add(item.entryId);
        selected.push({ episode, title: episodeTitle.value });
      }
      const sourceRevision = `source-revision-v1:sha256:${sha256(
        JSON.stringify(
          selected.map(({ episode }) => [episode.episodeKey, episode.sourceDigest]),
        ),
      )}`;
      const id = asSubtitleSetId(dependencies.nextId());
      try {
        const insert = database.transaction(() => {
          database
            .query(
              `INSERT INTO subtitle_set(id, operation_key, title, source_revision, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              command.operationKey,
              title.value,
              sourceRevision,
              now.value.toISOString(),
            );
          const addEpisode = database.query(
            `INSERT INTO subtitle_episode(
               subtitle_set_id, episode_key, source_digest, title, episode_order, display_name
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          );
          const addCue = database.query(
            `INSERT INTO subtitle_cue(
               subtitle_set_id, episode_key, cue_key, cue_order, source_label,
               start_ms, end_ms, raw_text, normalized_text
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          selected.forEach(({ episode, title: episodeTitle }, episodeIndex) => {
            addEpisode.run(
              id,
              episode.episodeKey,
              episode.sourceDigest,
              episodeTitle,
              episodeIndex + 1,
              episode.displayName,
            );
            episode.cues.forEach((cue, cueIndex) => {
              addCue.run(
                id,
                episode.episodeKey,
                cue.cueKey,
                cueIndex + 1,
                cue.sourceLabel,
                cue.startMs,
                cue.endMs,
                cue.rawText,
                cue.normalizedText,
              );
            });
          });
        });
        insert.immediate();
        pendingImports.delete(command.pendingImportToken);
        return readSet(database, id);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    listSubtitleSets: () => {
      try {
        const ids = database
          .query("SELECT id FROM subtitle_set ORDER BY created_at, id")
          .all() as { id: string }[];
        const sets: SubtitleSetSnapshot[] = [];
        for (const row of ids) {
          const set = readSet(database, asSubtitleSetId(row.id));
          if (!set.ok) return set;
          sets.push(set.value);
        }
        return ok(sets);
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    getSubtitleSet: (id) => readSet(database, id),
    preflight: async (id, study) => {
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      prunePending(now.value.getTime());
      const set = readSet(database, id);
      if (!set.ok) return set;
      let cues: readonly CueRow[];
      try {
        cues = allCues(database, id);
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
      const analyzed: AnalyzedCue[] = [];
      for (const cue of cues) {
        if (!hasJapanese(cue.normalized_text)) continue;
        const result = await dependencies.analyzer.analyze(
          cue.cue_key,
          cue.normalized_text,
        );
        if (!result.ok) {
          return err({
            kind: "analysisUnavailable",
            detail: `${result.error.kind} for cue ${cue.cue_order}`,
          });
        }
        analyzed.push({
          cueId: cue.cue_key,
          normalizedJapanese: result.value.normalizedText,
          tokens: result.value.tokens.map((token) => ({
            surface: token.surface,
            lemma: token.lemma,
            reading: token.reading,
            partOfSpeech: token.partOfSpeech,
            broadPartOfSpeech: token.broadPartOfSpeech,
            span: token.span,
          })),
          grammarEvidence: dependencies.grammar.detect(result.value.normalizedText),
        });
      }
      if (analyzed.length === 0) return err({ kind: "noJapaneseCues" });
      const baseManifest = await batching.createManifest(
        analyzed,
        dependencies.batchSize,
      );
      const runId = `run-v2:sha256:${sha256(JSON.stringify([id, baseManifest.runId]))}`;
      const manifest: AnalysisManifest = {
        ...baseManifest,
        runId,
        batches: baseManifest.batches.map((batch) => ({ ...batch, runId })),
      };
      const existing = database
        .query(
          `SELECT sum(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS completed
           FROM preparation_batch WHERE run_id = ?`,
        )
        .get(manifest.runId) as { completed: number | null };
      const token = dependencies.nextToken();
      const expiresAt =
        now.value.getTime() + dependencies.importPolicy.pendingImportTtlMs;
      const value: AnalysisPreflight = {
        token,
        subtitleSetId: id,
        sourceRevision: set.value.sourceRevision,
        provider: dependencies.provider.identity,
        providerConfigured: dependencies.providerConfigured(),
        episodeCount: set.value.episodes.length,
        cueCount: cues.length,
        japaneseCueCount: analyzed.length,
        inputBytes: manifest.estimatedInputBytes,
        estimatedRequests: manifest.estimatedRequests,
        completedRequests: existing.completed ?? 0,
        expiresAt: new Date(expiresAt).toISOString(),
        disclosure: [
          "Normalized subtitle text and local token/grammar evidence are sent.",
          "Video, audio, filenames, episode titles, Cards, and review history are not sent.",
          "Gafu requests store=false; the provider's retention policy still applies.",
        ],
      };
      makeRoom(preflights, 8);
      preflights.set(token, { value, manifest, study, expiresAt });
      return ok(value);
    },
    analyze: async (command) => {
      const now = safeNow(dependencies.clock);
      if (!now.ok) return now;
      const pending = preflights.get(command.preflightToken);
      if (pending === undefined || pending.expiresAt < now.value.getTime()) {
        preflights.delete(command.preflightToken);
        return err({ kind: "stalePreflight" });
      }
      if (!dependencies.providerConfigured())
        return err({ kind: "providerNotConfigured" });
      const currentSet = readSet(database, pending.value.subtitleSetId);
      if (!currentSet.ok) return currentSet;
      if (currentSet.value.sourceRevision !== pending.value.sourceRevision) {
        return err({ kind: "stalePreflight" });
      }
      // A preflight is a one-shot capability. Removing it before the first
      // awaited provider call prevents concurrent reuse while a fresh
      // preflight can still resume durable checkpoints after interruption.
      preflights.delete(command.preflightToken);
      try {
        const existing = database
          .query("SELECT run_id FROM preparation_run WHERE run_id = ?")
          .get(pending.manifest.runId);
        if (existing === null) {
          const register = database.transaction(() => {
            database
              .query(
                `INSERT INTO preparation_run(
                   run_id, subtitle_set_id, source_revision, manifest_json, state,
                   failure_json, merged_json, findings_json, study_digest,
                   created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?)`,
              )
              .run(
                pending.manifest.runId,
                pending.value.subtitleSetId,
                pending.value.sourceRevision,
                JSON.stringify(pending.manifest),
                now.value.toISOString(),
                now.value.toISOString(),
              );
            const insertBatch = database.query(
              `INSERT INTO preparation_batch(
                 run_id, input_digest, batch_order, state, request_key, response_json
               ) VALUES (?, ?, ?, 'pending', NULL, NULL)`,
            );
            pending.manifest.batches.forEach((batch, index) => {
              insertBatch.run(pending.manifest.runId, batch.inputDigest, index);
            });
          });
          register.immediate();
        }
        database
          .query(
            "UPDATE preparation_run SET state = 'running', failure_json = NULL, updated_at = ? WHERE run_id = ?",
          )
          .run(now.value.toISOString(), pending.manifest.runId);
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
      const analyzed = await batching.analyze(pending.manifest, {
        ...(command.signal === undefined ? {} : { signal: command.signal }),
        ...(command.retryUncertain === undefined
          ? {}
          : { retryUncertain: command.retryUncertain }),
        ...(command.maxBatches === undefined ? {} : { maxBatches: command.maxBatches }),
      });
      const evidenceValidation =
        analyzed.state === "complete"
          ? validateCompleteEvidence(pending.manifest, analyzed)
          : ok(undefined);
      const finalState: PreparationSnapshot["state"] = !evidenceValidation.ok
        ? "failed"
        : analyzed.state === "incomplete"
          ? "paused"
          : analyzed.state;
      const finalFailure = !evidenceValidation.ok
        ? {
            kind: "invalidCueEvidence" as const,
            detail: evidenceValidation.error.detail,
          }
        : analyzed.failure;
      try {
        const finalize = database.transaction(() => {
          if (!evidenceValidation.ok) {
            // Invalid complete output is safe to charge but not safe to cache:
            // make every affected batch requestable on the next preflight.
            database
              .query(
                `UPDATE preparation_batch
                 SET state = 'pending', request_key = NULL, response_json = NULL
                 WHERE run_id = ?`,
              )
              .run(pending.manifest.runId);
          }
          database
            .query(
              `UPDATE preparation_run
               SET state = ?, failure_json = ?, merged_json = ?, updated_at = ?
               WHERE run_id = ?`,
            )
            .run(
              finalState,
              finalFailure === null ? null : JSON.stringify(finalFailure),
              finalState === "complete" ? JSON.stringify(analyzed.merged) : null,
              dependencies.clock().toISOString(),
              pending.manifest.runId,
            );
        });
        finalize.immediate();
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
      const run = latestRun(database, pending.value.subtitleSetId);
      if (run === null) return err({ kind: "analysisNotComplete" });
      if (finalState === "complete") {
        return persistProjection(pending.value.subtitleSetId, run, pending.study);
      }
      return snapshotFromRun(pending.value.subtitleSetId, run);
    },
    recompare: (id, study) => {
      const complete = getComplete(id);
      return complete.ok ? persistProjection(id, complete.value.run, study) : complete;
    },
    correct: (command: CorrectionCommand) => {
      const complete = getComplete(command.subtitleSetId);
      if (!complete.ok) return complete;
      if (
        command.classification === undefined &&
        command.disposition === undefined &&
        command.knownForSet === undefined &&
        command.meaning === undefined &&
        command.senseId === undefined
      ) {
        return err({
          kind: "invalidCorrection",
          detail: "No correction was supplied.",
        });
      }
      const finding = complete.value.snapshot.findings.find(
        (item) => item.key === command.findingKey,
      );
      if (finding === undefined) {
        return err({ kind: "findingNotFound", findingKey: command.findingKey });
      }
      if (
        command.meaning !== undefined &&
        (clean(command.meaning) === "" || clean(command.meaning).length > 500)
      ) {
        return err({
          kind: "invalidCorrection",
          detail: "Meaning must be 1–500 characters.",
        });
      }
      if (
        command.senseId !== undefined &&
        (clean(command.senseId) === "" || clean(command.senseId).length > 200)
      ) {
        return err({
          kind: "invalidCorrection",
          detail: "Sense ID must be 1–200 characters.",
        });
      }
      try {
        const previous = database
          .query(
            `SELECT payload_json FROM preparation_correction
             WHERE subtitle_set_id = ? AND finding_key = ?`,
          )
          .get(command.subtitleSetId, command.findingKey) as {
          payload_json: string;
        } | null;
        const payload = {
          ...(previous === null ? {} : JSON.parse(previous.payload_json)),
          ...(command.classification === undefined
            ? {}
            : { classification: command.classification }),
          ...(command.disposition === undefined
            ? {}
            : { disposition: command.disposition }),
          ...(command.knownForSet === undefined
            ? {}
            : { knownForSet: command.knownForSet }),
          ...(command.meaning === undefined ? {} : { meaning: clean(command.meaning) }),
          ...(command.senseId === undefined ? {} : { senseId: clean(command.senseId) }),
        };
        database
          .query(
            `INSERT INTO preparation_correction(
               subtitle_set_id, finding_key, payload_json, corrected_at
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(subtitle_set_id, finding_key) DO UPDATE SET
               payload_json = excluded.payload_json,
               corrected_at = excluded.corrected_at`,
          )
          .run(
            command.subtitleSetId,
            command.findingKey,
            JSON.stringify(payload),
            dependencies.clock().toISOString(),
          );
        if (complete.value.run.findings_json === null) {
          return err({ kind: "analysisNotComplete" });
        }
        const storedFindings = JSON.parse(
          complete.value.run.findings_json,
        ) as readonly StoredFinding[];
        const findings = storedFindings.map((item) =>
          item.key !== command.findingKey
            ? item
            : {
                ...item,
                ...(command.classification === undefined
                  ? {}
                  : { classification: command.classification }),
                ...(command.disposition === undefined
                  ? {}
                  : { disposition: command.disposition }),
                ...(command.knownForSet === undefined
                  ? {}
                  : {
                      knownForSet: command.knownForSet,
                      relation: command.knownForSet
                        ? ("known" as const)
                        : item.originalRelation,
                    }),
                ...(command.meaning === undefined
                  ? {}
                  : { meaning: clean(command.meaning) }),
                ...(command.senseId === undefined
                  ? {}
                  : {
                      senseId: clean(command.senseId),
                      resolution: "resolved" as const,
                    }),
                correctedAt: dependencies.clock().toISOString(),
              },
        );
        database
          .query(
            `UPDATE preparation_run
             SET findings_json = ?, study_digest = ?, updated_at = ?
             WHERE run_id = ?`,
          )
          .run(
            JSON.stringify(findings),
            command.meaning === undefined && command.senseId === undefined
              ? complete.value.run.study_digest
              : null,
            dependencies.clock().toISOString(),
            complete.value.run.run_id,
          );
        const run = latestRun(database, command.subtitleSetId);
        return run === null
          ? err({ kind: "analysisNotComplete" })
          : snapshotFromRun(
              command.subtitleSetId,
              run,
              command.meaning !== undefined || command.senseId !== undefined,
            );
      } catch (cause) {
        return err({ kind: "writeFailed", detail: detail(cause) });
      }
    },
    evidence: (query) => {
      if (
        !Number.isSafeInteger(query.offset) ||
        query.offset < 0 ||
        !Number.isSafeInteger(query.limit) ||
        query.limit < 1 ||
        query.limit > 100
      ) {
        return err({
          kind: "invalidCorrection",
          detail: "Evidence page must use offset >= 0 and limit 1–100.",
        });
      }
      const complete = getComplete(query.subtitleSetId);
      if (!complete.ok) return complete;
      if (complete.value.run.findings_json === null) {
        return err({ kind: "analysisNotComplete" });
      }
      const finding = (
        JSON.parse(complete.value.run.findings_json) as readonly StoredFinding[]
      ).find((item) => item.key === query.findingKey);
      return finding === undefined
        ? err({ kind: "findingNotFound", findingKey: query.findingKey })
        : ok({
            total: finding.evidence.length,
            offset: query.offset,
            items: finding.evidence.slice(query.offset, query.offset + query.limit),
          });
    },
    planDraft: (id) => {
      const complete = getComplete(id);
      if (!complete.ok) return complete;
      if (
        complete.value.run.findings_json === null ||
        complete.value.run.study_digest === null
      ) {
        return err({ kind: "analysisNotComplete" });
      }
      try {
        const findings = JSON.parse(
          complete.value.run.findings_json,
        ) as readonly StoredFinding[];
        const draft = projectPlanDraft({
          set: complete.value.snapshot.subtitleSet,
          runId: complete.value.run.run_id,
          studyDigest: complete.value.run.study_digest,
          findings,
        });
        return draft.items.length === 0 && draft.blockers.length === 0
          ? err({ kind: "planDraftEmpty" })
          : ok(draft);
      } catch (cause) {
        return err({ kind: "readFailed", detail: detail(cause) });
      }
    },
    deleteSubtitleSet: (id, confirmation) => {
      if (confirmation !== "delete") {
        return err({
          kind: "invalidCommit",
          detail: "Deletion requires explicit confirmation.",
        });
      }
      try {
        const result = database.query("DELETE FROM subtitle_set WHERE id = ?").run(id);
        return result.changes >= 1
          ? ok(undefined)
          : err({ kind: "subtitleSetNotFound", subtitleSetId: id });
      } catch (cause) {
        return err({ kind: "deleteFailed", detail: detail(cause) });
      }
    },
    close: () => database.close(),
  });
};
