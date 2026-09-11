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
