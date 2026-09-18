import { html, render, type TemplateResult } from "lit-html";
import { createJishoLookup } from "../dictionary/lookup-panel.ts";
import { mutationHeaders } from "../local-api.ts";
import { sentencePieces } from "../study/furigana.ts";
import type { Reading, ReadingSentence, TaleWord } from "./contracts.ts";

type TaleListing = Readonly<{
  id: string;
  title: string;
  titleReading: string;
  titleEnglish: string;
  provenance: string;
  sentenceCount: number;
  words: readonly TaleWord[];
  generatedAt: string | null;
}>;

type Model = {
  tales: readonly TaleListing[] | null;
  reading: Reading | null;
  /** Sentences whose English the reader has asked to see. */
  revealed: Set<number>;
  /** Tale words already sent to the bank this visit. */
  added: Set<string>;
  busy: boolean;
  /** How far a tale being written has got, so a long wait can be watched. */
  progress: { written: number; total: number; failed: number } | null;
  message: string;
  messageKind: "neutral" | "success" | "error";
};

const request = async <Value>(url: string, init?: RequestInit): Promise<Value> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...Object.fromEntries(mutationHeaders(init?.headers)),
    },
  });
  const body = (await response.json()) as
    | Value
    | { error?: { kind?: string }; detail?: string };
  if (!response.ok) {
    const failure =
      typeof body === "object" && body !== null && "error" in body ? body : null;
    const kind = failure?.error?.kind;
    throw new Error(
      failure?.detail === undefined
        ? (kind ?? `requestFailed:${response.status}`)
        : `${kind ?? "failed"} — ${failure.detail}`,
    );
  }
  return body as Value;
};

