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

type AnalysisWorker = Pick<Worker, "addEventListener" | "postMessage" | "terminate">;

export const createBrowserAnalysisClient = (
  spawn: () => AnalysisWorker = () =>
    new Worker(new URL("./kuromoji.worker.ts", import.meta.url), {
      type: "module",
    }),
): BrowserAnalysisClient => {
  const worker = spawn();
  const pending = new Map<
    number,
    (result: Result<AnalyzedText, AnalysisError>) => void
  >();
  let nextRequestId = 1;
  let unavailable: string | null = null;

  const failPending = (cause: string): void => {
    unavailable = cause;
    for (const resolve of pending.values()) {
      resolve({ ok: false, error: { kind: "analyzerUnavailable", cause } });
    }
    pending.clear();
  };

  worker.addEventListener("message", (event: MessageEvent<AnalyzeResponse>) => {
    const resolve = pending.get(event.data.requestId);
    if (resolve !== undefined) {
      pending.delete(event.data.requestId);
      resolve(event.data.result);
    }
  });

  worker.addEventListener("error", () =>
    failPending("Japanese analysis worker failed"),
  );

  return {
    analyzer: {
      name: "kuromoji-ipadic-browser-worker",
      analyze: (cueId, rawText) => {
        if (unavailable !== null) {
          return Promise.resolve({
            ok: false as const,
            error: { kind: "analyzerUnavailable" as const, cause: unavailable },
          });
        }
        return new Promise((resolve) => {
          const requestId = nextRequestId;
          nextRequestId += 1;
          pending.set(requestId, resolve);
          try {
            worker.postMessage({ requestId, cueId, rawText });
          } catch {
            failPending("Japanese analysis worker is unavailable");
          }
        });
      },
    },
    close: () => {
      if (unavailable === null) failPending("Japanese analysis worker was closed");
      worker.terminate();
    },
  };
};
