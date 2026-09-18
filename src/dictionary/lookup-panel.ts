import { html, type TemplateResult } from "lit-html";
import { clearSelection, readSelectedBaseText } from "../study/selection.ts";
import {
  extractJapaneseLookupTerm,
  type JishoLookupResult,
  jishoWebUrl,
} from "./jisho.ts";

/**
 * One dictionary lookup at a time, raised by highlighting a word and pressing
 * Alt. Completion is term-guarded so a slow lookup cannot land on a later
 * highlight.
 */
type LookupState = Readonly<{
  term: string;
  status: "loading" | "loaded" | "error";
  result: JishoLookupResult | null;
  message: string;
}> | null;

export type JishoLookup = Readonly<{
  /**
   * Returns whether the lookup took the key. An open dialog swallows the
   * page's own shortcuts, so a caller that gets `true` must stop.
   */
  handleKeydown: (event: KeyboardEvent) => boolean;
  dialog: () => TemplateResult | "";
  isOpen: () => boolean;
  close: () => void;
}>;

/**
 * The Jisho panel, shared by every page that shows Japanese to read.
 *
 * Highlight a word, press Alt (Option on a Mac; both arrive as "Alt"), and
 * the dictionary opens over the page. A drag frequently ends outside the
 * sentence box, so the range decides whether the highlight is in scope, not
 * where the key was pressed — and a page may show many sentences, so every
 * one of them is in scope rather than only the first.
 */
export const createJishoLookup = (options: {
  /** Where to look for sentences: any `[data-japanese-sentence]` under it. */
  root: ParentNode;
  draw: () => void;
  /** Whether a lookup may be raised at all right now. Defaults to always. */
  canLookUp?: () => boolean;
  /** Raised when a lookup opens, for a page that must load something first. */
  onOpen?: () => void;
  /** An extra block under the entries: Study says whether the word is known. */
  extraSection?: (
    term: string,
    result: JishoLookupResult | null,
  ) => TemplateResult | "";
}): JishoLookup => {
  let state: LookupState = null;

  const close = (): void => {
    clearSelection(window.getSelection());
    state = null;
    options.draw();
  };

  const open = (term: string): void => {
    state = { term, status: "loading", result: null, message: "" };
    options.draw();
    options.onOpen?.();
    void (async () => {
      let next: NonNullable<LookupState>;
      try {
        const response = await fetch(
          `/api/dictionary/jisho?keyword=${encodeURIComponent(term)}`,
        );
        const body = (await response.json()) as
          | JishoLookupResult
          | { error?: { kind?: string } };
        if (!response.ok) {
          const kind =
            typeof body === "object" && body !== null && "error" in body
              ? body.error?.kind
              : undefined;
          throw new Error(kind ?? `requestFailed:${response.status}`);
        }
        next = {
          term,
          status: "loaded",
          result: body as JishoLookupResult,
          message: "",
        };
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
      if (state?.term !== term) return;
      state = next;
      options.draw();
    })();
  };

  const handleSelection = (): void => {
    if (state !== null) return;
    if (options.canLookUp?.() === false) return;
    const selection = window.getSelection();
    for (const container of options.root.querySelectorAll("[data-japanese-sentence]")) {
      const selected = readSelectedBaseText(selection, container);
      if (selected === null) continue;
      const term = extractJapaneseLookupTerm(selected);
      if (term === null) return;
      open(term);
      return;
    }
  };

  const handleKeydown = (event: KeyboardEvent): boolean => {
    if (state !== null) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      return true;
    }
    const target = event.target as Element | null;
    // Typing fields keep their letters; a focused button does not need them.
    if (target?.matches("input, select, textarea")) return false;
    if (event.key === "Alt" && !event.repeat) {
      event.preventDefault();
      handleSelection();
      return true;
    }
    return false;
  };

  const dialog = (): TemplateResult | "" => {
    const lookup = state;
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
    return html`<div class="lookup-backdrop" @click=${close}>
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
          <button type="button" class="secondary" @click=${close} aria-label="Close dictionary lookup" aria-keyshortcuts="Escape">Close</button>
        </header>
        <div id="jisho-lookup-body">${body}</div>
        ${options.extraSection?.(lookup.term, lookup.result) ?? ""}
        <p class="answer-copy">
          <a href=${jishoWebUrl(lookup.term)} target="_blank" rel="noopener noreferrer">Open ${lookup.term} on jisho.org ↗</a>
        </p>
      </section>
    </div>`;
  };

  return { handleKeydown, dialog, isOpen: () => state !== null, close };
};
