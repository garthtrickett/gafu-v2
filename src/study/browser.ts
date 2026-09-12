import { html, render, type TemplateResult } from "lit-html";
import type {
  PreparedMaterial,
  ProviderStatus,
  ReviewBatchProgress,
} from "../learning-material/generated-contracts.ts";
import { mutationHeaders } from "../local-api.ts";
import type {
  CardContent,
  CardStateCommand,
  CardSummary,
  CreateCard,
  KnowledgeSnapshot,
  StudyPreferences,
  StudyStatus,
} from "./contracts.ts";
import { splitFurigana } from "./furigana.ts";
import type { SessionCounts } from "./session-split.ts";

type BrowserSnapshot = Readonly<{
  cards: readonly CardSummary[];
  preferences: StudyPreferences;
  knowledge: KnowledgeSnapshot;
  status: StudyStatus;
  session: SessionCounts;
}>;

type BrowserModel = {
  snapshot: BrowserSnapshot | null;
  provider: ProviderStatus | null;
  presentation: PreparedMaterial | null;
  revealed: boolean;
  busy: boolean;
  batch: {
    id: string;
    total: number;
    completed: number;
    completedIds: string[];
    failed: number;
    pending: number;
    done: boolean;
  } | null;
  message: string;
  messageKind: "neutral" | "success" | "error";
  search: string;
  typeFilter: "all" | "grammar" | "vocabulary";
};

const requestJson = async <Value>(url: string, init?: RequestInit): Promise<Value> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...Object.fromEntries(mutationHeaders(init?.headers)),
    },
  });
  const body = (await response.json()) as Value | { error?: { kind?: string } };
  if (!response.ok) {
    const kind =
      typeof body === "object" && body !== null && "error" in body
        ? body.error?.kind
        : undefined;
    throw new Error(kind ?? `requestFailed:${response.status}`);
  }
  return body as Value;
};

const value = (form: FormData, key: string): string => String(form.get(key) ?? "");

const cardTitle = (card: CardSummary): string =>
  card.type === "grammar"
    ? "canonicalForm" in card.content
      ? card.content.canonicalForm
      : "Grammar Card"
    : "lemma" in card.content
      ? card.content.lemma
      : "Vocabulary Card";

const cardMeaning = (card: CardSummary): string => card.content.meaning;

const stateActions = (
  card: CardSummary,
  act: (action: CardStateCommand["action"]) => void,
): TemplateResult => {
  if (card.state === "suspended") {
    return html`<button type="button" class="secondary" @click=${() => act("restore")}>
      Restore
    </button>`;
  }
  return html`
    ${
      card.state === "known"
        ? html`<button type="button" class="secondary" @click=${() => act("markNotKnown")}>
          Mark not known
        </button>`
        : html``
    }
    ${
      card.supportReadyAt === null
        ? html`<button type="button" class="secondary" @click=${() => act("markSupportReady")}>
          Support-ready
        </button>`
        : html``
    }
    <button type="button" class="secondary" @click=${() => act("suspend")}>
      Suspend
    </button>
  `;
};

const editForm = (
  card: CardSummary,
  submit: (event: SubmitEvent) => void,
): TemplateResult => {
  if (card.type === "grammar" && "canonicalForm" in card.content) {
    return html`<form class="edit-form" @submit=${submit}>
      <p class="identity-note">Identity stays attached to ${card.content.canonicalForm}.</p>
      <label>Canonical display <input name="canonicalForm" required .value=${card.content.canonicalForm} /></label>
      <label>Meaning <input name="meaning" required .value=${card.content.meaning} /></label>
      <label>Formation <input name="formation" required .value=${card.content.formation} /></label>
      <label
        >Usage notes
        <textarea name="usageNotes" .value=${card.content.usageNotes}></textarea>
      </label>
      <button type="submit">Save display content</button>
    </form>`;
  }
  if (card.type === "vocabulary" && "lemma" in card.content) {
    return html`<form class="edit-form" @submit=${submit}>
      <p class="identity-note">
        This edits display content; it does not move review history to a different sense.
      </p>
      <label>Lemma <input name="lemma" required .value=${card.content.lemma} /></label>
      <label>Reading <input name="reading" required .value=${card.content.reading} /></label>
      <label>Part of speech <input name="partOfSpeech" required .value=${card.content.partOfSpeech} /></label>
      <label>Meaning <input name="meaning" required .value=${card.content.meaning} /></label>
      <label
        >Usage notes
        <textarea name="usageNotes" .value=${card.content.usageNotes}></textarea>
      </label>
      <button type="submit">Save display content</button>
    </form>`;
  }
  return html``;
};

