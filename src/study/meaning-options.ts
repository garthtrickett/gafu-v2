/** Semicolons separate glosses. Commas may belong to a single gloss. */
export const meaningOptions = (meaning: string): readonly string[] => [
  ...new Set(
    meaning
      .split(";")
      .map((option) => option.trim())
      .filter(Boolean),
  ),
];
