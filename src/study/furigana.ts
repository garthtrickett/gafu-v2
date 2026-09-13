/**
 * Where a reading sits over a written form.
 *
 * A reading covering a whole written form prints its okurigana twice: 広い
 * reads ひろい, so ruby over the segment shows い as writing and again above
 * it. The kana at each end belong to both, so trimming the ones they agree on
 * leaves 広 carrying ひろ and い standing as itself.
 */
export type FuriganaSplit = Readonly<{
  /** Kana before the reading starts, shown as itself. */
  before: string;
  /** The written form the reading sits over. Empty when none does. */
  body: string;
  /** The reading for `body`. */
  over: string;
  /** Kana after the reading ends, shown as itself. */
  after: string;
}>;

const kanji = /[一-鿿々]/u;
const kana = /^[぀-ヿー]$/u;

export const hasKanji = (value: string): boolean => kanji.test(value);

export const splitFurigana = (written: string, reading: string): FuriganaSplit => {
  // A form with no kanji, or one whose reading is its own writing, is already
  // readable: が over が is noise that only pushes the line apart.
  if (reading === "" || reading === written || !hasKanji(written)) {
    return { before: written, body: "", over: "", after: "" };
  }
  let start = 0;
  while (
    start < written.length &&
    start < reading.length &&
    written[start] === reading[start] &&
    kana.test(written[start] as string)
  ) {
    start += 1;
  }
  let end = 0;
  while (
    end < written.length - start &&
    end < reading.length - start &&
    written[written.length - 1 - end] === reading[reading.length - 1 - end] &&
    kana.test(written[written.length - 1 - end] as string)
  ) {
    end += 1;
  }
  const body = written.slice(start, written.length - end);
  const over = reading.slice(start, reading.length - end);
  // Trimming that consumes either side leaves nothing to annotate.
  if (body === "" || over === "") {
    return { before: written, body: "", over: "", after: "" };
  }
  return {
    before: written.slice(0, start),
    body,
    over,
    after: end === 0 ? "" : written.slice(written.length - end),
  };
};

/** One run of a written form: kanji with the reading over it, or writing shown as itself. */
export type FuriganaPiece = Readonly<{ text: string; reading: string | null }>;

const kanjiRun = /[一-鿿々〆]+/gu;
const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
// Katakana and hiragana are the same syllables; a written カ must match a reading か.
const toHiragana = (value: string): string =>
  value.replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));

const edgeTrimmed = (written: string, reading: string): readonly FuriganaPiece[] => {
  const { before, body, over, after } = splitFurigana(written, reading);
  if (body === "") return [{ text: written, reading: null }];
  const pieces: FuriganaPiece[] = [];
  if (before !== "") pieces.push({ text: before, reading: null });
  pieces.push({ text: body, reading: over });
  if (after !== "") pieces.push({ text: after, reading: null });
  return pieces;
};

/**
 * Aligns a reading to its written form so only the kanji carry ruby.
 *
 * A segment can be a whole phrase — 噂だけでなく、 reading うわさだけでなく、
 * — with kana and punctuation before, after, and between its kanji. Every
 * non-kanji run of the writing must appear literally in the reading, so the
 * writing is turned into a pattern: kanji runs match any reading, everything
 * else matches itself. What each kanji run captured is its furigana. A
 * reading the pattern cannot explain falls back to trimming the shared edges,
 * so nothing renders worse than it did.
 */
export const alignFurigana = (
  written: string,
  rawReading: string,
): readonly FuriganaPiece[] => {
  // A model sometimes spaces a reading between words; the writing has no such
  // spaces, so they would defeat the match. Readings carry no whitespace.
  const reading = rawReading.replace(/\s+/gu, "");
  if (reading === "" || reading === written || !hasKanji(written)) {
    return [{ text: written, reading: null }];
  }
  const runs: { text: string; kanji: boolean }[] = [];
  let cursor = 0;
  for (const match of written.matchAll(kanjiRun)) {
    const start = match.index ?? 0;
    if (start > cursor) runs.push({ text: written.slice(cursor, start), kanji: false });
    runs.push({ text: match[0], kanji: true });
    cursor = start + match[0].length;
  }
  if (cursor < written.length) runs.push({ text: written.slice(cursor), kanji: false });
  const pattern = new RegExp(
    `^${runs.map((run) => (run.kanji ? "(.+?)" : escapeRegExp(toHiragana(run.text)))).join("")}$`,
    "u",
  );
  const matched = pattern.exec(toHiragana(reading));
  if (matched === null) return edgeTrimmed(written, reading);
  // Kana normalisation keeps every length, so the captures' positions in the
  // normalised reading are their positions in the original.
  const pieces: FuriganaPiece[] = [];
  let offset = 0;
  let group = 1;
  for (const run of runs) {
    if (run.kanji) {
      const captured = matched[group] ?? "";
      group += 1;
      pieces.push({
        text: run.text,
        reading: reading.slice(offset, offset + captured.length),
      });
      offset += captured.length;
    } else {
      pieces.push({ text: run.text, reading: null });
      offset += run.text.length;
    }
  }
  return pieces;
};

/** A piece of a sentence as rendered: text, its ruby, and whether it is the target. */
export type SentencePiece = FuriganaPiece & Readonly<{ target: boolean }>;

/**
 * The whole sentence as pieces, with the target coloured by its character
 * span rather than by segment. A model may hand back one segment for the
 * entire sentence; colouring segments would then paint the whole line. Plain
 * text is cut at the span's edges; a kanji run with a reading cannot be cut,
 * so it is coloured if it overlaps the span at all. When the segments do not
 * rejoin into the sentence, offsets mean nothing and nothing is coloured.
 */
export const sentencePieces = (
  japanese: string,
  segments: readonly Readonly<{ written: string; reading: string }>[],
  span: Readonly<{ start: number; end: number }> | null,
): readonly SentencePiece[] => {
  const colourable =
    span !== null && segments.map((segment) => segment.written).join("") === japanese;
  const pieces: SentencePiece[] = [];
  let offset = 0;
  for (const segment of segments) {
    for (const piece of alignFurigana(segment.written, segment.reading)) {
      const start = offset;
      const end = offset + piece.text.length;
      offset = end;
      if (!colourable || span === null) {
        pieces.push({ ...piece, target: false });
        continue;
      }
      if (piece.reading !== null) {
        // A ruby run cannot be cut, so it is coloured whole when it overlaps
        // the span — unless it dwarfs the span, as a whole-sentence fallback
        // does, in which case colouring it would paint the line, not the word.
        const overlaps = start < span.end && end > span.start;
        const modest = end - start <= span.end - span.start + 4;
        pieces.push({ ...piece, target: overlaps && modest });
        continue;
      }
      // Plain text: split at the span's edges so only the target is coloured.
      const cuts = [
        start,
        Math.min(Math.max(span.start, start), end),
        Math.min(Math.max(span.end, start), end),
        end,
      ];
      for (let index = 0; index < 3; index += 1) {
        const from = cuts[index] ?? start;
        const to = cuts[index + 1] ?? end;
        if (to <= from) continue;
        pieces.push({
          text: piece.text.slice(from - start, to - start),
          reading: null,
          target: from >= span.start && to <= span.end,
        });
      }
    }
  }
  return pieces;
};
