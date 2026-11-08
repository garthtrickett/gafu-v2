import { err, ok, type Result } from "../result.ts";
import type { CardId, Study } from "../study/contracts.ts";
import { selectDueBatch, wantsTeaching } from "../study/session-split.ts";
import { currentMaterial } from "./current-material.ts";
import type {
  LearningMaterial,
  MaterialFailure,
  PrepareMaterial,
} from "./generated-contracts.ts";

type Origin = "manual" | "whileOpen" | "server";
type Failure = MaterialFailure | { kind: "studyUnavailable" };
type Options = {
  study: Study;
  material: LearningMaterial;
  clock: () => Date;
  automaticAllowed: () => boolean;
  dispatchAllowed?: () => boolean;
  pollMs?: number;
  idleMs?: number;
};
export function createReviewPreparation(o: Options) {
  const { study, material } = o;
  let started = false,
    stopping = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    audioTimer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | null = null,
    audioRunning: Promise<void> | null = null;
  const controller = new AbortController();
  let lastCheck: string | null = null,
    nextCheck: string | null = null,
    lastError: string | null = null;
  const current = (input: PrepareMaterial) => {
    if (stopping || controller.signal.aborted) return false;
    return currentMaterial(study, input, o.clock());
  };
  const snapshot = () => {
    const queue = study.duePreparationSnapshot(),
      knowledge = study.knowledgeSnapshot(),
      flags = material.teachingFlags();
    if (!queue.ok || !knowledge.ok || !flags.ok)
      return err({ kind: "studyUnavailable" } as const);
    const inputs = queue.value.due.map((item) => {
      const input: PrepareMaterial = {
        card: item.card,
        knowledge: knowledge.value,
        signal: controller.signal,
        isCurrent: () => current(input),
      };
      return input;
    });
    const byCard = new Map(inputs.map((i) => [i.card.id, i]));
    const due = {
      review: queue.value.due.filter(
        (x) => !wantsTeaching(x.card, flags.value.taught.has(x.card.id)),
      ),
      untaught: queue.value.due.filter((x) =>
        wantsTeaching(x.card, flags.value.taught.has(x.card.id)),
      ),
    };
    return ok({ inputs, byCard, due });
  };
  const request = async (
    origin: Origin,
    size = 20,
    excluded: ReadonlySet<string> = new Set(),
    focusCardId?: CardId,
  ): Promise<Result<{ batchId: string; total: number }, Failure>> => {
    const preferences = study.preferences();
    if (!preferences.ok) return err({ kind: "studyUnavailable" });
    if (
      origin !== "manual" &&
      (!o.automaticAllowed() || preferences.value.automaticPreparation === "off")
    )
      return err({ kind: "cancelled", detail: "Automatic preparation is disabled" });
    const active = material.pendingReviewBatch();
    if (!active.ok) return active;
    if (active.value && focusCardId === undefined) {
      if (origin === "manual") material.promoteReviewBatch(active.value.batchId);
      wake();
      return ok(active.value);
    }
    const scope = snapshot();
    if (!scope.ok) return scope;
    // Avoid per-Card work on idle ticks. Only existing, non-current reserves need local validation.
    const currentFlags = material.reserveFlags(scope.value.inputs),
      storedFlags = material.reserveFlags();
    if (!currentFlags.ok) return currentFlags;
    if (!storedFlags.ok) return storedFlags;
    const teaching = new Set(scope.value.due.untaught.map((item) => item.card.id));
    for (const input of scope.value.inputs) {
      const mode = teaching.has(input.card.id) ? "teach" : "review";
      if (
        currentFlags.value[mode].has(input.card.id) ||
        !storedFlags.value[mode].has(input.card.id)
      )
        continue;
      const checked = await material.checkReserves(input);
      if (!checked.ok && checked.error.kind !== "presentationNotFound") return checked;
    }
    const reserves = material.reserveFlags(scope.value.inputs);
    if (!reserves.ok) return reserves;
    const blocked = material.backgroundRetryBlockedCards();
    if (!blocked.ok) return blocked;
    const uncertain = material.preparationState();
    if (!uncertain.ok) return uncertain;
    const skip = new Set([
      ...excluded,
      ...uncertain.value.uncertainCardIds,
      ...(origin === "manual" ? [] : blocked.value),
    ]);
    if (focusCardId && uncertain.value.uncertainCardIds.includes(focusCardId))
      return err({ kind: "dispatchUncertain" });
    const focus = focusCardId
      ? scope.value.due.review
          .concat(scope.value.due.untaught)
          .find((item) => item.card.id === focusCardId)
      : undefined;
    if (focusCardId && !focus) return err({ kind: "presentationNotFound" });
    if (focus) {
      for (const id of uncertain.value.activeCardIds) skip.add(id);
      skip.add(focus.card.id);
    }
    const selected = [
      ...(focus ? [focus] : []),
      ...selectDueBatch(
        scope.value.due,
        size - (focus ? 1 : 0),
        origin === "manual" && !focus ? undefined : reserves.value,
        skip,
      ),
    ];
    if (!selected.length) return err({ kind: "noValidCandidate" });
    const inputs = selected
      .map((x) => scope.value.byCard.get(x.card.id))
      .filter((x): x is PrepareMaterial => x !== undefined && current(x));
    if (!inputs.length) return err({ kind: "noValidCandidate" });
    const begun = material.beginReviewBatch(inputs, {
      origin,
      ...(focusCardId ? { queue: true, focusCardId } : {}),
    });
    if (!begun.ok) return begun;
    wake();
    const joined = material.reviewBatchProgress(begun.value);
    return joined.ok
      ? ok({
          batchId: begun.value,
          total:
            joined.value.pending +
            joined.value.completed.length +
            joined.value.failed.length,
        })
      : joined;
  };
  const tickBody = async () => {
    lastCheck = o.clock().toISOString();
    lastError = null;
    const contexts = new Map<string, ReturnType<Study["materialContext"]>>();
    const reconciled = material.reconcilePreparation((card) => {
      let current = contexts.get(card.id);
      if (!current) {
        current = study.materialContext(card.id);
        contexts.set(card.id, current);
      }
      if (!current.ok) return current.error.kind === "cardNotFound";
      const now = current.value.card;
      return (
        now.state !== "active" ||
        (typeof card.materialRevision === "number" &&
          card.materialRevision !== now.materialRevision) ||
        now.reviewCount > card.reviewCount ||
        now.schedulePhase !== card.schedulePhase ||
        JSON.stringify(now.content) !== JSON.stringify(card.content)
      );
    });
    if (!reconciled.ok) {
      lastError = reconciled.error.kind;
      return;
    }
    const pending = material.pendingReviewBatch();
    if (!pending.ok) {
      lastError = pending.error.kind;
      return;
    }
    if (pending.value) {
      const execution = material.batchExecution(pending.value.batchId),
        preferences = study.preferences();
      if (!execution.ok || !preferences.ok) {
        lastError = "readFailed";
        return;
      }
      if (execution.value.retryAt && execution.value.retryAt > lastCheck) return;
      const allowDispatch =
        o.dispatchAllowed?.() !== false &&
        (execution.value.origin === "manual" ||
          (o.automaticAllowed() && preferences.value.automaticPreparation !== "off"));
      const advanced = await material.advanceReviewBatch(pending.value.batchId, {
        allowDispatch,
        isCurrent: current,
        signal: controller.signal,
      });
      if (!advanced.ok) {
        lastError = advanced.error.kind;
        return;
      }
    }
    if (stopping) return;
    const preferences = study.preferences();
    if (
      preferences.ok &&
      preferences.value.automaticPreparation === "server" &&
      o.automaticAllowed()
    ) {
      const active = material.pendingReviewBatch();
      if (active.ok && active.value === null) {
        const queued = await request("server");
        if (!queued.ok && queued.error.kind !== "noValidCandidate")
          lastError = queued.error.kind;
      }
    }
    material.purgeFinishedBatches(60 * 60_000);
  };
  const tick = () => {
    if (running) return running;
    const task = tickBody()
      .catch(() => {
        lastError = "writeFailed";
      })
      .finally(() => {
        if (running === task) running = null;
      });
    running = task;
    return task;
  };
  const schedule = () => {
    if (!started || stopping || timer) return;
    const active = material.pendingReviewBatch();
    const delay = active.ok && active.value ? (o.pollMs ?? 2000) : (o.idleMs ?? 60000);
    nextCheck = new Date(o.clock().getTime() + delay).toISOString();
    timer = setTimeout(() => {
      timer = undefined;
      void tick().finally(schedule);
    }, delay);
  };
  function wake() {
    if (!started || stopping) return;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    void tick().finally(schedule);
  }
  const audioLoop = () => {
    if (!started || stopping) return;
    const task = (
      o.dispatchAllowed?.() === false
        ? Promise.resolve()
        : material.advanceSpeech(
            controller.signal,
            o.automaticAllowed() &&
              study.preferences().ok &&
              (() => {
                const p = study.preferences();
                return p.ok && p.value.automaticPreparation !== "off";
              })(),
          )
    )
      .catch(() => {})
      .finally(() => {
        if (audioRunning === task) audioRunning = null;
        if (!stopping) audioTimer = setTimeout(audioLoop, 1000);
      });
    audioRunning = task;
  };
  const status = () => {
    const scope = snapshot(),
      preferences = study.preferences(),
      state = material.preparationState();
    if (!scope.ok || !preferences.ok || !state.ok)
      return err({ kind: "studyUnavailable" } as const);
    const flags = material.reserveFlags(scope.value.inputs);
    if (!flags.ok) return flags;
    const blocked = material.backgroundRetryBlockedCards();
    if (!blocked.ok) return blocked;
    const readyCardIds: CardId[] = [],
      blockedIds = new Set([...blocked.value, ...state.value.uncertainCardIds]);
    let preparing = 0,
      failed = 0,
      waiting = 0;
    const activeIds = new Set(state.value.activeCardIds);
    const untaught = new Set(scope.value.due.untaught.map((x) => x.card.id));
    for (const item of [...scope.value.due.review, ...scope.value.due.untaught]) {
      const mode = untaught.has(item.card.id) ? "teach" : "review";
      if (flags.value[mode].has(item.card.id)) readyCardIds.push(item.card.id);
      else if (blockedIds.has(item.card.id)) failed++;
      else if (activeIds.has(item.card.id)) preparing++;
      else waiting++;
    }
    return ok({
      mode: preferences.value.automaticPreparation,
      enabled: o.automaticAllowed(),
      ready: readyCardIds.length,
      preparing,
      waiting,
      blocked: failed,
      readyCardIds,
      blockedReason: state.value.blockedReason,
      uncertainBatches: state.value.uncertainBatches,
      lastCheck,
      nextCheck,
      lastError,
    });
  };
  return {
    request,
    requestCard: (cardId: CardId) => request("manual", 20, new Set(), cardId),
    tick,
    wake,
    status,
    start: () => {
      if (started) return;
      started = true;
      wake();
      audioLoop();
    },
    stop: async () => {
      stopping = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      if (audioTimer) clearTimeout(audioTimer);
      await Promise.allSettled([running, audioRunning]);
    },
  };
}
export type ReviewPreparation = ReturnType<typeof createReviewPreparation>;
