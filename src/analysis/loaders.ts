import kuromoji, { type Tokenizer } from "@faanau/kuromoji";

export const loadKuromojiFromDirectory = (dictionaryPath: string): Promise<Tokenizer> =>
  new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(tokenizer);
      }
    });
  });
