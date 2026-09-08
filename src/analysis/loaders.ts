import kuromoji, { type Tokenizer } from "@faanau/kuromoji";
import { Suzume } from "@libraz/suzume";

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

export const loadSuzume = (): Promise<Suzume> =>
  Suzume.create({
    preserveSymbols: true,
    preserveCase: true,
    preserveVu: true,
    mode: "normal",
    mergeCompounds: false,
  });
