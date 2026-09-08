/// <reference lib="webworker" />

import kuromoji from "@faanau/kuromoji";
import { createKuromojiAnalyzer } from "./kuromoji-analyzer.ts";

const analyzer = createKuromojiAnalyzer(
  () =>
    new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: "/dict" }).build((error, tokenizer) => {
        if (error !== null) reject(error);
        else resolve(tokenizer);
      });
    }),
);

self.addEventListener(
  "message",
  async (
    event: MessageEvent<
      Readonly<{ requestId: number; cueId: string; rawText: string }>
    >,
  ) => {
    const result = await analyzer.analyze(event.data.cueId, event.data.rawText);
    self.postMessage({ requestId: event.data.requestId, result });
  },
);
