import { html, render, type TemplateResult } from "lit-html";
import type {
  PreparedMaterial,
  ProviderStatus,
} from "../learning-material/generated-contracts.ts";
import type {
  AnswerGrade,
  CardContent,
  CardStateCommand,
  CardSummary,
  CreateCard,
  KnowledgeSnapshot,
  StudyPreferences,
  StudyStatus,
} from "./contracts.ts";

type BrowserSnapshot = Readonly<{
  cards: readonly CardSummary[];
  preferences: StudyPreferences;
  knowledge: KnowledgeSnapshot;
  status: StudyStatus;
}>;

type BrowserModel = {
  snapshot: BrowserSnapshot | null;
  provider: ProviderStatus | null;
  presentation: PreparedMaterial | null;
  revealed: boolean;
  busy: boolean;
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
      ...init?.headers,
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
        : html`<button type="button" class="secondary" @click=${() => act("markKnown")}>
          Mark known
        </button>`
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

export const mountStudyApp = (root: HTMLElement): void => {
  const model: BrowserModel = {
    snapshot: null,
    provider: null,
    presentation: null,
    revealed: false,
    busy: true,
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
        action === "markKnown"
          ? "known"
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

  const replaceProviderKey = (event: SubmitEvent): void => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fields = new FormData(form);
    void run(async () => {
      model.provider = await requestJson<ProviderStatus>("/api/provider/key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: value(fields, "apiKey") }),
      });
      form.reset();
      return "OpenAI API key verified and held in server memory.";
    });
  };

  const removeProviderKey = (): void => {
    void run(async () => {
      model.provider = await requestJson<ProviderStatus>("/api/provider/key", {
        method: "DELETE",
      });
      return "Provider API key removed.";
    });
  };

  const startStudy = (): void => {
    void run(async () => {
      model.presentation = await requestJson<PreparedMaterial>("/api/study/session", {
        method: "POST",
      });
      model.revealed = false;
      return model.presentation.mode === "teach"
        ? "Learn this target before its first recall."
        : "Recall the target, then reveal the answer.";
    });
  };

  const finishTeaching = (): void => {
    const current = model.presentation;
    if (current === null) return;
    void run(async () => {
      model.presentation = await requestJson<PreparedMaterial>(
        "/api/study/session/teach",
        {
          method: "POST",
          body: JSON.stringify({
            cardId: current.cardId,
            presentationId: current.id,
          }),
        },
      );
      model.revealed = false;
      return "Teaching complete. Now recall it in a different sentence.";
    });
  };

  const answer = (grade: AnswerGrade): void => {
    const current = model.presentation;
    if (current?.permit === null || current?.permit === undefined) return;
    void run(async () => {
      await requestJson("/api/study/session/answer", {
        method: "POST",
        body: JSON.stringify({
          cardId: current.cardId,
          grade,
          permit: current.permit?.token,
        }),
      });
      model.presentation = null;
      model.revealed = false;
      return "Review recorded once. The Card's next due time is saved.";
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
              <section class="metrics" aria-label="Study status">
                <article><strong>${snapshot.status.stagedCount}</strong><span>staged</span></article>
                <article><strong>${snapshot.status.activeCount}</strong><span>active</span></article>
                <article><strong>${snapshot.status.dueCount}</strong><span>due</span></article>
                <article><strong>${snapshot.status.knownCount}</strong><span>known</span></article>
              </section>

              <section class="panel review-panel" data-testid="review-panel">
                <div class="review-heading">
                  <div>
                    <p class="eyebrow">Fresh validated material</p>
                    <h2>Study</h2>
                  </div>
                  ${
                    model.presentation === null
                      ? html`<button type="button" @click=${startStudy} ?disabled=${model.busy}>
                          Start next Card
                        </button>`
                      : ""
                  }
                </div>
                ${
                  model.presentation === null
                    ? html`<p>Starting Study admits staged Cards under your daily limit, then prepares the first due Card.</p>`
                    : html`<article class="presentation presentation--${model.presentation.mode}">
                        <span class="pill">${model.presentation.mode}</span>
                        <p class="context">${model.presentation.material.context}</p>
                        <p class="prompt">${model.presentation.material.prompt}</p>
                        <p class="japanese" lang="ja">${model.presentation.material.japanese}</p>
                        ${
                          model.presentation.mode === "teach" || model.revealed
                            ? html`<div class="answer" data-testid="material-answer">
                                <strong>${model.presentation.material.answer}</strong>
                                <p class="answer-copy">${model.presentation.material.explanation}</p>
                                <p class="answer-copy">${model.presentation.material.usageNote}</p>
                              </div>`
                            : html`<button type="button" @click=${() => {
                                model.revealed = true;
                                draw();
                              }}>Reveal answer</button>`
                        }
                        ${
                          model.presentation.mode === "teach"
                            ? html`<button type="button" @click=${finishTeaching} ?disabled=${model.busy}>I've studied this — start recall</button>`
                            : model.revealed
                              ? html`<div class="grades" aria-label="Recall grade">
                                  ${(["again", "hard", "good", "easy"] as const).map(
                                    (grade) =>
                                      html`<button type="button" class="secondary" @click=${() => answer(grade)}>${grade}</button>`,
                                  )}
                                </div>`
                              : ""
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
                    <p>${model.provider?.configured ? "API key configured until server restart." : "No API key configured."}</p>
                    <form @submit=${replaceProviderKey}>
                      <label>OpenAI API key <input name="apiKey" type="password" autocomplete="off" required /></label>
                      <button type="submit" ?disabled=${model.busy}>Verify and use key</button>
                    </form>
                    ${
                      model.provider?.configured
                        ? html`<button type="button" class="secondary" @click=${removeProviderKey}>Remove API key</button>`
                        : ""
                    }
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
