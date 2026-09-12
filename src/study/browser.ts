import { html, render, type TemplateResult } from "lit-html";
import {
  extractJapaneseLookupTerm,
  type JishoLookupResult,
  jishoWebUrl,
} from "../dictionary/jisho.ts";
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
import { clearSelection, readSelectedBaseText } from "./selection.ts";
import type { SessionCounts } from "./session-split.ts";

/**
 * A Card as the bank shows it: Study's summary plus whether its teaching has
 * been acknowledged and whether a teaching sentence is banked. Learn walks
 * past a Card with neither.
 */
type BankCard = CardSummary & Readonly<{ taught: boolean; teachable: boolean }>;

const needsTeaching = (card: BankCard): boolean =>
  !card.taught &&
  !card.teachable &&
  card.state !== "known" &&
  card.state !== "suspended";

type BrowserSnapshot = Readonly<{
  cards: readonly BankCard[];
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
  /**
   * One dictionary lookup at a time, raised by highlighting a word in the
   * sentence. Completion is term-guarded so a slow lookup cannot land on a
   * later highlight.
   */
  lookup: {
    term: string;
    status: "loading" | "loaded" | "error";
    result: JishoLookupResult | null;
    message: string;
  } | null;
  /**
   * What the learner is waiting on. A single Review generates and speaks a
   * fresh sentence, which can take most of a minute; disabled buttons alone
   * read as a hang. Ticks every second while set.
   */
  pending: { label: string; detail: string | null; startedAt: number } | null;
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
    lookup: null,
    pending: null,
  };

  const refresh = async (): Promise<void> => {
    [model.snapshot, model.provider] = await Promise.all([
      requestJson<BrowserSnapshot>("/api/study"),
      requestJson<ProviderStatus>("/api/provider"),
    ]);
  };

  const run = async (
    operation: () => Promise<string>,
    pending?: { label: string; detail?: string },
  ): Promise<void> => {
    model.busy = true;
    let ticker: ReturnType<typeof setInterval> | null = null;
    if (pending !== undefined) {
      model.pending = {
        label: pending.label,
        detail: pending.detail ?? null,
        startedAt: Date.now(),
      };
      ticker = setInterval(draw, 1000);
    }
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
      if (ticker !== null) clearInterval(ticker);
      model.pending = null;
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

  // One pronunciation at a time. A rejected play() is the browser's autoplay
  // policy, not a fault: the Listen button is right there.
  let audio: HTMLAudioElement | null = null;
  const playAudio = (url: string): void => {
    audio?.pause();
    audio = new Audio(url);
    audio.play().catch(() => undefined);
  };
  const replayAudio = (): void => {
    const url = model.presentation?.audioUrl;
    if (url) playAudio(url);
  };

  /** Shows a presentation and, when it has audio, says the sentence once. */
  const present = (prepared: PreparedMaterial): void => {
    model.presentation = prepared;
    model.revealed = false;
    if (prepared.audioUrl !== null) playAudio(prepared.audioUrl);
  };

  const closeLookup = (): void => {
    clearSelection(window.getSelection());
    model.lookup = null;
    draw();
  };

  const openLookup = (term: string): void => {
    model.lookup = { term, status: "loading", result: null, message: "" };
    draw();
    void (async () => {
      let next: NonNullable<BrowserModel["lookup"]>;
      try {
        const result = await requestJson<JishoLookupResult>(
          `/api/dictionary/jisho?keyword=${encodeURIComponent(term)}`,
        );
        next = { term, status: "loaded", result, message: "" };
      } catch (cause) {
        const kind = cause instanceof Error ? cause.message : "";
        next = {
          term,
          status: "error",
          result: null,
          message:
            kind === "invalidTerm"
              ? "That highlight is not a Japanese word."
              : "Jisho could not be reached right now.",
        };
      }
      if (model.lookup?.term !== term) return;
      model.lookup = next;
      draw();
    })();
  };

  // A drag frequently ends outside the sentence box, so the listener lives on
  // the document and the range decides whether the highlight is in scope.
  const handleSelectionLookup = (): void => {
    if (model.lookup !== null || model.presentation === null) return;
    const container = root.querySelector("[data-japanese-sentence]");
    if (container === null) return;
    const selected = readSelectedBaseText(window.getSelection(), container);
    if (selected === null) return;
    const term = extractJapaneseLookupTerm(selected);
    if (term === null) return;
    openLookup(term);
  };
  document.addEventListener("mouseup", handleSelectionLookup);
  document.addEventListener("touchend", handleSelectionLookup);

  document.addEventListener("keydown", (event) => {
    if (model.lookup !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLookup();
      }
      return;
    }
    const target = event.target as Element | null;
    if (target?.matches("input, button, select, textarea")) return;
    if (event.key === "r" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      replayAudio();
    }
  });

  /**
   * The sentence with a reading over each written form that needs one.
   *
   * The material already carries the segments, and the validator requires their
   * written parts to rejoin into exactly the sentence, so this cannot drop or
   * duplicate text. A segment whose reading is its own writing is kana already
   * and takes no ruby: putting が over が is noise that pushes the line apart.
   */
  // Names the due Cards Learn walked past, so the fix is a specific sentence
  // to author rather than a hunt through the bank.
  const untaughtMessage = (): string => {
    const now = model.snapshot?.status.observedAt ?? "";
    const names = (model.snapshot?.cards ?? [])
      .filter(
        (card) =>
          needsTeaching(card) &&
          card.state === "active" &&
          card.schedulePhase === "new" &&
          card.dueAt !== null &&
          card.dueAt <= now,
      )
      .map(cardTitle);
    return names.length === 0
      ? "Nothing left to learn has teaching yet. Import sentences with the cards CLI."
      : `No teaching yet for ${names.join(", ")}. Import sentences for them with the cards CLI.`;
  };

  const startLearn = (): void => {
    void run(
      async () => {
        let prepared: PreparedMaterial;
        try {
          prepared = await requestJson<PreparedMaterial>("/api/study/learn", {
            method: "POST",
          });
        } catch (cause) {
          // New Cards show only what the import stored. Anything else is an
          // onboarding gap, not something retrying will fix.
          if (cause instanceof Error && cause.message === "teachingNotPrepared") {
            throw new Error(untaughtMessage());
          }
          throw cause;
        }
        present(prepared);
        return "Learn this target. It goes back in the queue for review.";
      },
      { label: "Opening the next Card to learn…" },
    );
  };

  // A ready batch is the review session: the first banked Card is served
  // without another press, and grading chains the rest. Nothing to serve
  // (every Card failed, or was answered elsewhere) closes the batch plainly.
  const workThroughBatch = (): void => {
    if (model.presentation !== null) return;
    void run(
      async () => {
        const first = await chainBatch("");
        if (first === null) return "Batch closed.";
        if (first === "done") return "Batch complete: nothing left to review.";
        present(first);
        return "Read the sentence, then check the explanation and mark yourself.";
      },
      { label: "Opening the first review…" },
    );
  };

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
            workThroughBatch();
          }
          draw();
        })
        .catch(() => {});
    }, 3_000);
  };

  const startReviewBatch = (): void => {
    if (model.batch !== null && !model.batch.done) return;
    void run(
      async () => {
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
      },
      { label: "Starting a review batch…" },
    );
  };

  // Seen it records the acknowledgement, then keeps the learner in Learn by
  // serving the next untaught Card straight away. The taught Card itself is
  // never chained into its review (Patch 2.9); only the next first exposure
  // follows. Running out is the natural end of the session, not an error:
  // the buttons come back with a plain message.
  const finishTeaching = (): void => {
    const current = model.presentation;
    if (current === null) return;
    void run(
      async () => {
        await requestJson("/api/study/session/teach", {
          method: "POST",
          body: JSON.stringify({
            cardId: current.cardId,
            presentationId: current.id,
          }),
        });
        model.presentation = null;
        let next: PreparedMaterial;
        try {
          next = await requestJson<PreparedMaterial>("/api/study/learn", {
            method: "POST",
          });
        } catch (cause) {
          if (cause instanceof Error && cause.message === "teachingNotPrepared") {
            return "Teaching seen. Nothing more to learn right now.";
          }
          throw cause;
        }
        present(next);
        return "Teaching seen. Here is the next Card to learn.";
      },
      { label: "Teaching seen. Opening the next Card…" },
    );
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
    void run(
      async () => {
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
          present(chained);
          return correct
            ? "Review recorded once. Next batched Card."
            : "Marked for sooner. Next batched Card.";
        }
        if (chained === "done") return "Batch complete.";
        return correct
          ? "Review recorded once. The Card's next due time is saved."
          : "Marked for sooner. The Card's next due time is saved.";
      },
      { label: "Saving your answer…" },
    );
  };

  const lookupDialog = (): TemplateResult | "" => {
    const lookup = model.lookup;
    if (lookup === null) return "";
    const body =
      lookup.status === "loading"
        ? html`<p>Looking up ${lookup.term} on Jisho…</p>`
        : lookup.status === "error"
          ? html`<p role="alert">${lookup.message}</p>`
          : lookup.result === null || lookup.result.entries.length === 0
            ? html`<p>Jisho has no entry for ${lookup.term}. Try highlighting a shorter part of the word.</p>`
            : html`<ul class="lookup-entries">
                ${lookup.result.entries.map(
                  (entry) => html`<li>
                    <p class="lookup-word" lang="ja">
                      <strong>${entry.forms[0]?.word ?? entry.slug}</strong>
                      ${entry.forms[0]?.reading ? html`<span class="lookup-reading">${entry.forms[0].reading}</span>` : ""}
                      ${entry.isCommon ? html`<span class="pill">common</span>` : ""}
                      ${entry.jlpt.map((level) => html`<span class="pill">${level.replace("jlpt-", "")}</span>`)}
                    </p>
                    ${
                      entry.forms.length > 1
                        ? html`<p class="answer-copy" lang="ja">Other forms: ${entry.forms
                            .slice(1)
                            .map((form) =>
                              form.word
                                ? `${form.word}【${form.reading ?? ""}】`
                                : (form.reading ?? ""),
                            )
                            .join("、")}</p>`
                        : ""
                    }
                    <ol class="lookup-senses">
                      ${entry.senses.map(
                        (sense) => html`<li>
                          ${sense.partsOfSpeech.length > 0 ? html`<span class="lookup-pos">${sense.partsOfSpeech.join(", ")}</span>` : ""}
                          <span>${sense.englishDefinitions.join("; ")}</span>
                          ${sense.tags.length > 0 ? html`<span class="lookup-tags">${sense.tags.join(", ")}</span>` : ""}
                          ${sense.seeAlso.length > 0 ? html`<span class="answer-copy">See also: ${sense.seeAlso.join("、")}</span>` : ""}
                        </li>`,
                      )}
                    </ol>
                  </li>`,
                )}
              </ul>`;
    return html`<div class="lookup-backdrop" @click=${closeLookup}>
      <section
        class="lookup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jisho-lookup-title"
        data-testid="jisho-lookup"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <header class="lookup-heading">
          <h2 id="jisho-lookup-title" lang="ja">${lookup.term}</h2>
          <button type="button" class="secondary" @click=${closeLookup} aria-label="Close dictionary lookup" aria-keyshortcuts="Escape">Close</button>
        </header>
        <div id="jisho-lookup-body">${body}</div>
        <p class="answer-copy">
          <a href=${jishoWebUrl(lookup.term)} target="_blank" rel="noopener noreferrer">Open ${lookup.term} on jisho.org ↗</a>
        </p>
      </section>
    </div>`;
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
                    ${
                      model.presentation === null
                        ? html`<p class="review-help">Learn shows the next untaught Card from its stored teaching. Review batch prepares fresh sentences for your due reviews, then works through them. Staged Cards are admitted under your daily limit.</p>`
                        : ""
                    }
                  </div>
                  ${
                    model.presentation === null
                      ? html`<div class="button-row">
                          <button type="button" @click=${startLearn} ?disabled=${model.busy}>
                            Learn new
                          </button>
                          <button type="button" @click=${startReviewBatch} ?disabled=${model.busy || (model.batch !== null && !model.batch.done)}>
                            Review batch
                          </button>
                        </div>`
                      : ""
                  }
                </div>
                ${
                  model.pending !== null
                    ? html`<div class="pending" data-testid="session-progress" aria-live="polite">
                        <div class="pending-bar" aria-hidden="true"></div>
                        <p class="pending-label">
                          ${model.pending.label}
                          <span class="pending-elapsed">${Math.max(0, Math.round((Date.now() - model.pending.startedAt) / 1000))}s</span>
                        </p>
                        ${model.pending.detail !== null ? html`<p class="pending-detail">${model.pending.detail}</p>` : ""}
                      </div>`
                    : ""
                }
                ${
                  model.batch !== null
                    ? html`<p data-testid="batch-progress">
                        ${
                          model.batch.done
                            ? `Batch ready: ${model.batch.completed} to review${model.batch.failed > 0 ? `, ${model.batch.failed} failed and stay due` : ""}. Working through.`
                            : `Batching reviews: ${model.batch.completed} of ${model.batch.total} ready${model.batch.failed > 0 ? `, ${model.batch.failed} failed` : ""}… Fresh sentences for all ${model.batch.total} Cards are requested in one go and land together, usually within a minute or two; then each is checked and spoken.`
                        }
                      </p>`
                    : ""
                }
                ${
                  model.presentation === null
                    ? ""
                    : html`<article class="presentation presentation--${model.presentation.mode}">
                        <span class="pill">${model.presentation.mode}</span>
                        ${
                          // A review opens on its situation. A teach card's
                          // context is only "<target> in use." and its prompt
                          // repeats the answer box heading, so neither earns a
                          // line above the sentence.
                          model.presentation.mode === "review"
                            ? html`<p class="context">${model.presentation.material.context}</p>`
                            : ""
                        }
                        <p class="japanese" lang="ja" data-japanese-sentence>${rubyText(model.presentation.material, model.presentation.material.targetSpan)}</p>
                        <div class="sentence-tools">
                          ${
                            model.presentation.audioUrl !== null
                              ? html`<button type="button" class="secondary listen" @click=${replayAudio} title="Replay pronunciation (R)" aria-keyshortcuts="R" data-testid="listen" data-audio-url=${model.presentation.audioUrl}>🔊 Listen <kbd>R</kbd></button>`
                              : ""
                          }
                          <p class="hint">Highlight a word for Jisho.</p>
                        </div>
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
                              ${
                                needsTeaching(card)
                                  ? html`<span class="pill pill--untaught">no teaching yet</span>`
                                  : ""
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
        ${lookupDialog()}
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
