/**
 * Reads the base text of a highlight inside a ruby-annotated sentence.
 *
 * `Selection.toString()` is wrong here: furigana is real text, so a drag over
 * 食べる comes back as "食たべる". The range's contents are cloned and the
 * annotations removed instead. Nothing here relies on `user-select: none`
 * having applied to the readings.
 */
const FURIGANA_ANNOTATION = "rt, rp";

const isWithinFuriganaAnnotation = (node: Node): boolean => {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest(FURIGANA_ANNOTATION) != null;
};

export const readSelectedBaseText = (
  selection: Selection | null,
  container: Element,
): string | null => {
  // A collapsed selection is a plain click, which must never raise a lookup.
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  if (isWithinFuriganaAnnotation(range.commonAncestorContainer)) return null;
  const fragment = range.cloneContents();
  for (const annotation of Array.from(fragment.querySelectorAll(FURIGANA_ANNOTATION))) {
    annotation.remove();
  }
  const text = fragment.textContent;
  return text && text.trim().length > 0 ? text : null;
};

export const clearSelection = (selection: Selection | null): void => {
  selection?.removeAllRanges();
};