const rubyText = (
  material: PreparedMaterial["material"],
  targetSpan: { start: number; end: number } | null,
): TemplateResult[] => {
  // Colouring by character offset is only sound when the segments rejoin
  // into exactly the sentence. Otherwise show the sentence uncoloured
  // rather than colouring the wrong word. Whole segments fully inside the
  // span colour exactly; anything else falls back to overlapping segments so
  // model-shaped segmentations still mark the word.
  const colourable =
    targetSpan !== null &&
    material.readingSegments.map((segment) => segment.written).join("") ===
      material.japanese;
  let offset = 0;
  const located = material.readingSegments.map((segment) => {
    const start = offset;
    offset += segment.written.length;
    return { segment, start, end: offset };
  });
  const inside = located.filter(
    (item) =>
      targetSpan !== null &&
      item.start >= targetSpan.start &&
      item.end <= targetSpan.end,
  );
  const overlapping = located.filter(
    (item) =>
      targetSpan !== null && item.start < targetSpan.end && item.end > targetSpan.start,
  );
  const coloured = new Set(
    colourable ? (inside.length > 0 ? inside : overlapping) : [],
  );
  return located.map((item) => {
    const { before, body, over, after } = splitFurigana(
      item.segment.written,
      item.segment.reading,
    );
    const ruby =
      body === ""
        ? html`${before}`
        : html`${before}<ruby>${body}<rt>${over}</rt></ruby>${after}`;
    return coloured.has(item) ? html`<span class="target">${ruby}</span>` : ruby;
  });
};

