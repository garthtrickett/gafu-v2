import kuromoji, { type Tokenizer } from "@faanau/kuromoji";

const loaded = new Map<string, Promise<Tokenizer>>();

export const loadKuromojiFromDirectory = (
  dictionaryPath: string,
): Promise<Tokenizer> => {
  const existing = loaded.get(dictionaryPath);
  if (existing !== undefined) return existing;
  const pending = new Promise<Tokenizer>((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error !== null) reject(error);
      else resolve(tokenizer);
    });
  }).catch((cause) => {
    loaded.delete(dictionaryPath);
    throw cause;
  });
  loaded.set(dictionaryPath, pending);
  return pending;
};
