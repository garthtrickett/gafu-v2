import type { Database } from "bun:sqlite";
import type { PreparedMaterial } from "./generated-contracts.ts";
import type { SpeechProvider } from "./speech-contracts.ts";

type Options = {
  database: Database;
  clock: () => Date;
  provider: SpeechProvider | undefined;
  enabled: () => boolean;
  dailyLimit: number;
  currentAutomatic?: (presentationId: string) => boolean;
};
/** One durable attempt per exact presentation/voice. Text never waits for the audio worker. */
export function createMaterialSpeech(o: Options) {
  const db = o.database;
  const identity = () => (o.provider ? JSON.stringify(o.provider.identity) : null);
  const audioUrl = (id: string) =>
    `/api/study/presentations/${encodeURIComponent(id)}/audio`;
  const hasCurrent = (id: string) => {
    if (!o.provider) return false;
    const row = db
      .query(
        "SELECT provider,model,voice,synthesis_version FROM presentation_audio WHERE presentation_id=?",
      )
      .get(id) as {
      provider: string;
      model: string;
      voice: string;
      synthesis_version: number;
    } | null;
    const x = o.provider.identity;
    return (
      !!row &&
      row.provider === x.provider &&
      row.model === x.model &&
      row.voice === x.voice &&
      row.synthesis_version === x.synthesisVersion
    );
  };
  db.query(
    "UPDATE material_speech_job SET state='uncertain' WHERE state='dispatching'",
  ).run();
  const enqueue = (
    id: string,
    japanese: string,
    automatic = false,
    foreground = false,
  ) => {
    const voice = identity();
    if (!voice || !o.enabled() || hasCurrent(id)) return;
    db.query(
      "INSERT INTO material_speech_job(presentation_id,voice_identity,japanese,state,updated_at,automatic,priority) VALUES (?,?,?,'queued',?,?,?) ON CONFLICT(presentation_id,voice_identity) DO UPDATE SET automatic=CASE WHEN excluded.automatic=0 THEN 0 ELSE material_speech_job.automatic END,priority=max(material_speech_job.priority,excluded.priority)",
    ).run(
      id,
      voice,
      japanese,
      o.clock().toISOString(),
      automatic ? 1 : 0,
      foreground ? 1 : 0,
    );
  };
  let active: Promise<void> | null = null;
  const run = async (signal?: AbortSignal, allowAutomatic = true) => {
    if (!o.enabled() || !o.provider || signal?.aborted) return;
    const voice = identity();
    const item = db
      .query(
        "SELECT presentation_id,japanese,automatic FROM material_speech_job WHERE state='queued' AND voice_identity=? AND (automatic=0 OR ?=1) ORDER BY priority DESC,updated_at,presentation_id LIMIT 1",
      )
      .get(voice, allowAutomatic ? 1 : 0) as {
      presentation_id: string;
      japanese: string;
      automatic: number;
    } | null;
    if (!item) return;
    if (item.automatic === 1 && o.currentAutomatic?.(item.presentation_id) === false) {
      db.query(
        "UPDATE material_speech_job SET state='failed' WHERE presentation_id=? AND voice_identity=?",
      ).run(item.presentation_id, voice);
      return;
    }
    if (hasCurrent(item.presentation_id)) {
      db.query(
        "UPDATE material_speech_job SET state='ready' WHERE presentation_id=? AND voice_identity=?",
      ).run(item.presentation_id, voice);
      return;
    }
    const now = o.clock(),
      at = now.toISOString(),
      day = at.slice(0, 10);
    const granted = db.transaction(() => {
      if (o.dailyLimit < 1) return false;
      const used = db
        .query("SELECT attempted_count FROM speech_daily_usage WHERE usage_date=?")
        .get(day) as { attempted_count: number } | null;
      if ((used?.attempted_count ?? 0) >= o.dailyLimit) return false;
      db.query(
        "INSERT INTO speech_daily_usage VALUES (?,1,?) ON CONFLICT(usage_date) DO UPDATE SET attempted_count=attempted_count+1,updated_at=excluded.updated_at",
      ).run(day, at);
      db.query(
        "UPDATE material_speech_job SET state='dispatching',updated_at=? WHERE presentation_id=? AND voice_identity=?",
      ).run(at, item.presentation_id, voice);
      return true;
    })();
    if (!granted) return;
    try {
      const result = await o.provider.synthesize(item.japanese, signal);
      if (result.ok) {
        db.transaction(() => {
          const x = o.provider?.identity;
          if (!x) return;
          db.query(
            "INSERT INTO presentation_audio(presentation_id,content_type,bytes,provider,model,voice,synthesis_version,generated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(presentation_id) DO UPDATE SET content_type=excluded.content_type,bytes=excluded.bytes,provider=excluded.provider,model=excluded.model,voice=excluded.voice,synthesis_version=excluded.synthesis_version,generated_at=excluded.generated_at",
          ).run(
            item.presentation_id,
            result.value.contentType,
            result.value.bytes,
            x.provider,
            x.model,
            x.voice,
            x.synthesisVersion,
            at,
          );
          db.query(
            "UPDATE material_speech_job SET state='ready',updated_at=? WHERE presentation_id=? AND voice_identity=?",
          ).run(at, item.presentation_id, voice);
        })();
      } else
        db.query(
          "UPDATE material_speech_job SET state=?,updated_at=? WHERE presentation_id=? AND voice_identity=?",
        ).run(
          ["offline", "timeout", "cancelled", "dispatchUncertain"].includes(
            result.error.kind,
          )
            ? "uncertain"
            : "failed",
          at,
          item.presentation_id,
          voice,
        );
    } catch {
      db.query(
        "UPDATE material_speech_job SET state='uncertain',updated_at=? WHERE presentation_id=? AND voice_identity=?",
      ).run(at, item.presentation_id, voice);
    }
  };
  return {
    hasCurrent,
    enqueue,
    status: (id: string) => {
      if (!o.enabled() || !o.provider)
        return { state: "disabled" as const, audioUrl: null };
      if (hasCurrent(id)) return { state: "ready" as const, audioUrl: audioUrl(id) };
      const row = db
        .query(
          "SELECT state FROM material_speech_job WHERE presentation_id=? AND voice_identity=?",
        )
        .get(id, identity()) as { state: string } | null;
      return { state: row?.state ?? "unavailable", audioUrl: null };
    },
    retry: (id: string, confirmUncertain: boolean) => {
      if (!o.enabled() || !o.provider) return false;
      const row = db
        .query(
          "SELECT state FROM material_speech_job WHERE presentation_id=? AND voice_identity=?",
        )
        .get(id, identity()) as { state: string } | null;
      if (
        !row ||
        (row.state !== "failed" && row.state !== "uncertain") ||
        (row.state === "uncertain" && !confirmUncertain)
      )
        return false;
      db.query(
        "UPDATE material_speech_job SET state='queued',automatic=0,priority=1,updated_at=? WHERE presentation_id=? AND voice_identity=?",
      ).run(o.clock().toISOString(), id, identity());
      return true;
    },
    tick: (signal?: AbortSignal, allowAutomatic = true) => {
      if (active) return active;
      const task = run(signal, allowAutomatic).finally(() => {
        if (active === task) active = null;
      });
      active = task;
      return task;
    },
    attach: (prepared: PreparedMaterial): PreparedMaterial => {
      if (!o.enabled() || !o.provider) return { ...prepared, audioUrl: null };
      enqueue(prepared.id, prepared.material.japanese, false, true);
      return {
        ...prepared,
        audioUrl: hasCurrent(prepared.id) ? audioUrl(prepared.id) : null,
        audioPending:
          !hasCurrent(prepared.id) &&
          !!db
            .query(
              "SELECT 1 FROM material_speech_job WHERE presentation_id=? AND voice_identity=? AND state IN ('queued','dispatching')",
            )
            .get(prepared.id, identity()),
      };
    },
  };
}
