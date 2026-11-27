import type { CardType } from "./contracts.ts";

const splitOnCommas = (meaning: string): string[] => {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < meaning.length; index++) {
    const character = meaning[index];
    if (character === "(" || character === "[") depth++;
    if ((character === ")" || character === "]") && depth > 0) depth--;
    if (character === "," && depth === 0) {
      parts.push(meaning.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(meaning.slice(start));
  return parts;
};

/** In vocabulary lists without semicolons, commas outside bracketed notes separate glosses. */
export const meaningOptions = (meaning: string, cardType: CardType) => {
  const separator = cardType === "vocabulary" && !meaning.includes(";") ? "," : ";";
  const parts = separator === "," ? splitOnCommas(meaning) : meaning.split(separator);
  return {
    separator,
    options: [...new Set(parts.map((option) => option.trim()).filter(Boolean))],
  };
};
