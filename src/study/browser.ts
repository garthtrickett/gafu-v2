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
  AnswerOutcome,
  CardContent,
  CardStateCommand,
  CardSummary,
  CreateCard,
  KnowledgeSnapshot,
  StudyPreferences,
  StudyStatus,
} from "./contracts.ts";
import { sentencePieces } from "./furigana.ts";
import { openIndexedDbStore } from "./local-store.ts";
import { createOutbox, type OutboxJob, type OutboxState } from "./outbox.ts";
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
  status: StudyStatus;
  session: SessionCounts;
  baseline: Readonly<{
    availability: "available" | "unavailable";
    enabledCount: number;
  }>;
}>;

type BrowserModel = {
  snapshot: BrowserSnapshot | null;
  provider: ProviderStatus | null;
  /** The full knowledge snapshot, loaded only when the baseline panel opens. */
  knowledge: KnowledgeSnapshot | null;
  presentation: PreparedMaterial | null;
  revealed: boolean;
  busy: boolean;
  batch: {
    id: string;
    total: number;
    completed: number;
    completedIds: string[];
    failed: number;
    failures: readonly ReviewBatchProgress["failed"][number][];
    pending: number;
    done: boolean;
    round: number;
    /** Cards already fetched into the session, so a poll never serves one twice. */
    handedIds: string[];
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
  /**
   * The session the browser is walking: every Card's presentation arrived at
   * once, so moving between them costs no round trip. Writes go to the
   * outbox and the next Card shows immediately.
   */
  session: {
    kind: "learn" | "review";
    items: readonly PreparedMaterial[];
    index: number;
  } | null;
  sync: OutboxState;
  offline: boolean;
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

const isAnswerOutcome = (value: unknown): value is AnswerOutcome =>
  typeof value === "object" &&
  value !== null &&
  "card" in value &&
  typeof (value as { card: unknown }).card === "object";

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
): TemplateResult[] =>
  sentencePieces(material.japanese, material.readingSegments, targetSpan).map(
    (piece) => {
      const text =
        piece.reading === null
          ? html`${piece.text}`
          : html`<ruby>${piece.text}<rt>${piece.reading}</rt></ruby>`;
      return piece.target ? html`<span class="target">${text}</span>` : text;
    },
  );

export const mountStudyApp = (root: HTMLElement): void => {
  const model: BrowserModel = {
    snapshot: null,
    provider: null,
    knowledge: null,
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
    session: null,
    sync: { pending: 0, failed: [], stalled: false },
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
  };
  const store = openIndexedDbStore();
  const SESSION_KEY = "session";
  const SNAPSHOT_KEY = "snapshot";

  const refresh = async (): Promise<void> => {
    [model.snapshot, model.provider] = await Promise.all([
      requestJson<BrowserSnapshot>("/api/study"),
      requestJson<ProviderStatus>("/api/provider"),
    ]);
    // The last good bank paints the next load instantly, online or not.
    void store.set(SNAPSHOT_KEY, model.snapshot);
  };

  // Session actions change counts, not the bank, so they refetch only the
  // tiles: one small call instead of the whole Card listing.
  const refreshStatus = async (): Promise<void> => {
    if (model.snapshot === null) return refresh();
    const counts =
      await requestJson<Pick<BrowserSnapshot, "status" | "session">>(
        "/api/study/status",
      );
    const before = model.snapshot.status;
    // A moved staged or active count means admission changed Card states,
    // which the bank listing also shows; only then is the full fetch owed.
    if (
      counts.status.stagedCount !== before.stagedCount ||
      counts.status.activeCount !== before.activeCount
    ) {
      return refresh();
    }
    model.snapshot = { ...model.snapshot, ...counts };
  };

  const loadKnowledge = async (): Promise<void> => {
    model.knowledge = await requestJson<KnowledgeSnapshot>("/api/study/knowledge");
  };

  const run = async (
    operation: () => Promise<string>,
    pending?: { label: string; detail?: string },
    scope: "bank" | "status" = "bank",
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
      await (scope === "status" ? refreshStatus() : refresh());
      model.message = message;
      model.messageKind = "success";
    } catch (cause) {
      if (cause instanceof TypeError) {
        // The network, not the request: say so plainly and keep what is here.
        model.message = "Offline. Showing what was saved on this device.";
        model.messageKind = "neutral";
      } else {
        model.message = cause instanceof Error ? cause.message : String(cause);
        model.messageKind = "error";
      }
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
      await loadKnowledge();
      return enabled
        ? "Baseline word restored to the Known Word Bank."
        : "Baseline word disabled. It will no longer count as known.";
    });
  };

  // Writes the session produces go here and are sent in order behind the
  // learner's back. They live in IndexedDB until sent, so a closed tab or a
  // dropped connection loses nothing; a transport failure waits for the
  // network, a refusal is recorded. The server's answer to a grade updates
  // the bank Card in place, so no bank refetch is owed.
  const applySent = (job: OutboxJob, result: unknown): void => {
    if (model.snapshot === null) return;
    if (job.kind === "answer" && isAnswerOutcome(result)) {
      const outcome = result;
      model.snapshot = {
        ...model.snapshot,
        cards: model.snapshot.cards.map((card) =>
          card.id === outcome.card.id ? { ...card, ...outcome.card } : card,
        ),
      };
    } else if (job.kind === "teach") {
      const cardId = (job.body as { cardId?: string }).cardId;
      model.snapshot = {
        ...model.snapshot,
        cards: model.snapshot.cards.map((card) =>
          card.id === cardId ? { ...card, taught: true } : card,
        ),
      };
    }
    void store.set(SNAPSHOT_KEY, model.snapshot);
  };
  const outbox = createOutbox({
    store,
    transport: (job) =>
      requestJson<unknown>(job.url, { method: "POST", body: JSON.stringify(job.body) }),
    isRetryable: (error) => error instanceof TypeError,
    shouldWait: () => navigator.onLine === false,
    onSent: applySent,
    onChange: (state) => {
      const drained = state.pending === 0 && model.sync.pending > 0;
      model.sync = state;
      draw();
      if (drained) void refreshStatus().then(draw, draw);
    },
  });
  window.addEventListener("online", () => {
    model.offline = false;
    outbox.resume();
    draw();
  });
  window.addEventListener("offline", () => {
    model.offline = true;
    draw();
  });
  window.setInterval(() => {
    if (model.sync.stalled && navigator.onLine !== false) outbox.resume();
  }, 30_000);
  window.addEventListener("beforeunload", (event) => {
    if (model.sync.pending > 0 && !model.sync.stalled) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const enqueue = (
    kind: OutboxJob["kind"],
    label: string,
    url: string,
    body: unknown,
  ): void => outbox.enqueue({ id: crypto.randomUUID(), kind, label, url, body });

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
    // The clip after this one is fetched now, so the next Card speaks at once.
    const next = model.session?.items[model.session.index + 1];
    if (next?.audioUrl) {
      const ahead = new Audio(next.audioUrl);
      ahead.preload = "auto";
      ahead.load();
    }
  };

  const beginSession = (
    kind: "learn" | "review",
    items: readonly PreparedMaterial[],
  ): void => {
    const first = items[0];
    if (first === undefined) return;
    model.session = { kind, items, index: 0 };
    void store.set(SESSION_KEY, model.session);
    present(first);
  };

  /** Moves to the next Card in the session, or ends it. Returns whether one showed. */
  const advanceSession = (): boolean => {
    const session = model.session;
    if (session === null) return false;
    const next = session.items[session.index + 1];
    if (next === undefined) {
      model.session = null;
      model.presentation = null;
      model.revealed = false;
      void store.delete(SESSION_KEY);
      return false;
    }
    model.session = { ...session, index: session.index + 1 };
    void store.set(SESSION_KEY, model.session);
    present(next);
    return true;
  };

  const closeLookup = (): void => {
    clearSelection(window.getSelection());
    model.lookup = null;
    draw();
  };

  const openLookup = (term: string): void => {
    model.lookup = { term, status: "loading", result: null, message: "" };
    draw();
    // The dialog says whether the word counts as known; that needs the
    // baseline, loaded once and kept.
    if (model.knowledge === null) void loadKnowledge().then(draw, draw);
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

  // Highlight, then press Alt (Option on a Mac; both arrive as "Alt"). A
  // drag frequently ends outside the sentence box, so the range decides
  // whether the highlight is in scope, not where the key was pressed.
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

  document.addEventListener("keydown", (event) => {
    if (model.lookup !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLookup();
      }
      return;
    }
    const target = event.target as Element | null;
    // Typing fields keep their letters; a focused button does not need them.
    if (target?.matches("input, select, textarea")) return;
    if (event.key === "Alt" && !event.repeat) {
      event.preventDefault();
      handleSelectionLookup();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "r") {
      event.preventDefault();
      replayAudio();
      return;
    }
    // Grading by key, only when a review's explanation is open: c and i
    // mirror the two buttons and nothing else.
    const grading =
      model.presentation !== null &&
      model.presentation.mode === "review" &&
      model.revealed &&
      !model.busy;
    if (grading && (event.key === "c" || event.key === "i")) {
      event.preventDefault();
      answer(event.key === "c");
      return;
    }
    // e opens a review's explanation, the step before grading.
    if (
      event.key === "e" &&
      model.presentation !== null &&
      model.presentation.mode === "review" &&
      !model.revealed
    ) {
      event.preventDefault();
      model.revealed = true;
      draw();
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
        let items: readonly PreparedMaterial[];
        try {
          ({ items } = await requestJson<{ items: readonly PreparedMaterial[] }>(
            "/api/study/session/learn-all",
            { method: "POST" },
          ));
        } catch (cause) {
          // New Cards show only what the import stored. Anything else is an
          // onboarding gap, not something retrying will fix.
          if (cause instanceof Error && cause.message === "teachingNotPrepared") {
            // The names come from the bank listing, which admission may have
            // just changed; read it fresh before saying which Cards.
            await refresh();
            throw new Error(untaughtMessage());
          }
          throw cause;
        }
        beginSession("learn", items);
        return `Learn this target. ${items.length} Cards to learn are ready; Seen it moves straight on.`;
      },
      { label: "Opening the Cards to learn…" },
      "status",
    );
  };

  // A ready batch is the review session: the first banked Card is served
  // without another press, and grading chains the rest. Nothing to serve
  // (every Card failed, or was answered elsewhere) closes the batch plainly.
  // Reviews start the moment any Card is ready, not when the whole batch is.
  // Cards that already held a reserve are ready on the first poll; the rest
  // land round by round, and each landing is handed over: into the running
  // session if there is one, or as a new session if the learner is waiting.
  const handOver = (cardIds: readonly string[]): void => {
    const batch = model.batch;
    if (batch === null || cardIds.length === 0) return;
    batch.handedIds.push(...cardIds);
    const fetchItems = () =>
      requestJson<{ items: readonly PreparedMaterial[] }>(
        "/api/study/session/review-all",
        {
          method: "POST",
          body: JSON.stringify({ cardIds }),
        },
      );
    if (model.session !== null && model.session.kind === "review") {
      void fetchItems()
        .then(({ items }) => {
          if (model.session === null || model.session.kind !== "review") {
            if (items.length > 0) beginSession("review", items);
          } else {
            model.session = {
              ...model.session,
              items: [...model.session.items, ...items],
            };
            void store.set(SESSION_KEY, model.session);
          }
          draw();
        })
        .catch(() => undefined);
      return;
    }
    if (model.presentation !== null) return;
    void run(
      async () => {
        const { items } = await fetchItems();
        if (items.length === 0) {
          if (model.batch?.done === true) {
            model.batch = null;
            return "Batch complete: nothing left to review.";
          }
          return "Nothing to review yet.";
        }
        beginSession("review", items);
        return "Read the sentence, then check the explanation and mark yourself.";
      },
      { label: "Opening the reviews…" },
      "status",
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
          const handedIds = model.batch.handedIds;
          model.batch = {
            id: batchId,
            total:
              progress.completed.length + progress.failed.length + progress.pending,
            completed: progress.completed.length,
            completedIds: [...progress.completed],
            failed: progress.failed.length,
            failures: [...progress.failed],
            pending: progress.pending,
            done: progress.done,
            round: progress.round,
            handedIds,
          };
          if (progress.done) {
            window.clearInterval(poller);
            model.message =
              progress.failed.length === 0
                ? `Batch ready: ${progress.completed.length} to review.`
                : `Batch ready: ${progress.completed.length} to review, ${progress.failed.length} failed and stay due.`;
            model.messageKind = "success";
          }
          handOver(progress.completed.filter((cardId) => !handedIds.includes(cardId)));
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
          failures: [],
          pending: dispatched.total,
          done: false,
          round: 1,
          handedIds: [],
        };
        draw();
        pollReviewBatch(dispatched.batchId);
        return `Review batch started for ${dispatched.total} Cards.`;
      },
      { label: "Starting a review batch…" },
      "status",
    );
  };

  // Seen it queues the acknowledgement and shows the next Card at once. The
  // taught Card itself is never chained into its review (Patch 2.9); only the
  // next first exposure follows. Running out is the natural end of the
  // session, not an error: the buttons come back with a plain message.
  const finishTeaching = (): void => {
    const current = model.presentation;
    if (current === null) return;
    enqueue(
      "teach",
      `Seen it: ${current.material.targetSurface}`,
      "/api/study/session/teach",
      {
        cardId: current.cardId,
        presentationId: current.id,
      },
    );
    const more = advanceSession();
    model.message = more
      ? "Teaching seen. Here is the next Card to learn."
      : "Teaching seen. Nothing more to learn right now.";
    model.messageKind = "success";
    draw();
    if (!more) void refreshStatus().then(draw, draw);
  };

  // Check yourself against the explanation, then mark it honestly:
  // correct maps to good, incorrect maps to again, and the scheduler never
  // sees a third option. The grade is queued and the next Card shows at once.
  const answer = (correct: boolean): void => {
    const current = model.presentation;
    if (current?.permit === null || current?.permit === undefined) return;
    const permit = current.permit.token;
    enqueue(
      "answer",
      `Grade: ${current.material.targetSurface}`,
      "/api/study/session/answer",
      {
        cardId: current.cardId,
        grade: correct ? "good" : "again",
        permit,
      },
    );
    const more = advanceSession();
    const waiting = !more && model.batch !== null && !model.batch.done;
    if (!more && !waiting) model.batch = null;
    model.message = more
      ? correct
        ? "Review recorded. Next Card."
        : "Marked for sooner. Next Card."
      : waiting
        ? "Reviewed everything that has landed so far. The rest are still being prepared and will open as they arrive."
        : "Batch complete.";
    model.messageKind = "success";
    draw();
    if (!more) void refreshStatus().then(draw, draw);
  };

  const presentationView = (presentation: PreparedMaterial): TemplateResult =>
    html`<article class="presentation presentation--${presentation.mode}">
                        <span class="pill">${presentation.mode}</span>
                        <span class="pill pill--state" data-testid="card-kind">${presentation.material.targetKind}</span>
                        ${
                          // A review opens on its situation. A teach card's
                          // context is only "<target> in use." and its prompt
                          // repeats the answer box heading, so neither earns a
                          // line above the sentence.
                          presentation.mode === "review"
                            ? html`<p class="context">${presentation.material.context}</p>`
                            : ""
                        }
                        <p class="japanese" lang="ja" data-japanese-sentence>${rubyText(presentation.material, presentation.material.targetSpan)}</p>
                        <div class="sentence-tools">
                          ${
                            presentation.audioUrl !== null
                              ? html`<button type="button" class="secondary listen" @click=${replayAudio} title="Replay pronunciation (R)" aria-keyshortcuts="R" data-testid="listen" data-audio-url=${presentation.audioUrl}>🔊 Listen <kbd>R</kbd></button>`
                              : ""
                          }
                          <p class="hint">Highlight a word, then press Alt (Option on Mac) for Jisho.</p>
                        </div>
                        ${
                          presentation.mode === "teach"
                            ? html`<div class="answer" data-testid="material-answer">
                                <strong>${presentation.material.answer}</strong>
                                <p class="answer-copy">${presentation.material.explanation}</p>
                                <p class="answer-copy">${presentation.material.usageNote}</p>
                              </div>
                              <button type="button" @click=${finishTeaching} ?disabled=${model.busy}>Seen it — next Card</button>`
                            : model.revealed
                              ? html`<div class="answer" data-testid="material-answer">
                                  <strong>${presentation.material.answer}</strong>
                                  <p class="answer-copy">${presentation.material.explanation}</p>
                                  <p class="answer-copy">${presentation.material.usageNote}</p>
                                </div>
                                <div class="grades" aria-label="Self grade">
                                  <p>Were you right?</p>
                                  <button type="button" class="secondary" ?disabled=${model.busy} @click=${() => answer(true)} aria-keyshortcuts="c" title="Correct (C)">Correct <kbd aria-hidden="true">C</kbd></button>
                                  <button type="button" class="secondary" ?disabled=${model.busy} @click=${() => answer(false)} aria-keyshortcuts="i" title="Incorrect (I)">Incorrect <kbd aria-hidden="true">I</kbd></button>
                                </div>`
                              : html`<button type="button" aria-keyshortcuts="e" title="Explanation (E)" @click=${() => {
                                  model.revealed = true;
                                  draw();
                                }}>Explanation <kbd aria-hidden="true">E</kbd></button>`
                        }
                      </article>`;

  /**
   * Whether the looked-up word counts as known, and the switch to change
   * that. The validator lets generated sentences lean on every enabled
   * baseline word, so a word the learner does not actually know is best
   * switched off right here, where it was met.
   */
  const knownWordSection = (
    lookup: NonNullable<BrowserModel["lookup"]>,
  ): TemplateResult => {
    const candidates = new Set<string>([lookup.term]);
    for (const entry of lookup.result?.entries ?? []) {
      candidates.add(entry.slug);
      for (const form of entry.forms) {
        if (form.word) candidates.add(form.word);
        if (form.reading) candidates.add(form.reading);
      }
    }
    const card = (model.snapshot?.cards ?? []).find((item) =>
      candidates.has(cardTitle(item)),
    );
    if (card !== undefined) {
      return html`<p class="lookup-known" data-testid="lookup-known">This is one of your Cards (${card.state}).</p>`;
    }
    if (model.knowledge === null) {
      return html`<p class="lookup-known" data-testid="lookup-known">Checking your known words…</p>`;
    }
    const baseline = model.knowledge.baseline.entries.find(
      (entry) => candidates.has(entry.lemma) || candidates.has(entry.reading),
    );
    if (baseline === undefined) {
      return html`<p class="lookup-known" data-testid="lookup-known">Not in your known words, so sentences will not lean on it.</p>`;
    }
    return html`<div class="lookup-known" data-testid="lookup-known">
      <p>
        ${baseline.lemma} · ${baseline.reading} is in your Known Word baseline and
        ${baseline.enabled ? "counts as known." : "is switched off: it does not count as known."}
      </p>
      <button type="button" class="secondary" ?disabled=${model.busy} @click=${() => setBaselineWord(baseline.key, !baseline.enabled)}>
        ${baseline.enabled ? "I don't know this word" : "Restore as known"}
      </button>
    </div>`;
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
        ${knownWordSection(lookup)}
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
          model.sync.pending > 0
            ? html`<p class="syncing" data-testid="syncing" aria-live="polite">Syncing ${model.sync.pending}…</p>`
            : ""
        }
        ${
          model.offline || model.sync.stalled
            ? html`<p class="notice notice--neutral" data-testid="offline">Offline. ${model.sync.pending === 1 ? "1 update" : `${model.sync.pending} updates`} will sync when you're back.</p>`
            : ""
        }
        ${
          model.sync.failed.length > 0
            ? html`<p class="notice notice--error" data-testid="sync-failed">${model.sync.failed.length} updates could not be saved: ${model.sync.failed.join("; ")}. The Cards stay due.</p>`
            : ""
        }

        ${
          snapshot === null
            ? model.presentation !== null
              ? html`<section class="panel review-panel" data-testid="review-panel">${presentationView(model.presentation)}</section>`
              : html`<section class="panel"><p>Opening the local Study database…</p></section>`
            : html`
              <section class="metrics metrics--study" aria-label="Study status">
                <article data-testid="tile-staged"><strong>${snapshot.status.stagedCount}</strong><span>staged</span></article>
                <article data-testid="tile-later"><strong>${snapshot.session.laterCount}</strong><span>not due yet</span></article>
                <article data-testid="tile-learn"><strong>${snapshot.session.learnCount}</strong><span>to learn</span></article>
                <article data-testid="tile-review"><strong>${snapshot.session.reviewCount}</strong><span>to review</span></article>
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
                  model.batch !== null && model.batch.failures.length > 0
                    ? html`<ul class="batch-failures" data-testid="batch-failures">
                        ${model.batch.failures.map((failure) => {
                          const card = model.snapshot?.cards.find(
                            (item) => item.id === failure.cardId,
                          );
                          return html`<li>
                            <strong lang="ja">${card === undefined ? failure.cardId : cardTitle(card)}</strong>
                            stays due: ${failure.reasons.length > 0 ? failure.reasons.join("; ") : failure.kind}
                          </li>`;
                        })}
                      </ul>`
                    : ""
                }
                ${
                  model.batch !== null
                    ? html`<p data-testid="batch-progress">
                        ${
                          model.batch.done
                            ? `Batch ready: ${model.batch.completed} to review${model.batch.failed > 0 ? `, ${model.batch.failed} failed and stay due` : ""}. Working through.`
                            : model.batch.round > 1
                              ? `Batching reviews: ${model.batch.completed} of ${model.batch.total} ready${model.batch.failed > 0 ? `, ${model.batch.failed} failed` : ""}… Round ${model.batch.round} of 3: the ${model.batch.pending} Cards whose sentences were refused are requested again with the reasons attached.`
                              : `Batching reviews: ${model.batch.completed} of ${model.batch.total} ready${model.batch.failed > 0 ? `, ${model.batch.failed} failed` : ""}… Fresh sentences for all ${model.batch.total} Cards are requested in one go, usually within a minute or two; each is checked and spoken, and reviewing starts as soon as any are ready. Refused sentences get up to two more rounds.`
                        }
                      </p>`
                    : ""
                }
                ${
                  model.presentation === null
                    ? ""
                    : presentationView(model.presentation)
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
                    <p data-testid="speech-voice">Speech: ${
                      model.provider?.speech
                        ? `${model.provider.speech.provider} · ${model.provider.speech.voice}`
                        : "off"
                    }</p>
                    <p>${
                      model.provider?.configured
                        ? "API key supplied by the server environment."
                        : "No API key. Set OPENAI_API_KEY on the server and restart."
                    }</p>
                    <p class="privacy-note">Card content and the supporting-language allowlist are sent to OpenAI. Gafu requests no response storage, but OpenAI's retention and abuse-monitoring policies still apply. Video and audio are never sent.</p>
                  </div>
                  <div class="baseline baseline--${snapshot.baseline.availability}">
                    <h3>Known Word baseline</h3>
                    ${
                      snapshot.baseline.availability === "available"
                        ? html`<p>${snapshot.baseline.enabledCount} baseline words enabled.</p>
                            <details class="baseline-words" @toggle=${(
                              event: Event,
                            ) => {
                              if (
                                (event.currentTarget as HTMLDetailsElement).open &&
                                model.knowledge === null
                              ) {
                                void loadKnowledge().then(draw, draw);
                              }
                            }}>
                              <summary>Correct baseline words</summary>
                              <div>
                                ${(model.knowledge?.baseline.entries ?? []).map(
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
  void (async () => {
    // Paint from what this device saved, then pick up the session and the
    // writes a previous page left, then ask the server for the latest.
    const saved = await store.get<BrowserSnapshot>(SNAPSHOT_KEY);
    if (saved !== undefined && "baseline" in saved && "session" in saved)
      model.snapshot = saved;
    const session = await store.get<NonNullable<BrowserModel["session"]>>(SESSION_KEY);
    const current = session?.items[session.index];
    if (session !== undefined && current !== undefined) {
      model.session = session;
      model.presentation = current;
      model.revealed = false;
    }
    model.busy = false;
    draw();
    await outbox.restore();
    void run(async () => {
      await refresh();
      return model.session !== null
        ? "Picking up where you left off."
        : "Card bank ready. No Cards are admitted until study asks for a queue.";
    });
  })();
};
