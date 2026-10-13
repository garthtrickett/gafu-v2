import { createHash } from "node:crypto";
import type { ReadingSegment } from "../learning-material/contracts.ts";
import { err, ok, type Result } from "../result.ts";

export type AuthoredSentence = Readonly<{
  speaker?: string;
  japanese: string;
  english: string;
  segments: readonly ReadingSegment[] | null;
}>;

export type AuthoredPassage = Readonly<{
  id: string;
  title: string;
  titleReading: string;
  titleEnglish: string;
  paragraphs: readonly (readonly AuthoredSentence[])[];
}>;

type JsonObject = {
  format?: unknown;
  version?: unknown;
  title?: unknown;
  titleReading?: unknown;
  titleEnglish?: unknown;
  paragraphs?: unknown;
  japanese?: unknown;
  english?: unknown;
  segments?: unknown;
  written?: unknown;
  reading?: unknown;
  speaker?: unknown;
};

const object = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;

/** Decode the file before analyzing or writing any sentence. */
export const decodePassage = (value: unknown): Result<AuthoredPassage, string> => {
  const source = object(value);
  if (source?.format !== "gafu-passage" || source.version !== 1) {
    return err("Expected a Gafu passage file (format gafu-passage, version 1).");
  }
  if (
    !boundedText(source.title, 120) ||
    !boundedText(source.titleEnglish, 240) ||
    (source.titleReading !== undefined &&
      (typeof source.titleReading !== "string" || source.titleReading.length > 240))
  ) {
    return err("A passage needs a title and English title.");
  }
  const title = source.title;
  const titleReading = (source.titleReading as string | undefined) ?? "";
  const titleEnglish = source.titleEnglish;
  if (
    !Array.isArray(source.paragraphs) ||
    source.paragraphs.length < 1 ||
    source.paragraphs.length > 12
  ) {
    return err("Use 1–12 paragraphs, each containing sentences.");
  }
  const paragraphs: AuthoredSentence[][] = [];
  let count = 0;
  for (const [paragraphIndex, rawParagraph] of source.paragraphs.entries()) {
    if (!Array.isArray(rawParagraph) || rawParagraph.length === 0) {
      return err(`Paragraph ${paragraphIndex + 1} needs at least one sentence.`);
    }
    const paragraph: AuthoredSentence[] = [];
    for (const [sentenceIndex, rawSentence] of rawParagraph.entries()) {
      const sentence = object(rawSentence);
      if (
        !boundedText(sentence?.japanese, 500) ||
        !boundedText(sentence?.english, 700)
      ) {
        return err(
          `Paragraph ${paragraphIndex + 1}, sentence ${sentenceIndex + 1} needs Japanese and English text.`,
        );
      }
      if (
        sentence.speaker !== undefined &&
        (!boundedText(sentence.speaker, 60) || /[\r\n]/u.test(sentence.speaker))
      ) {
        return err(
          `Paragraph ${paragraphIndex + 1}, sentence ${sentenceIndex + 1} needs a speaker name of 1–60 characters on one line.`,
        );
      }
      let segments: readonly ReadingSegment[] | null = null;
      if (sentence.segments !== undefined) {
        if (
          !Array.isArray(sentence.segments) ||
          sentence.segments.length === 0 ||
          sentence.segments.length > 200 ||
          !sentence.segments.every((segment: unknown) => {
            const item = object(segment);
            return (
              boundedText(item?.written, 500) &&
              typeof item?.reading === "string" &&
              item.reading.length <= 500
            );
          })
        ) {
          return err(
            `Paragraph ${paragraphIndex + 1}, sentence ${sentenceIndex + 1} has invalid furigana segments.`,
          );
        }
        segments = sentence.segments.map(
          (segment: { written: string; reading: string }) => ({
            written: segment.written,
            reading: segment.reading,
          }),
        );
      }
      paragraph.push({
        ...(sentence.speaker === undefined ? {} : { speaker: sentence.speaker.trim() }),
        japanese: sentence.japanese,
        english: sentence.english,
        segments,
      });
      count += 1;
      if (count > 100) return err("A passage can contain at most 100 sentences.");
    }
    paragraphs.push(paragraph);
  }
  // The canonical content determines the id. Importing the same file twice
  // keeps one library entry, even when the JSON field order changes.
  const id = `passage-${createHash("sha256")
    .update(
      JSON.stringify({
        title,
        titleReading,
        titleEnglish,
        paragraphs,
      }),
    )
    .digest("hex")}`;
  return ok({ id, title, titleReading, titleEnglish, paragraphs });
};
