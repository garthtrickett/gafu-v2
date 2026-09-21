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
const kanjiOnly = /^[一-鿿々〆]+$/u;
// Katakana and hiragana are the same syllables; a written カ must match a reading か.
const toHiragana = (value: string): string =>
  value.replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));

// Three kana are written one way and said another when they work as
// particles: 私は is わたしは or わたしわ depending on whether the writer
// spelled the sound or the word. Both are the same reading, so both match.
const spokenAs: Readonly<Record<string, string>> = { は: "わ", へ: "え", を: "お" };
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
/**
 * How many of the writing's kana had to be read as their spoken variant for
 * it to sit at this point of the reading, or null if it does not sit here.
 *
 * は is spoken わ, so the tolerance has to exist; but it is a concession, not
 * a preference. 今日は私 read きょうはわたし can be cut with 今日 taking きょうは
 * and the particle then matching the わ of わたし, which is both wrong and
 * perfectly even — so evenness alone chooses it. Counting the concessions
 * and preferring the cut that makes fewest settles it: the cut where は is
 * simply は.
 */
const literalAt = (reading: string, at: number, text: string): number | null => {
  const written = toHiragana(text);
  let spoken = 0;
  for (let index = 0; index < written.length; index += 1) {
    const want = written[index] as string;
    const got = reading[at + index];
    if (got === undefined) return null;
    if (got === want) continue;
    if (spokenAs[want] === got) {
      spoken += 1;
      continue;
    }
    return null;
  }
  return spoken;
};

/** Longest reading a kanji run is allowed, and the work budget for the walk. */
const MOST_KANA_PER_KANJI = 4;
const SPLIT_BUDGET = 20_000;

/**
 * Every way the reading can be cut so that each non-kanji run matches itself.
 *
 * There is usually more than one, and which one is taken is the whole
 * problem. 我々は原因 read われわれはげんいん can be cut at either わ — the one
 * inside われわれ or the particle — because は is spoken わ and the pattern has
 * to allow that. Taking the first cut gave 我々 the reading われ and 原因 the
 * reading れはげんいん.
 */
const splits = (
  runs: readonly { text: string; kanji: boolean }[],
  reading: string,
  minimumPerKanji: 0 | 1,
): { split: string[]; spoken: number }[] => {
  const hiragana = toHiragana(reading);
  const found: { split: string[]; spoken: number }[] = [];
  let budget = SPLIT_BUDGET;
  const walk = (index: number, at: number, taken: string[], spoken: number): void => {
    if (budget <= 0) return;
    budget -= 1;
    const run = runs[index];
    if (run === undefined) {
      if (at === reading.length) found.push({ split: [...taken], spoken });
      return;
    }
    if (!run.kanji) {
      const concessions = literalAt(hiragana, at, run.text);
      if (concessions !== null) {
        walk(index + 1, at + run.text.length, taken, spoken + concessions);
      }
      return;
    }
    const least = Math.max(1, run.text.length * minimumPerKanji);
    const most = Math.min(
      reading.length - at,
      run.text.length * MOST_KANA_PER_KANJI + 3,
    );
    for (let length = least; length <= most; length += 1) {
      taken.push(reading.slice(at, at + length));
      walk(index + 1, at + length, taken, spoken);
      taken.pop();
    }
  };
  walk(0, 0, [], 0);
  return found;
};

/**
 * How unevenly a cut shares the reading out among the kanji.
 *
 * Kanji in a compound run about two kana each, and a cut that gives one run
 * a kana and the next three has almost certainly taken a kana belonging to
 * the first. Neither preferring the shortest first run nor the longest gets
 * both 我々は原因 and 彼女の能力 right — the balanced cut does. Where two cuts
 * are equally balanced the earlier one is kept, which is how 彼女 keeps かのじょ
 * rather than borrowing the particle's の.
 */
const unevenness = (
  runs: readonly { text: string; kanji: boolean }[],
  split: readonly string[],
): number => {
  const kanji = runs.filter((run) => run.kanji);
  const per = kanji.map((run, index) => (split[index]?.length ?? 0) / run.text.length);
  const mean = per.reduce((total, value) => total + value, 0) / per.length;
  return per.reduce((total, value) => total + (value - mean) ** 2, 0) / per.length;
};