export const mountReadingApp = (root: HTMLElement): void => {
  const model: Model = {
    tales: null,
    reading: null,
    revealed: new Set<number>(),
    added: new Set<string>(),
    busy: false,
    progress: null,
    message: "",
    messageKind: "neutral",
  };

  const draw = (): void => {
    render(view(), root);
  };

  // Reading is where an unknown word is met, so the dictionary belongs here
  // most of all: highlight a word, press Alt, and Jisho opens over the tale.
  // A tale's own new word is glossed beneath its sentence, but every other
  // word is one the reader is only supposed to know — and sometimes doesn't.
  const lookup = createJishoLookup({ root, draw: () => draw() });

  document.addEventListener("keydown", (event) => {
    lookup.handleKeydown(event);
  });

  const run = async (operation: () => Promise<string>): Promise<void> => {
    model.busy = true;
    draw();
    try {
      model.message = await operation();
      model.messageKind = "success";
    } catch (cause) {
      model.message = cause instanceof Error ? cause.message : String(cause);
      model.messageKind = "error";
    } finally {
      model.busy = false;
      draw();
    }
  };

  const loadTales = (): Promise<void> =>
    run(async () => {
      const body = await request<{ tales: readonly TaleListing[] }>(
        "/api/reading/tales",
      );
      model.tales = body.tales;
      model.reading = null;
      return "Pick a tale.";
    });

  const openTale = (id: string): void => {
    void run(async () => {
      const reading = await request<Reading>(`/api/reading/${encodeURIComponent(id)}`);
      model.reading = reading;
      model.revealed = new Set<number>();
      return `${reading.title} — ${reading.sentences.length} sentences.`;
    });
  };

  /**
   * Writes a tale, one sentence per poll.
   *
   * A hundred sentences is a hundred generations, so nothing waits on the
   * whole tale: the dispatch lays out the beats and each poll writes one and
   * says how far it has got. What is written is kept, so closing the tab
   * costs the sentence in flight and nothing more.
   */
  const writeTale = (id: string): void => {
    void run(async () => {
      const started = await request<{ total: number }>(
        `/api/reading/${encodeURIComponent(id)}`,
        { method: "POST", body: JSON.stringify({}) },
      );
      model.progress = { written: 0, total: started.total, failed: 0 };
      draw();
      for (;;) {
        const step = await request<{
          total: number;
          written: number;
          failed: number;
          done: boolean;
          reasons: readonly string[];
        }>(`/api/reading/${encodeURIComponent(id)}/progress`);
        model.progress = {
          written: step.written,
          total: step.total,
          failed: step.failed,
        };
        draw();
        if (!step.done) continue;
        model.progress = null;
        if (step.written === 0) {
          throw new Error(
            step.reasons.length === 0
              ? "no sentence could be written"
              : step.reasons.join("; "),
          );
        }
        const reading = await request<Reading>(
          `/api/reading/${encodeURIComponent(id)}`,
        );
        model.reading = reading;
        model.revealed = new Set<number>();
        return step.failed === 0
          ? `${reading.title} written in ${reading.sentences.length} sentences.`
          : `${reading.title} written in ${reading.sentences.length} sentences; ${step.failed} could not be written and are left out.`;
      }
    });
  };

  const addWord = (word: TaleWord): void => {
    void run(async () => {
      await request("/api/study/cards", {
        method: "POST",
        body: JSON.stringify({
          type: "vocabulary",
          content: {
            lemma: word.lemma,
            reading: word.reading,
            partOfSpeech: word.partOfSpeech,
            meaning: word.meaning,
            usageNotes: `Met while reading ${model.reading?.title ?? "a tale"}.`,
          },
          stagingPriority: 9_000,
        }),
      });
      model.added.add(word.lemma);
      return `${word.lemma} staged as a Card.`;
    });
  };

  /** The sentence, with ruby over the kanji and the new word set apart. */
  const sentenceView = (sentence: ReadingSentence): TemplateResult => {
    const pieces = sentencePieces(
      sentence.japanese,
      sentence.segments,
      sentence.wordSpan,
    );
    const shown = model.revealed.has(sentence.index);
    return html`<article class="reading-sentence" data-testid="reading-sentence">
      <p class="japanese" lang="ja" data-japanese-sentence>
        ${pieces.map((piece) =>
          piece.reading === null
            ? html`<span class=${piece.target ? "target" : ""}>${piece.text}</span>`
            : html`<ruby class=${piece.target ? "target" : ""}
                >${piece.text}<rt>${piece.reading}</rt></ruby
              >`,
        )}
      </p>
      ${
        sentence.word === null
          ? ""
          : html`<p class="reading-word" data-testid="reading-word">
              <strong lang="ja">${sentence.word.lemma}</strong>
              <span lang="ja">（${sentence.word.reading}）</span>
              <span>${sentence.word.meaning}</span>
              ${
                model.added.has(sentence.word.lemma)
                  ? html`<span class="pill pill--ready">staged</span>`
                  : html`<button
                      type="button"
                      class="secondary"
                      ?disabled=${model.busy}
                      @click=${() => addWord(sentence.word as TaleWord)}
                    >
                      Add as a Card
                    </button>`
              }
            </p>`
      }
      ${
        shown
          ? html`<p class="reading-english" data-testid="reading-english">
              ${sentence.english}
            </p>`
          : html`<button
              type="button"
              class="secondary"
              @click=${() => {
                model.revealed.add(sentence.index);
                draw();
              }}
            >
              What does it say?
            </button>`
      }
    </article>`;
  };

  const view = (): TemplateResult => html`<main class="study-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Gafu V2 · Reading</p>
        <h1>Tales told in the words you have.</h1>
        <p>
          Each tale is written fresh against your own vocabulary: every sentence uses
          words you know, except for the one word the tale cannot be told without.
        </p>
        <p class="hint">Highlight a word, then press Alt (Option on Mac) for Jisho.</p>
      </div>
      <nav class="button-row">
        <a class="button-link secondary" href="/">Study</a>
        ${
          model.reading === null
            ? ""
            : html`<button type="button" class="secondary" @click=${() => void loadTales()}>
                All tales
              </button>`
        }
      </nav>
    </header>
    ${
      model.progress === null
        ? ""
        : html`<p class="notice" data-testid="reading-progress">
            Writing sentence ${model.progress.written + 1} of ${model.progress.total}…
            ${model.progress.failed === 0 ? "" : ` ${model.progress.failed} refused so far.`}
          </p>`
    }
    ${
      model.message === ""
        ? ""
        : html`<p
            role="status"
            class=${model.messageKind === "error" ? "notice notice--error" : "notice notice--success"}
          >
            ${model.message}
          </p>`
    }
    ${model.reading === null ? taleList() : readingView(model.reading)}
    ${lookup.dialog()}
  </main>`;

  const taleList = (): TemplateResult =>
    model.tales === null
      ? html`<p class="empty">Loading tales…</p>`
      : html`<section class="panel">
          <h2>Tales</h2>
          <div class="card-list" data-testid="tale-list">
            ${model.tales.map(
              (tale) => html`<article class="bank-card" data-tale-id=${tale.id}>
                <div class="card-copy">
                  <h3 lang="ja">${tale.title}<span class="pill">${tale.titleReading}</span></h3>
                  <p>${tale.titleEnglish} · ${tale.sentenceCount} sentences</p>
                  <p class="answer-copy">${tale.provenance}</p>
                  <p class="answer-copy">
                    ${
                      tale.words.length === 0
                        ? "You already know every word this tale needs."
                        : html`New words: ${tale.words.map((word) => word.lemma).join("、")}`
                    }
                  </p>
                </div>
                <div class="button-row">
                  ${
                    tale.generatedAt === null
                      ? ""
                      : html`<button
                          type="button"
                          ?disabled=${model.busy}
                          @click=${() => openTale(tale.id)}
                        >
                          Read it
                        </button>`
                  }
                  <button
                    type="button"
                    class="secondary"
                    ?disabled=${model.busy}
                    @click=${() => writeTale(tale.id)}
                  >
                    ${tale.generatedAt === null ? "Write it" : "Write it again"}
                  </button>
                </div>
              </article>`,
            )}
          </div>
        </section>`;

  const readingView = (reading: Reading): TemplateResult => html`<section
    class="panel"
    data-testid="reading"
  >
    <h2 lang="ja">${reading.title}</h2>
    <p>${reading.titleEnglish} · ${reading.provenance}</p>
    ${reading.sentences.map(sentenceView)}
  </section>`;

  draw();
  void loadTales();
};
