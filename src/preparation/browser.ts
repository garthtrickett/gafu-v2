import { html, render, type TemplateResult } from "lit-html";
import { mutationHeaders } from "../local-api.ts";
import type {
  PlanDraft,
  PlanSnapshot,
  PlanSummary,
} from "../preparation-plan-contracts.ts";
import type {
  AnalysisPreflight,
  EvidencePage,
  FindingClassification,
  FindingRelation,
  PreparationFinding,
  PreparationSnapshot,
} from "./contracts.ts";
import type {
  ImportEntryReport,
  ImportReport,
  SubtitleSetSnapshot,
} from "./import-contracts.ts";

type DraftEpisode = Readonly<{
  entryId: string;
  title: string;
  displayName: string;
  cueCount: number;
}>;

type Model = {
  sets: readonly SubtitleSetSnapshot[];
  plans: readonly PlanSummary[];
  report: ImportReport | null;
  draftEpisodes: DraftEpisode[];
  currentSet: SubtitleSetSnapshot | null;
  preflight: AnalysisPreflight | null;
  result: PreparationSnapshot | null;
  draft: PlanDraft | null;
  plan: PlanSnapshot | null;
  evidence: EvidencePage | null;
  evidenceFor: string | null;
  relation: "all" | FindingRelation;
  classification: "all" | "useful" | FindingClassification;
  findingType: "all" | PreparationFinding["type"];
  disposition: "all" | PreparationFinding["disposition"];
  query: string;
  busy: boolean;
  message: string;
  messageKind: "neutral" | "success" | "error";
  progress: { completed: number; total: number } | null;
  stopAnalysis: boolean;
};

const requestJson = async <Value>(url: string, init?: RequestInit): Promise<Value> => {
  const response = await fetch(url, {
    ...init,
    headers: mutationHeaders(init?.headers),
  });
  const value = (await response.json()) as
    | Value
    | { error?: { kind?: string; detail?: string } };
  if (!response.ok) {
    const failure =
      "error" in (value as object)
        ? (value as { error?: { kind?: string; detail?: string } }).error
        : undefined;
    throw new Error(
      failure?.detail ?? failure?.kind ?? `requestFailed:${response.status}`,
    );
  }
  return value as Value;
};

const jsonRequest = (method: string, value?: unknown): RequestInit => ({
  method,
  ...(value === undefined
    ? {}
    : {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      }),
});

const acceptedEpisodes = (report: ImportReport): DraftEpisode[] =>
  report.entries.flatMap((entry) =>
    entry.outcome === "accepted"
      ? [
          {
            entryId: entry.entryId,
            title: entry.inferredTitle,
            displayName: entry.displayName,
            cueCount: entry.cueCount,
          },
        ]
      : [],
  );

const rejectionCopy = (entry: ImportEntryReport): string =>
  entry.outcome === "accepted"
    ? "accepted"
    : entry.outcome === "duplicate"
      ? `duplicate · ${entry.detail}`
      : `${entry.reason} · ${entry.detail}`;

const findingTitle = (finding: PreparationFinding): string =>
  finding.type === "vocabulary"
    ? `${finding.lemma ?? finding.canonicalKey}${finding.reading === null ? "" : `【${finding.reading}】`}`
    : finding.canonicalKey;