const placedWith = (
  written: string,
  reading: string,
  /**
   * Least kana a kanji run may be given, per character. One first, because no
   * kanji is read as nothing and the floor rules out the worst cuts outright;
   * zero second, as a fallback, so a reading this cannot explain is still
   * placed rather than refused — readingFits shares this code, and a stricter
   * rule alone would start rejecting generations that place fine today.
   */
  minimumPerKanji: 0 | 1,
): readonly FuriganaPiece[] | null => {
  const runs: { text: string; kanji: boolean }[] = [];
  let cursor = 0;
  for (const match of written.matchAll(kanjiRun)) {
    const start = match.index ?? 0;
    if (start > cursor) runs.push({ text: written.slice(cursor, start), kanji: false });
    runs.push({ text: match[0], kanji: true });
    cursor = start + match[0].length;
  }
  if (cursor < written.length) runs.push({ text: written.slice(cursor), kanji: false });
  // Fewest concessions to a spoken variant, then the most evenly shared cut,
  // then the earliest — the order of how much each one tells us.
  //
  // Penalising a run that ends on the kana written after it was tried too,
  // to keep 部屋 from taking the particle in 部屋は初めて. It cannot be done
  // positionally: 建物 and 食べ物 end in の before a の because the words do,
  // and the rule took their last kana away. Without a dictionary the two
  // cases look identical, so the rule is left out and 部屋は初めて is left
  // wrong — one sentence in the learner's two thousand.
  const rank = (candidate: { split: string[]; spoken: number }): readonly number[] => [
    candidate.spoken,
    unevenness(runs, candidate.split),
  ];
  const best = splits(runs, reading, minimumPerKanji).reduce<{
    split: readonly string[];
    rank: readonly number[];
  } | null>((chosen, candidate) => {
    const scored = { split: candidate.split, rank: rank(candidate) };
    if (chosen === null) return scored;
    for (const [index, value] of scored.rank.entries()) {
      const against = chosen.rank[index] ?? 0;
      if (value !== against) return value < against ? scored : chosen;
    }
    return chosen;
  }, null);
  if (best === null) return null;
  const pieces: FuriganaPiece[] = [];
  let taken = 0;
  for (const run of runs) {
    if (run.kanji) {
      pieces.push({ text: run.text, reading: best.split[taken] ?? "" });
      taken += 1;
    } else {
      pieces.push({ text: run.text, reading: null });
    }
  }
  return pieces;
};

const placed = (written: string, reading: string): readonly FuriganaPiece[] | null =>
  placedWith(written, reading, 1) ?? placedWith(written, reading, 0);

/** Whitespace is how a model separates words in a reading; the writing has none. */
const spoken = (rawReading: string): string => rawReading.replace(/\s+/gu, "");

/** Whether a reading can be placed over its writing, run by run. */
export const readingFits = (written: string, rawReading: string): boolean => {
  const reading = spoken(rawReading);
  if (reading === "" || reading === written || !hasKanji(written)) return true;
  return placed(written, reading) !== null;
};

export const alignFurigana = (
  written: string,
  rawReading: string,
): readonly FuriganaPiece[] => {
  const reading = spoken(rawReading);
  if (reading === "" || reading === written || !hasKanji(written)) {
    return [{ text: written, reading: null }];
  }
  const runs = placed(written, reading);
  if (runs !== null) return runs;
  // The reading does not explain the writing, so it cannot be placed run by
  // run. Trimming the shared edges sometimes still lands it on the kanji;
  // when it does not, the writing is shown alone. Ruby over kana is not a
  // reading of anything — it is a second copy of the line, in the wrong
  // place, teaching a kana its own sound.
  const trimmed = edgeTrimmed(written, reading);
  return trimmed.every((piece) => piece.reading === null || kanjiOnly.test(piece.text))
    ? trimmed
    : [{ text: written, reading: null }];
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
