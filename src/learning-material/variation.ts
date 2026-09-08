import { normalizeJapanese } from "../analysis/normalization.ts";

export const EXACT_SIGNATURE_VERSION = "exact-v1";
export const NEAR_SIGNATURE_VERSION = "near-v1";
export const NEAR_COPY_THRESHOLD = 0.82;

const compact = (value: string, targetSurface = ""): string => {
  const normalized = normalizeJapanese(value);
  const withoutTarget =
    targetSurface === ""
      ? normalized
      : normalized.replace(normalizeJapanese(targetSurface), "標的");
  return withoutTarget.replace(/[\p{P}\p{S}\s]/gu, "");
};

export const bigrams = (value: string, targetSurface = ""): readonly string[] => {
  const characters = Array.from(compact(value, targetSurface));
  if (characters.length < 2) return characters;
  return [
    ...new Set(
      characters.slice(0, -1).map((item, index) => item + characters[index + 1]),
    ),
  ].sort();
};

export const exactSignature = (value: string): string => {
  const digest = new Bun.CryptoHasher("sha256")
    .update(normalizeJapanese(value))
    .digest("hex");
  return `${EXACT_SIGNATURE_VERSION}:${digest}`;
};

export const nearSignature = (value: string, targetSurface = ""): string =>
  `${NEAR_SIGNATURE_VERSION}:${JSON.stringify(bigrams(value, targetSurface))}`;

export const parseNearSignature = (signature: string): readonly string[] => {
  const prefix = `${NEAR_SIGNATURE_VERSION}:`;
  if (!signature.startsWith(prefix)) return [];
  try {
    const parsed = JSON.parse(signature.slice(prefix.length)) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
};

export const jaccard = (left: readonly string[], right: readonly string[]): number => {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
};

export const isNearCopy = (
  candidate: string,
  targetSurface: string,
  prior: readonly string[],
): boolean => {
  const grams = bigrams(candidate, targetSurface);
  return prior.some(
    (signature) => jaccard(grams, parseNearSignature(signature)) >= NEAR_COPY_THRESHOLD,
  );
};
