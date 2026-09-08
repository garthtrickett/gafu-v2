import type { Result } from "../result.ts";
import type { AnalysisError, AnalyzedText, JapaneseAnalyzer } from "./contracts.ts";

type AnalyzeResponse = Readonly<{
  requestId: number;
  result: Result<AnalyzedText, AnalysisError>;
}>;

export type BrowserAnalysisClient = Readonly<{
  analyzer: JapaneseAnalyzer;
  close: () => void;
}>;

export const createBrowserAnalysisClient = (): BrowserAnalysisClient => {
  const worker = new Worker(new URL("./kuromoji.worker.ts", import.meta.url), {
    type: "module",
  });
  const pending = new Map<
    number,
    (result: Result<AnalyzedText, AnalysisError>) => void
  >();
  let nextRequestId = 1;

  worker.addEventListener("message", (event: MessageEvent<AnalyzeResponse>) => {
    const resolve = pending.get(event.data.requestId);
    if (resolve !== undefined) {
      pending.delete(event.data.requestId);
      resolve(event.data.result);
    }
  });

  worker.addEventListener("error", () => {
    for (const resolve of pending.values()) {
      resolve({
        ok: false,
        error: {
          kind: "analyzerUnavailable",
          cause: "Japanese analysis worker failed",
        },
      });
    }
    pending.clear();
  });

  return {
    analyzer: {
      name: "kuromoji-ipadic-browser-worker",
      analyze: (cueId, rawText) =>
        new Promise((resolve) => {
          const requestId = nextRequestId;
          nextRequestId += 1;
          pending.set(requestId, resolve);
          worker.postMessage({ requestId, cueId, rawText });
        }),
    },
    close: () => worker.terminate(),
  };
};
