import { html } from "lit-html";
export type PreparationStatus = {
  mode: "off" | "whileOpen" | "server";
  enabled: boolean;
  ready: number;
  preparing: number;
  waiting: number;
  blocked: number;
  readyCardIds: readonly string[];
  blockedReason: string | null;
  uncertainBatches: readonly string[];
  lastError: string | null;
  restorePaused: boolean;
};
type Options = {
  read: () => Promise<PreparationStatus>;
  recover: (body: unknown) => Promise<unknown>;
  resume: () => Promise<unknown>;
  changed: () => void;
};
/** Read-only progress with explicit recovery actions for spending ambiguity. */
export function createPreparationStatus(o: Options) {
  let current: PreparationStatus | null = null;
  const refresh = async () => {
    try {
      current = await o.read();
    } catch {
      /* Existing study and offline material remain available. */
    }
  };
  const recover = async (batchId: string, abandonKnownRequest = false) => {
    if (
      !window.confirm(
        abandonKnownRequest
          ? "Abandon the saved provider request and buy a new one? The original may already have been charged, so this can incur duplicate cost."
          : "Try retrieving the saved request first? If its ID was lost, a new request may incur a duplicate charge. Continue with that possible cost?",
      )
    )
      return;
    await o.recover({
      batchId,
      confirmDuplicateCost: true,
      confirmProviderChange: true,
      confirmAbandonKnownRequest: abandonKnownRequest,
    });
    await refresh();
    o.changed();
  };
  const resume = async () => {
    if (
      !window.confirm(
        "Resume preparation using the current provider configuration? Saved requests with uncertain spending remain blocked for individual recovery.",
      )
    )
      return;
    await o.resume();
    await refresh();
    o.changed();
  };
  return {
    refresh,
    get: () => current,
    view: () =>
      current === null
        ? ""
        : html`<div class="preparation-status" data-testid="preparation-status" aria-live="polite">
  <p>${current.ready} ready · ${current.preparing} preparing · ${current.waiting} waiting${current.blocked ? ` · ${current.blocked} blocked` : ""}</p>
  ${current.restorePaused ? html`<p>Automatic preparation is paused after restoring data. Saved requests must be reconciled before new spending.</p><button class="secondary" @click=${() => void resume().catch(() => {})}>Reconcile and resume preparation</button>` : ""}
  ${current.blockedReason ? html`<p>Preparation paused: ${current.blockedReason}. ${current.blockedReason === "rateLimit" ? "Waiting for the provider retry time." : "Check the provider configuration, then resume."}</p>${current.blockedReason === "rateLimit" ? "" : html`<button class="secondary" @click=${() => void resume().catch(() => {})}>Resume preparation</button>`}` : ""}
  ${current.uncertainBatches.map((id) => html`<p>A request needs recovery; it will not be bought again automatically. <button class="secondary" @click=${() => void recover(id).catch(() => {})}>Recover request</button> <button class="secondary" @click=${() => void recover(id, true).catch(() => {})}>Abandon saved request and buy again</button></p>`)}
  ${current.lastError ? html`<p>Last preparation check: ${current.lastError}. Due Cards stay due.</p>` : ""}
 </div>`,
  };
}