export const mountPreparationApp = (root: HTMLElement): void => {
  const model: Model = {
    sets: [],
    plans: [],
    report: null,
    draftEpisodes: [],
    currentSet: null,
    preflight: null,
    result: null,
    draft: null,
    plan: null,
    evidence: null,
    evidenceFor: null,
    relation: "missing",
    classification: "useful",
    findingType: "all",
    disposition: "include",
    query: "",
    busy: true,
    message: "Loading Subtitle Sets…",
    messageKind: "neutral",
    progress: null,
    stopAnalysis: false,
  };

  const refreshLists = async (): Promise<void> => {
    const [sets, plans] = await Promise.all([
      requestJson<readonly SubtitleSetSnapshot[]>("/api/preparation"),
      requestJson<readonly PlanSummary[]>("/api/study/plans"),
    ]);
    model.sets = sets;
    model.plans = plans;
  };

  let operationVersion = 0;
  const run = async (
    operation: (isCurrent: () => boolean) => Promise<string>,
  ): Promise<void> => {
    const version = ++operationVersion;
    const isCurrent = () => version === operationVersion;
    model.busy = true;
    draw();
    try {
      const message = await operation(isCurrent);
      if (!isCurrent()) return;
      model.message = message;
      model.messageKind = "success";
    } catch (cause) {
      if (!isCurrent()) return;
      model.message = cause instanceof Error ? cause.message : String(cause);
      model.messageKind = "error";
    } finally {
      if (isCurrent()) {
        model.busy = false;
        draw();
      }
    }
  };

  const inspect = (event: SubmitEvent): void => {
    event.preventDefault();
    if (model.busy) return;
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("files") as HTMLInputElement | null;
    const files = [...(input?.files ?? [])];
    void run(async () => {
      const body = new FormData();
      for (const file of files) body.append("files", file);
      model.report = await requestJson<ImportReport>("/api/preparation/import", {
        method: "POST",
        body,
      });
      model.draftEpisodes = acceptedEpisodes(model.report);
      model.currentSet = null;
      model.preflight = null;
      model.result = null;
      model.draft = null;
      model.plan = null;
      return `${model.report.acceptedCount} accepted, ${model.report.rejectedCount} rejected, ${model.report.duplicateCount} duplicate.`;
    });
  };

  const move = (index: number, direction: -1 | 1): void => {
    if (model.busy) return;
    const target = index + direction;
    if (target < 0 || target >= model.draftEpisodes.length) return;
    const next = [...model.draftEpisodes];
    const current = next[index];
    const other = next[target];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[target] = current;
    model.draftEpisodes = next;
    draw();
  };

  const removeDraft = (entryId: string): void => {
    if (model.busy) return;
    model.draftEpisodes = model.draftEpisodes.filter(
      (item) => item.entryId !== entryId,
    );
    draw();
  };

  const renameDraft = (entryId: string, title: string): void => {
    if (model.busy) return;
    model.draftEpisodes = model.draftEpisodes.map((item) =>
      item.entryId === entryId ? { ...item, title } : item,
    );
  };

  const commit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (model.busy) return;
    const report = model.report;
    if (report === null) return;
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    void run(async () => {
      model.currentSet = await requestJson<SubtitleSetSnapshot>(
        "/api/preparation/commit",
        jsonRequest("POST", {
          pendingImportToken: report.pendingImportToken,
          operationKey: crypto.randomUUID(),
          title: String(fields.get("setTitle") ?? ""),
          episodes: model.draftEpisodes.map(({ entryId, title }) => ({
            entryId,
            title,
          })),
        }),
      );
      model.report = null;
      model.draftEpisodes = [];
      await refreshLists();
      return "Subtitle Set saved locally. No provider request has been made.";
    });
  };

  const openSet = (set: SubtitleSetSnapshot): void => {
    if (model.busy) return;
    void run(async (isCurrent) => {
      const result =
        set.analysis?.state === "complete"
          ? await requestJson<PreparationSnapshot>(
              `/api/preparation/sets/${encodeURIComponent(set.id)}/recompare`,
              jsonRequest("POST"),
            )
          : null;
      const plans = await requestJson<readonly PlanSummary[]>("/api/study/plans");
      const matchingPlan = plans.find((plan) => plan.sourceKey === set.id);
      const plan =
        matchingPlan === undefined
          ? null
          : await requestJson<PlanSnapshot>(
              `/api/study/plans/${encodeURIComponent(matchingPlan.id)}`,
            );
      if (!isCurrent()) return "";
      model.currentSet = set;
      model.report = null;
      model.preflight = null;
      model.evidence = null;
      model.draft = null;
      model.result = result;
      model.plans = plans;
      model.plan = plan;
      return result === null
        ? "Subtitle Set opened. Review the scope before analysis."
        : "Saved analysis opened and re-compared locally with current Study state.";
    });
  };

  const openPlan = (summary: PlanSummary): void => {
    if (model.busy) return;
    void run(async (isCurrent) => {
      const plan = await requestJson<PlanSnapshot>(
        `/api/study/plans/${encodeURIComponent(summary.id)}`,
      );
      if (!isCurrent()) return "";
      model.plan = plan;
      model.draft = null;
      model.currentSet = model.sets.find((set) => set.id === summary.sourceKey) ?? null;
      model.result = null;
      model.preflight = null;
      return "Preparation Plan opened. Its controls remain available without source media.";
    });
  };

  const preflight = (): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (set === null) return;
    void run(async () => {
      model.preflight = await requestJson<AnalysisPreflight>(
        `/api/preparation/sets/${encodeURIComponent(set.id)}/preflight`,
        jsonRequest("POST"),
      );
      return "Analysis scope calculated locally. Nothing was sent yet.";
    });
  };

  // One analyze call covers this many batches, then checkpoints and
  // reports back. Twenty keeps each round trip to a few paid requests while
  // completed checkpoints make every chunk resumable without repaying.
  const ANALYSIS_CHUNK_BATCHES = 20;

  const stopAnalysis = (): void => {
    model.stopAnalysis = true;
    draw();
  };

  const analyze = (retryUncertain = false): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (set === null) return;
    model.stopAnalysis = false;
    model.progress = null;
    const url = `/api/preparation/sets/${encodeURIComponent(set.id)}`;
    void run(async (isCurrent) => {
      let total = 0;
      let completed = 0;
      for (;;) {
        if (model.stopAnalysis) {
          model.progress = null;
          return `Analysis stopped at ${completed} of ${total} batches. Finished batches are saved; Analyze resumes without repaying them.`;
        }
        const fresh = await requestJson<AnalysisPreflight>(
          `${url}/preflight`,
          jsonRequest("POST"),
        );
        if (!isCurrent()) return "Analysis superseded.";
        model.preflight = fresh;
        const result = await requestJson<PreparationSnapshot>(
          `${url}/analyze`,
          jsonRequest("POST", {
            preflightToken: fresh.token,
            retryUncertain,
            maxBatches: ANALYSIS_CHUNK_BATCHES,
          }),
        );
        if (!isCurrent()) return "Analysis superseded.";
        model.result = result;
        completed = result.completedBatches;
        total = result.totalBatches;
        model.progress = { completed, total };
        draw();
        if (result.state === "complete") {
          model.progress = null;
          model.draft = null;
          await refreshLists();
          return `Preparation Gap complete: ${result.counts.gap} missing, ${result.counts.existing} already in Study, ${result.counts.known} known.`;
        }
        if (result.state === "failed") {
          model.progress = null;
          model.draft = null;
          await refreshLists();
          return `Analysis failed: ${result.failure?.kind ?? "unknown"}. Finished batches are saved; fix the cause and Analyze resumes them.`;
        }
        // paused or incomplete: loop with a fresh preflight, which resumes
        // the durable checkpoints left by this chunk.
      }
    });
  };

  const correct = (finding: PreparationFinding, change: object): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (set === null) return;
    void run(async () => {
      model.result = await requestJson<PreparationSnapshot>(
        "/api/preparation/corrections",
        jsonRequest("POST", {
          subtitleSetId: set.id,
          findingKey: finding.key,
          ...change,
        }),
      );
      model.draft = null;
      return "Correction saved as a non-destructive overlay.";
    });
  };

  const correctIdentity = (event: SubmitEvent, finding: PreparationFinding): void => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    correct(finding, {
      meaning: String(fields.get("meaning") ?? ""),
      senseId: String(fields.get("senseId") ?? ""),
    });
  };

  const showEvidence = (finding: PreparationFinding, offset = 0): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (set === null) return;
    void run(async () => {
      model.evidence = await requestJson<EvidencePage>(
        `/api/preparation/sets/${encodeURIComponent(set.id)}/evidence?findingKey=${encodeURIComponent(finding.key)}&offset=${offset}&limit=10`,
      );
      model.evidenceFor = finding.key;
      return `Showing ${model.evidence.items.length} of ${model.evidence.total} evidence links.`;
    });
  };

  const deleteSet = (): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (
      set === null ||
      !confirm(
        `Delete local subtitle analysis for “${set.title}”? Study Cards and progress will be kept.`,
      )
    )
      return;
    void run(async () => {
      await requestJson(
        `/api/preparation/sets/${encodeURIComponent(set.id)}`,
        jsonRequest("DELETE", { confirmation: "delete" }),
      );
      model.currentSet = null;
      model.preflight = null;
      model.result = null;
      model.draft = null;
      model.evidence = null;
      await refreshLists();
      return model.plan === null
        ? "Subtitle Set and Preparation analysis deleted. Study data was kept."
        : "Subtitle Set deleted. Its independent Preparation Plan remains manageable below.";
    });
  };

  const reviewPlan = (): void => {
    if (model.busy) return;
    const set = model.currentSet;
    if (set === null) return;
    void run(async () => {
      model.draft = await requestJson<PlanDraft>(
        `/api/preparation/sets/${encodeURIComponent(set.id)}/plan-draft`,
      );
      return model.draft.blockers.length === 0
        ? `${model.draft.items.length} Cards are ready to stage.`
        : `${model.draft.blockers.length} selected target(s) need correction before starting.`;
    });
  };

  const startPlan = (): void => {
    if (model.busy) return;
    const set = model.currentSet;
    const draft = model.draft;
    if (set === null || draft === null || draft.blockers.length > 0) return;
    void run(async () => {
      model.plan = await requestJson<PlanSnapshot>(
        `/api/preparation/sets/${encodeURIComponent(set.id)}/start-plan`,
        jsonRequest("POST", {
          operationKey: crypto.randomUUID(),
          draftDigest: draft.digest,
        }),
      );
      model.draft = null;
      await refreshLists();
      return `Plan started atomically: ${model.plan.createdCards} Card(s) created and ${model.plan.reusedCards} reused.`;
    });
  };

  const changePlanState = (action: "pause" | "resume"): void => {
    if (model.busy) return;
    const plan = model.plan;
    if (plan === null) return;
    void run(async () => {
      model.plan = await requestJson<PlanSnapshot>(
        `/api/study/plans/${encodeURIComponent(plan.id)}`,
        jsonRequest("POST", { action }),
      );
      return action === "pause"
        ? "Plan staging paused; existing Card progress was kept."
        : "Plan staging resumed under the shared daily allowance.";
    });
  };

  const deletePlan = (): void => {
    if (model.busy) return;
    const plan = model.plan;
    if (
      plan === null ||
      !confirm(`Delete preparation plan “${plan.title}”? Cards and progress are kept.`)
    )
      return;
    void run(async () => {
      await requestJson(
        `/api/study/plans/${encodeURIComponent(plan.id)}`,
        jsonRequest("DELETE", { confirmation: "delete" }),
      );
      model.plan = null;
      await refreshLists();
      return "Plan deleted. Its Cards and learning progress were kept.";
    });
  };

  const reportView = (): TemplateResult | string => {
    const report = model.report;
    if (report === null) return "";
    return html`<section class="panel prepare-report" data-testid="import-report">
      <p class="eyebrow">Inspect before saving</p>
      <h2>Import report</h2>
      <p>${report.acceptedCount} accepted · ${report.rejectedCount} rejected · ${report.duplicateCount} duplicate</p>
      <ul class="plain-list">
        ${report.entries.map(
          (entry) => html`<li class="import-entry import-entry--${entry.outcome}">
            <strong>${entry.displayName}</strong><span>${rejectionCopy(entry)}</span>
          </li>`,
        )}
      </ul>
      <form @submit=${commit} class="stack">
        <label>Subtitle Set title <input name="setTitle" value="New preparation set" required /></label>
        <ol class="episode-order">
          ${model.draftEpisodes.map(
            (episode, index) => html`<li>
              <div>
                <span class="pill">Episode ${index + 1}</span>
                <small>${episode.displayName} · ${episode.cueCount} cues</small>
              </div>
              <input
                aria-label="Episode title"
                .value=${episode.title}
                @input=${(event: InputEvent) =>
                  renameDraft(
                    episode.entryId,
                    (event.currentTarget as HTMLInputElement).value,
                  )}
              />
              <div class="button-row">
                <button type="button" class="secondary" @click=${() => move(index, -1)} ?disabled=${index === 0}>↑</button>
                <button type="button" class="secondary" @click=${() => move(index, 1)} ?disabled=${index === model.draftEpisodes.length - 1}>↓</button>
                <button type="button" class="secondary" @click=${() => removeDraft(episode.entryId)}>Remove</button>
              </div>
            </li>`,
          )}
        </ol>
        <button type="submit" ?disabled=${model.busy || model.draftEpisodes.length === 0}>Save Subtitle Set</button>
      </form>
    </section>`;
  };

  const preflightView = (): TemplateResult | string => {
    const value = model.preflight;
    if (value === null) return "";
    return html`<section class="panel preflight" data-testid="analysis-preflight">
      <p class="eyebrow">Explicit remote scope</p>
      <h2>Ready to analyze</h2>
      <p><strong>${value.provider.provider}</strong> · ${value.provider.model}</p>
      <p>${value.episodeCount} episodes · ${value.japaneseCueCount}/${value.cueCount} Japanese cues · ${value.inputBytes.toLocaleString()} text bytes</p>
      <p>${value.estimatedRequests - value.completedRequests} paid request(s) remain out of ${value.estimatedRequests} batches.</p>
      <ul>${value.disclosure.map((item) => html`<li>${item}</li>`)}</ul>
      ${
        model.progress === null
          ? ""
          : html`<div class="progress" data-testid="analysis-progress" role="status">
            <progress max=${model.progress.total} value=${model.progress.completed}></progress>
            <p>${model.progress.completed} of ${model.progress.total} batches complete. Safe to leave or stop — finished batches are saved and never repaid.</p>
            <button type="button" @click=${stopAnalysis}>Stop after this chunk</button>
          </div>`
      }
      ${
        value.providerConfigured
          ? html`<button type="button" @click=${() => analyze()} ?disabled=${model.busy}>Analyze subtitle text</button>`
          : html`<p class="notice notice--error">Configure the OpenAI key in Study settings before analysis.</p>`
      }
    </section>`;
  };

  const findingView = (finding: PreparationFinding): TemplateResult => html`
    <article class="finding finding--${finding.relation}" data-testid="gap-finding">
      <div class="finding-heading">
        <div>
          <span class="pill">${finding.type}</span>
          <h3 lang="ja">${findingTitle(finding)}</h3>
          <p>${finding.meaning}</p>
        </div>
        <strong>${finding.priority}</strong>
      </div>
      <p>${finding.classification} · ${finding.relation} · ${finding.resolution} · ${Math.round(finding.confidence * 100)}% confidence</p>
      <p>${finding.rankReasons.join(" · ")}</p>
      ${finding.correctedAt === null ? "" : html`<p>Corrected ${new Date(finding.correctedAt).toLocaleString()}</p>`}
      ${finding.existingCardId === null ? "" : html`<p>Reuses Card ${finding.existingCardId}</p>`}
      ${finding.ambiguity.length === 0 ? "" : html`<p>Alternatives: ${finding.ambiguity.join(", ")}</p>`}
      <div class="button-row">
        ${(["required", "helpful", "incidental"] as const).map(
          (item) => html`<button
            type="button"
            class=${finding.classification === item ? "" : "secondary"}
            @click=${() => correct(finding, { classification: item })}
          >${item}</button>`,
        )}
        <button type="button" class="secondary" @click=${() => correct(finding, { knownForSet: !finding.knownForSet })}>
          ${finding.knownForSet ? "Undo known" : "Known for this set"}
        </button>
        <button type="button" class="secondary" @click=${() => correct(finding, { disposition: finding.disposition === "defer" ? "include" : "defer" })}>
          ${finding.disposition === "defer" ? "Include now" : "Defer"}
        </button>
        <button type="button" class="secondary" @click=${() => correct(finding, { disposition: finding.disposition === "dismiss" ? "include" : "dismiss" })}>
          ${finding.disposition === "dismiss" ? "Restore" : "Dismiss"}
        </button>
        <button type="button" class="secondary" @click=${() => showEvidence(finding)}>Evidence (${finding.occurrenceCount})</button>
      </div>
      <details>
        <summary>Correct meaning or sense</summary>
        <form class="identity-correction" @submit=${(event: SubmitEvent) =>
          correctIdentity(event, finding)}>
          <label>Meaning <input name="meaning" .value=${finding.meaning} required /></label>
          <label>Sense ID <input name="senseId" .value=${finding.senseId ?? ""} placeholder="Choose a stable sense label" required /></label>
          <button type="submit">Save identity</button>
        </form>
      </details>
      ${
        model.evidenceFor === finding.key && model.evidence !== null
          ? html`<div class="evidence-list">
            ${model.evidence.items.map(
              (item) =>
                html`<p><strong>Episode ${item.episodeOrder} · ${Math.floor(item.startMs / 1000)}s</strong><br /><span lang="ja">${item.context}</span></p>`,
            )}
            <div class="button-row">
              <button type="button" class="secondary" ?disabled=${model.evidence.offset === 0} @click=${() =>
                showEvidence(
                  finding,
                  Math.max(0, (model.evidence?.offset ?? 0) - 10),
                )}>Previous</button>
              <button type="button" class="secondary" ?disabled=${model.evidence.offset + model.evidence.items.length >= model.evidence.total} @click=${() =>
                showEvidence(finding, (model.evidence?.offset ?? 0) + 10)}>More</button>
            </div>
          </div>`
          : ""
      }
    </article>`;

  const gapView = (): TemplateResult | string => {
    const result = model.result;
    if (result === null) return "";
    const visible = result.findings.filter(
      (finding) =>
        (model.relation === "all" || finding.relation === model.relation) &&
        (model.classification === "all" ||
          (model.classification === "useful"
            ? finding.classification !== "incidental"
            : finding.classification === model.classification)) &&
        (model.findingType === "all" || finding.type === model.findingType) &&
        (model.disposition === "all" || finding.disposition === model.disposition) &&
        (model.query.trim() === "" ||
          [
            finding.canonicalKey,
            finding.lemma ?? "",
            finding.reading ?? "",
            finding.meaning,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(model.query.trim().toLocaleLowerCase())),
    );
    return html`<section class="panel" data-testid="preparation-gap">
      <div class="finding-heading">
        <div><p class="eyebrow">Complete result</p><h2>Preparation analysis</h2></div>
        <span class="pill">${result.state}</span>
      </div>
      <div class="metrics compact">
        <article><strong>${result.counts.gap}</strong><span>gap</span></article>
        <article><strong>${result.counts.existing}</strong><span>existing</span></article>
        <article><strong>${result.counts.known}</strong><span>known</span></article>
        <article><strong>${result.counts.ambiguous}</strong><span>ambiguous</span></article>
      </div>
      ${
        result.state === "paused" && result.possibleDuplicateCharge
          ? html`<div class="notice notice--error"><p>The last paid request may have reached the provider. Retrying can pay twice.</p><button type="button" @click=${() => analyze(true)}>Retry and possibly pay twice</button></div>`
          : ""
      }
      <div class="filters">
        <label>Relation
          <select .value=${model.relation} @change=${(event: Event) => {
            model.relation = (event.currentTarget as HTMLSelectElement)
              .value as Model["relation"];
            draw();
          }}>
            <option value="missing">Preparation Gap</option>
            <option value="existing">Existing preparation coverage</option>
            <option value="known">Known subtraction</option>
            <option value="all">All findings</option>
          </select>
        </label>
        <label>Priority class
          <select .value=${model.classification} @change=${(event: Event) => {
            model.classification = (event.currentTarget as HTMLSelectElement)
              .value as Model["classification"];
            draw();
          }}>
            <option value="useful">Required + helpful</option>
            <option value="required">Required</option>
            <option value="helpful">Helpful</option>
            <option value="incidental">Incidental</option>
            <option value="all">All classes</option>
          </select>
        </label>
        <label>Type
          <select .value=${model.findingType} @change=${(event: Event) => {
            model.findingType = (event.currentTarget as HTMLSelectElement)
              .value as Model["findingType"];
            draw();
          }}>
            <option value="all">Grammar + vocabulary</option>
            <option value="grammar">Grammar</option>
            <option value="vocabulary">Vocabulary</option>
          </select>
        </label>
        <label>Disposition
          <select .value=${model.disposition} @change=${(event: Event) => {
            model.disposition = (event.currentTarget as HTMLSelectElement)
              .value as Model["disposition"];
            draw();
          }}>
            <option value="include">Included</option>
            <option value="defer">Deferred</option>
            <option value="dismiss">Dismissed</option>
            <option value="all">All dispositions</option>
          </select>
        </label>
        <label>Search
          <input type="search" .value=${model.query} @input=${(event: InputEvent) => {
            model.query = (event.currentTarget as HTMLInputElement).value;
            draw();
          }} />
        </label>
      </div>
      <p>Showing ${visible.length} complete finding(s); this filter does not truncate the stored analysis.</p>
      <button type="button" @click=${reviewPlan} ?disabled=${model.busy}>Review preparation plan</button>
      <div class="finding-list">${visible.map(findingView)}</div>
    </section>`;
  };

  const planView = (): TemplateResult | string => {
    const draft = model.draft;
    const plan = model.plan;
    if (draft !== null) {
      return html`<section class="panel" data-testid="plan-draft">
        <p class="eyebrow">Review before Study writes</p>
        <h2>${plan === null ? "Preparation Plan Draft" : "Replace Preparation Plan"}</h2>
        <p>${draft.selection.required} required · ${draft.selection.helpful} helpful · ${draft.selection.grammar} grammar · ${draft.selection.vocabulary} vocabulary</p>
        ${
          draft.blockers.length === 0
            ? html`<p>All ${draft.items.length} selected targets have Card identity and source evidence.</p>`
            : html`<div class="notice notice--error"><strong>Correct these in the gap first</strong><ul>${draft.blockers.map((blocker) => html`<li>${blocker.label}: ${blocker.reason}</li>`)}</ul></div>`
        }
        <div class="button-row">
          <button type="button" @click=${startPlan} ?disabled=${model.busy || draft.blockers.length > 0 || draft.items.length === 0}>${plan === null ? "Start plan" : "Replace plan"}</button>
          ${
            plan === null
              ? ""
              : html`<button type="button" class="secondary" @click=${() => {
                  model.draft = null;
                  draw();
                }}>Cancel replacement</button>`
          }
        </div>
      </section>`;
    }
    if (plan !== null) {
      return html`<section class="panel" data-testid="plan-readiness">
        <div class="finding-heading">
          <div><p class="eyebrow">Preparation Plan</p><h2>${plan.title}</h2></div>
          <span class="pill">${plan.state}</span>
        </div>
        <p>${plan.members.length} Cards · ${plan.newCardsPerDay} new Cards per local day · revision ${plan.revision}</p>
        <div class="episode-readiness">
          ${plan.episodes.map(
            (episode) => html`<article class="episode-readiness-card">
              <strong>${episode.ready ? "Ready" : "Preparing"} · Episode ${episode.order}</strong>
              <span>${episode.title}</span>
              <small>Required ${episode.requiredReady}/${episode.requiredTotal} · Helpful ${episode.helpfulReady}/${episode.helpfulTotal}</small>
              ${episode.estimatedIntroductionDay === null ? "" : html`<small>Estimated required introductions by ${episode.estimatedIntroductionDay}</small>`}
              ${episode.inStudyUnknownReadiness === 0 ? "" : html`<small>${episode.inStudyUnknownReadiness} blocker(s) are in study; readiness depends on recall.</small>`}
              ${episode.inactiveStagedBlockers === 0 ? "" : html`<small>${episode.inactiveStagedBlockers} blocker(s) have no active staging source.</small>`}
            </article>`,
          )}
        </div>
        <div class="button-row">
          <button type="button" class="secondary" @click=${() =>
            changePlanState(
              plan.state === "active" ? "pause" : "resume",
            )}>${plan.state === "active" ? "Pause staging" : "Resume staging"}</button>
          <button type="button" class="danger" @click=${deletePlan}>Delete plan</button>
        </div>
      </section>`;
    }
    return "";
  };

  const draw = (): void => {
    render(
      html`<main class="study-shell prepare-shell">
        <header class="hero">
          <div><p class="eyebrow">Gafu V2 · Preparation</p><h1>Find the Japanese between you and the show.</h1><p class="lede">Import locally, inspect the scope, then deliberately analyze subtitle text.</p></div>
          <a class="secondary button-link" href="/">Study</a>
        </header>
        <p class="notice notice--${model.messageKind}" role="status">${model.message}</p>
        <section class="prepare-grid">
          <div class="stack">
            <section class="panel">
              <p class="eyebrow">Local import</p><h2>Choose subtitles</h2>
              <p>Select multiple Japanese SRTs or one ZIP. Import alone never calls the AI provider.</p>
              <form @submit=${inspect} class="stack">
                <label>Choose subtitles <input name="files" type="file" accept=".srt,.zip" multiple required /></label>
                <button type="submit" ?disabled=${model.busy}>Inspect files</button>
              </form>
            </section>
            ${reportView()}
            ${
              model.currentSet === null
                ? ""
                : html`<section class="panel" data-testid="current-subtitle-set">
                  <p class="eyebrow">Saved locally</p><h2>${model.currentSet.title}</h2>
                  <ol>${model.currentSet.episodes.map((episode) => html`<li>${episode.title} · ${episode.cueCount} cues</li>`)}</ol>
                  <div class="button-row"><button type="button" @click=${preflight} ?disabled=${model.busy}>Review analysis scope</button><button type="button" class="danger" @click=${deleteSet}>Delete local media data</button></div>
                </section>`
            }
            ${preflightView()}
            ${gapView()}
            ${planView()}
          </div>
          <aside class="panel set-list"><p class="eyebrow">Saved sets</p><h2>Subtitle Sets</h2>
            ${model.sets.length === 0 ? html`<p>No saved sets yet.</p>` : model.sets.map((set) => html`<button type="button" class="set-button" ?disabled=${model.busy} @click=${() => openSet(set)}><strong>${set.title}</strong><span>${set.episodes.length} episode(s) · ${set.analysis?.state ?? "not analyzed"}</span></button>`)}
            <hr />
            <p class="eyebrow">Durable plans</p><h2>Preparation Plans</h2>
            ${model.plans.length === 0 ? html`<p>No active plans.</p>` : model.plans.map((plan) => html`<button type="button" class="set-button" ?disabled=${model.busy} @click=${() => openPlan(plan)}><strong>${plan.title}</strong><span>${plan.state} · ${plan.memberCount} Cards</span></button>`)}
          </aside>
        </section>
      </main>`,
      root,
    );
  };

  draw();
  void run(async () => {
    await refreshLists();
    return "Choose Japanese subtitles or reopen a saved Subtitle Set.";
  });
};