export const mountStudyApp = (root: HTMLElement): void => {
  const model: BrowserModel = {
    snapshot: null,
    provider: null,
    presentation: null,
    revealed: false,
    busy: true,
    batch: null,
    message: "Loading your Card bank…",
    messageKind: "neutral",
    search: "",
    typeFilter: "all",
  };

  const refresh = async (): Promise<void> => {
    [model.snapshot, model.provider] = await Promise.all([
      requestJson<BrowserSnapshot>("/api/study"),
      requestJson<ProviderStatus>("/api/provider"),
    ]);
  };

  const run = async (operation: () => Promise<string>): Promise<void> => {
    model.busy = true;
    draw();
    try {
      const message = await operation();
      await refresh();
      model.message = message;
      model.messageKind = "success";
    } catch (cause) {
      model.message = cause instanceof Error ? cause.message : String(cause);
      model.messageKind = "error";
    } finally {
      model.busy = false;
      draw();
    }
  };

  const createCard = (type: CreateCard["type"]) => (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    const input: CreateCard =
      type === "grammar"
        ? {
            type,
            content: {
              canonicalForm: value(fields, "canonicalForm"),
              meaning: value(fields, "meaning"),
              formation: value(fields, "formation"),
              usageNotes: value(fields, "usageNotes"),
            },
          }
        : {
            type,
            content: {
              lemma: value(fields, "lemma"),
              reading: value(fields, "reading"),
              partOfSpeech: value(fields, "partOfSpeech"),
              meaning: value(fields, "meaning"),
              usageNotes: value(fields, "usageNotes"),
            },
          };
    void run(async () => {
      const outcome = await requestJson<{ outcome: "created" | "existing" }>(
        "/api/study/cards",
        { method: "POST", body: JSON.stringify(input) },
      );
      if (outcome.outcome === "created") form.reset();
      return outcome.outcome === "created"
        ? `${type === "grammar" ? "Grammar" : "Vocabulary"} Card created and staged.`
        : "That Card already exists; its progress was kept.";
    });
  };

  const setState = (card: CardSummary, action: CardStateCommand["action"]): void => {
    void run(async () => {
      await requestJson(`/api/study/cards/${encodeURIComponent(card.id)}/state`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      return `Card is now ${
        action === "markSupportReady"
          ? "support-ready"
          : action === "markNotKnown"
            ? "back in study"
            : action === "suspend"
              ? "suspended"
              : "restored"
      }.`;
    });
  };

  const updateCard = (card: CardSummary) => (event: SubmitEvent) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    const content: CardContent =
      card.type === "grammar"
        ? {
            canonicalForm: value(fields, "canonicalForm"),
            meaning: value(fields, "meaning"),
            formation: value(fields, "formation"),
            usageNotes: value(fields, "usageNotes"),
          }
        : {
            lemma: value(fields, "lemma"),
            reading: value(fields, "reading"),
            partOfSpeech: value(fields, "partOfSpeech"),
            meaning: value(fields, "meaning"),
            usageNotes: value(fields, "usageNotes"),
          };
    void run(async () => {
      await requestJson(`/api/study/cards/${encodeURIComponent(card.id)}`, {
        method: "PATCH",
        body: JSON.stringify(content),
      });
      return "Card display content updated; its identity and progress were kept.";
    });
  };

  const savePreferences = (event: SubmitEvent): void => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget as HTMLFormElement);
    void run(async () => {
      await requestJson("/api/study/preferences", {
        method: "PUT",
        body: JSON.stringify({
          newCardsPerDay: Number(value(fields, "newCardsPerDay")),
          timeZone: value(fields, "timeZone"),
        }),
      });
      return "Study settings saved. Earlier admissions and reviews were not changed.";
    });
  };

  const setBaselineWord = (key: string, enabled: boolean): void => {
    void run(async () => {
      await requestJson(`/api/study/baseline/${encodeURIComponent(key)}`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      return enabled
        ? "Baseline word restored to the Known Word Bank."
        : "Baseline word disabled. It will no longer count as known.";
    });
  };

  /**
   * The sentence with a reading over each written form that needs one.
   *
   * The material already carries the segments, and the validator requires their
   * written parts to rejoin into exactly the sentence, so this cannot drop or
   * duplicate text. A segment whose reading is its own writing is kana already
   * and takes no ruby: putting が over が is noise that pushes the line apart.
   */
  const startSession = (url: string): void => {
    void run(async () => {
      try {
        model.presentation = await requestJson<PreparedMaterial>(url, {
          method: "POST",
        });
      } catch (cause) {
        // New Cards show only what the import stored. Anything else is an
        // onboarding gap, not something retrying will fix.
        if (cause instanceof Error && cause.message === "teachingNotPrepared") {
          throw new Error(
            "This Card has no teaching yet. Import it with the cards CLI first.",
          );
        }
        throw cause;
      }
      model.revealed = false;
      return model.presentation.mode === "teach"
        ? "Learn this target. It goes back in the queue for review."
        : "Read the sentence, then check the explanation and mark yourself.";
    });
  };

  const startLearn = (): void => startSession("/api/study/learn");

  const startReview = (): void => startSession("/api/study/session/review");

  const pollReviewBatch = (batchId: string): void => {
    // Each status poll advances the batch one Card, so polling is the pump:
    // no daemon, resumable across processes, every call bounded by one
    // generation. Failures are informational here; the batch keeps whatever
    // it already banked and the next poll retries.
    const poller = window.setInterval(() => {
      if (model.batch?.id !== batchId) {
        window.clearInterval(poller);
        return;
      }
      void requestJson<ReviewBatchProgress>(
        `/api/study/review-batch/${encodeURIComponent(batchId)}`,
        { method: "GET" },
      )
        .then((progress) => {
          if (model.batch?.id !== batchId) return;
          model.batch = {
            id: batchId,
            total:
              progress.completed.length + progress.failed.length + progress.pending,
            completed: progress.completed.length,
            completedIds: [...progress.completed],
            failed: progress.failed.length,
            pending: progress.pending,
            done: progress.done,
          };
          if (progress.done) {
            window.clearInterval(poller);
            model.message =
              progress.failed.length === 0
                ? `Batch ready: ${progress.completed.length} to review.`
                : `Batch ready: ${progress.completed.length} to review, ${progress.failed.length} failed and stay due.`;
            model.messageKind = "success";
          }
          draw();
        })
        .catch(() => {});
    }, 3_000);
  };

  const startReviewBatch = (): void => {
    if (model.batch !== null && !model.batch.done) return;
    void run(async () => {
      const dispatched = await requestJson<{ batchId: string; total: number }>(
        "/api/study/review-batch",
        { method: "POST", body: JSON.stringify({}) },
      );
      model.batch = {
        id: dispatched.batchId,
        total: dispatched.total,
        completed: 0,
        completedIds: [],
        failed: 0,
        pending: dispatched.total,
        done: false,
      };
      draw();
      pollReviewBatch(dispatched.batchId);
      return `Review batch started for ${dispatched.total} Cards.`;
    });
  };

  // Seen it records the acknowledgement, then keeps the learner in Learn by
  // serving the next untaught Card straight away. The taught Card itself is
  // never chained into its review (Patch 2.9); only the next first exposure
  // follows. Running out is the natural end of the session, not an error:
  // the buttons come back with a plain message.
  const finishTeaching = (): void => {
    const current = model.presentation;
    if (current === null) return;
    void run(async () => {
      await requestJson("/api/study/session/teach", {
        method: "POST",
        body: JSON.stringify({
          cardId: current.cardId,
          presentationId: current.id,
        }),
      });
      model.presentation = null;
      try {
        model.presentation = await requestJson<PreparedMaterial>("/api/study/learn", {
          method: "POST",
        });
      } catch (cause) {
        if (cause instanceof Error && cause.message === "teachingNotPrepared") {
          return "Teaching seen. Nothing more to learn right now.";
        }
        throw cause;
      }
      model.revealed = false;
      return "Teaching seen. Here is the next Card to learn.";
    });
  };

  // After a grade, keep working through a finished batch without sending
  // the learner back to the buttons: serve the next batched Card that is
  // still due, skipping anything already answered elsewhere. Failed batch
  // Cards are never attempted here — they stay due for single Review.
  // Returns the next presentation, "done" when the batch is exhausted, or
  // null when no batch is driving.
  const chainBatch = async (
    justGraded: string,
  ): Promise<PreparedMaterial | "done" | null> => {
    const batch = model.batch;
    if (batch === null || !batch.done) return null;
    for (const cardId of batch.completedIds) {
      if (cardId === justGraded) continue;
      try {
        return await requestJson<PreparedMaterial>("/api/study/session/prepare", {
          method: "POST",
          body: JSON.stringify({ cardId }),
        });
      } catch (cause) {
        if (
          cause instanceof Error &&
          (cause.message === "cardNotDue" || cause.message === "nothingDue")
        ) {
          continue;
        }
        throw cause;
      }
    }
    model.batch = null;
    return "done";
  };

  // Check yourself against the explanation, then mark it honestly:
  // correct maps to good, incorrect maps to again, and the scheduler never
  // sees a third option.
  const answer = (correct: boolean): void => {
    if (model.busy) return;
    const current = model.presentation;
    if (current?.permit === null || current?.permit === undefined) return;
    void run(async () => {
      await requestJson("/api/study/session/answer", {
        method: "POST",
        body: JSON.stringify({
          cardId: current.cardId,
          grade: correct ? "good" : "again",
          permit: current.permit?.token,
        }),
      });
      model.presentation = null;
      model.revealed = false;
      const chained = await chainBatch(current.cardId);
      if (chained !== null && chained !== "done") {
        model.presentation = chained;
        model.revealed = false;
        return correct
          ? "Review recorded once. Next batched Card."
          : "Marked for sooner. Next batched Card.";
      }
      if (chained === "done") return "Batch complete.";
      return correct
        ? "Review recorded once. The Card's next due time is saved."
        : "Marked for sooner. The Card's next due time is saved.";
    });
  };

  const draw = (): void => {
    const snapshot = model.snapshot;
    const matching =
      snapshot?.cards.filter((card) => {
        const haystack = `${cardTitle(card)} ${cardMeaning(card)}`.toLocaleLowerCase();
        return (
          (model.typeFilter === "all" || card.type === model.typeFilter) &&
          haystack.includes(model.search.toLocaleLowerCase())
        );
      }) ?? [];
    render(
      html`<main class="study-shell">
        <header class="hero">
          <div>
            <p class="eyebrow">Gafu V2 · Study foundation</p>
            <h1>Learn the Japanese your shows need.</h1>
            <p class="lede">
              Cards own progress. AI material varies; local validation decides what is safe.
            </p>
          </div>
          <div class="button-row">
            <a class="secondary button-link" href="?view=watch">Watch</a>
            <a class="secondary button-link" href="?view=prepare">Prepare a show</a>
            <a class="secondary button-link" href="?diagnostic=phase0">Phase 0 diagnostic</a>
          </div>
        </header>

        <p class="notice notice--${model.messageKind}" role="status">${model.message}</p>

        ${
          snapshot === null
            ? html`<section class="panel"><p>Opening the local Study database…</p></section>`
            : html`
              <section class="metrics metrics--study" aria-label="Study status">
                <article data-testid="tile-staged"><strong>${snapshot.status.stagedCount}</strong><span>staged</span></article>
                <article data-testid="tile-later"><strong>${snapshot.session.laterCount}</strong><span>not due yet</span></article>
                <article data-testid="tile-learn"><strong>${snapshot.session.learnCount}</strong><span>to learn</span></article>
                <article data-testid="tile-review"><strong>${snapshot.session.reviewCount}</strong><span>to review</span></article>
                <article data-testid="tile-known"><strong>${snapshot.status.knownCount}</strong><span>known</span></article>
              </section>

              <section class="panel review-panel" data-testid="review-panel">
                <div class="review-heading">
                  <div>
                    <p class="eyebrow">Fresh validated material</p>
                    <h2>Study</h2>
                  </div>
                  ${
                    model.presentation === null
                      ? html`<div class="button-row">
                          <button type="button" @click=${startLearn} ?disabled=${model.busy}>
                            Learn new
                          </button>
                          <button type="button" @click=${startReview} ?disabled=${model.busy}>
                            Review
                          </button>
                          <button type="button" @click=${startReviewBatch} ?disabled=${model.busy || (model.batch !== null && !model.batch.done)}>
                            Review batch
                          </button>
                        </div>`
                      : ""
                  }
                </div>
                ${
                  model.batch !== null
                    ? html`<p data-testid="batch-progress">
                        ${
                          model.batch.done
                            ? `Batch ready: ${model.batch.completed} to review${model.batch.failed > 0 ? `, ${model.batch.failed} failed and stay due` : ""}. Press Review to work through.`
                            : `Batching reviews: ${model.batch.completed} of ${model.batch.total} ready${model.batch.failed > 0 ? `, ${model.batch.failed} failed` : ""}…`
                        }
                      </p>`
                    : ""
                }
                ${
                  model.presentation === null
                    ? html`<p>Learn shows the next untaught Card from its stored teaching. Review prepares the next due review. Staged Cards are admitted under your daily limit.</p>`
                    : html`<article class="presentation presentation--${model.presentation.mode}">
                        <span class="pill">${model.presentation.mode}</span>
                        <p class="context">${model.presentation.material.context}</p>
                        <p class="japanese" lang="ja">${rubyText(model.presentation.material, model.presentation.material.targetSpan)}</p>
                        ${
                          model.presentation.mode === "teach"
                            ? html`<div class="answer" data-testid="material-answer">
                                <strong>${model.presentation.material.answer}</strong>
                                <p class="answer-copy">${model.presentation.material.explanation}</p>
                                <p class="answer-copy">${model.presentation.material.usageNote}</p>
                              </div>
                              <button type="button" @click=${finishTeaching} ?disabled=${model.busy}>Seen it — next Card</button>`
                            : model.revealed
                              ? html`<div class="answer" data-testid="material-answer">
                                  <strong>${model.presentation.material.answer}</strong>
                                  <p class="answer-copy">${model.presentation.material.explanation}</p>
                                  <p class="answer-copy">${model.presentation.material.usageNote}</p>
                                </div>
                                <div class="grades" aria-label="Self grade">
                                  <p>Were you right?</p>
                                  <button type="button" class="secondary" ?disabled=${model.busy} @click=${() => answer(true)}>Correct</button>
                                  <button type="button" class="secondary" ?disabled=${model.busy} @click=${() => answer(false)}>Incorrect</button>
                                </div>`
                              : html`<button type="button" @click=${() => {
                                  model.revealed = true;
                                  draw();
                                }}>Explanation</button>`
                        }
                      </article>`
                }
              </section>

              <div class="workspace">
                <section class="panel create-panel">
                  <h2>Create a Card</h2>
                  <p>Manual Cards wait in the same staged queue as future show-prep Cards.</p>
                  <div class="create-grid">
                    <form data-testid="vocabulary-form" @submit=${createCard("vocabulary")}>
                      <h3>Vocabulary</h3>
                      <label>Lemma <input name="lemma" required /></label>
                      <label>Reading <input name="reading" required /></label>
                      <label>Part of speech <input name="partOfSpeech" required /></label>
                      <label>One meaning <input name="meaning" required /></label>
                      <label>Usage notes <textarea name="usageNotes"></textarea></label>
                      <button type="submit" ?disabled=${model.busy}>Create Vocabulary Card</button>
                    </form>
                    <form data-testid="grammar-form" @submit=${createCard("grammar")}>
                      <h3>Grammar</h3>
                      <label>Canonical form <input name="canonicalForm" required /></label>
                      <label>Meaning or function <input name="meaning" required /></label>
                      <label>Formation <input name="formation" required /></label>
                      <label>Usage notes <textarea name="usageNotes"></textarea></label>
                      <button type="submit" ?disabled=${model.busy}>Create Grammar Card</button>
                    </form>
                  </div>
                </section>

                <aside class="panel settings-panel">
                  <h2>Study settings</h2>
                  <form @submit=${savePreferences}>
                    <label>
                      New Cards per Day
                      <input
                        name="newCardsPerDay"
                        type="number"
                        min="0"
                        max="100"
                        required
                        .value=${String(snapshot.preferences.newCardsPerDay)}
                      />
                    </label>
                    <label>
                      Time zone
                      <input name="timeZone" required .value=${snapshot.preferences.timeZone} />
                    </label>
                    <button type="submit" ?disabled=${model.busy}>Save settings</button>
                  </form>
                  <div class="provider-settings">
                    <h3>AI provider</h3>
                    <p>${model.provider?.provider ?? "OpenAI"} · ${model.provider?.model ?? "gpt-5.6-luna"}</p>
                    <p>${
                      model.provider?.configured
                        ? "API key supplied by the server environment."
                        : "No API key. Set OPENAI_API_KEY on the server and restart."
                    }</p>
                    <p class="privacy-note">Card content and the supporting-language allowlist are sent to OpenAI. Gafu requests no response storage, but OpenAI's retention and abuse-monitoring policies still apply. Video and audio are never sent.</p>
                  </div>
                  <div class="baseline baseline--${snapshot.knowledge.baseline.availability}">
                    <h3>Known Word baseline</h3>
                    ${
                      snapshot.knowledge.baseline.availability === "available"
                        ? html`<p>${snapshot.knowledge.baseline.enabledCount} baseline words enabled.</p>
                            <details class="baseline-words">
                              <summary>Correct baseline words</summary>
                              <div>
                                ${snapshot.knowledge.baseline.entries.map(
                                  (word) => html`<p>
                                      <span>${word.lemma} · ${word.reading} · ${word.meaning}</span>
                                      <button
                                        type="button"
                                        class="secondary"
                                        @click=${() => {
                                          setBaselineWord(word.key, !word.enabled);
                                        }}
                                      >
                                        ${word.enabled ? "I don't know this" : "Restore as known"}
                                      </button>
                                    </p>`,
                                )}
                              </div>
                            </details>`
                        : html`<p>
                          Kaishi 1.5k is not installed. Its source needs licence approval; Gafu is
                          not pretending an empty bank is Kaishi.
                        </p>`
                    }
                  </div>
                  <a class="button-link secondary" href="/api/study/backup" download>
                    Download SQLite backup
                  </a>
                </aside>
              </div>

              <section class="panel bank-panel">
                <div class="bank-heading">
                  <div><h2>Card bank</h2><p>${snapshot.cards.length} durable Cards</p></div>
                  <div class="filters">
                    <label>
                      Search
                      <input
                        type="search"
                        .value=${model.search}
                        @input=${(event: InputEvent) => {
                          model.search = (
                            event.currentTarget as HTMLInputElement
                          ).value;
                          draw();
                        }}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        .value=${model.typeFilter}
                        @change=${(event: Event) => {
                          model.typeFilter = (event.currentTarget as HTMLSelectElement)
                            .value as BrowserModel["typeFilter"];
                          draw();
                        }}
                      >
                        <option value="all">All</option>
                        <option value="vocabulary">Vocabulary</option>
                        <option value="grammar">Grammar</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div class="card-list">
                  ${
                    matching.length === 0
                      ? html`<p class="empty">No Cards match this view.</p>`
                      : matching.map(
                          (
                            card,
                          ) => html`<article class="bank-card" data-card-id=${card.id}>
                          <div class="card-copy">
                            <div class="card-meta">
                              <span class="pill">${card.type}</span>
                              <span class="pill pill--state">${card.state}</span>
                              ${
                                card.supportReadyAt === null
                                  ? ""
                                  : html`<span class="pill pill--ready">support-ready</span>`
                              }
                            </div>
                            <h3>${cardTitle(card)}</h3>
                            <p>${cardMeaning(card)}</p>
                            <small>${card.reviewCount} review events</small>
                          </div>
                          <div class="card-actions">
                            ${stateActions(card, (action) => setState(card, action))}
                            <details>
                              <summary>Edit display</summary>
                              ${editForm(card, updateCard(card))}
                            </details>
                          </div>
                        </article>`,
                        )
                  }
                </div>
              </section>
            `
        }
      </main>`,
      root,
    );
  };

  draw();
  void run(async () => {
    await refresh();
    return "Card bank ready. No Cards are admitted until study asks for a queue.";
  });
};
