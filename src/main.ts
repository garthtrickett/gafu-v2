import { render } from "lit-html";
import { createBrowserAnalysisClient } from "./analysis/browser-client.ts";
import { diagnosticView, loadDiagnostic } from "./diagnostic.ts";
import { createDevelopmentLogger } from "./log.ts";
import "./style.css";

declare global {
  interface Window {
    gafuDiagnostics: Readonly<{
      analyzeJapanese: (
        text: string,
      ) => ReturnType<
        ReturnType<typeof createBrowserAnalysisClient>["analyzer"]["analyze"]
      >;
    }>;
  }
}

const app = document.querySelector<HTMLElement>("#app");
if (app === null) {
  throw new Error("Missing #app composition root");
}

const logger = createDevelopmentLogger((level, record) => {
  console[level](JSON.stringify({ level, ...record }));
});
const browserAnalysis = createBrowserAnalysisClient();

const model = await loadDiagnostic(
  {
    check: async () => ({ message: "Executable skeleton is ready." }),
  },
  logger,
);

render(diagnosticView(model), app);

window.gafuDiagnostics = {
  analyzeJapanese: (text) =>
    browserAnalysis.analyzer.analyze("browser-diagnostic", text),
};

window.addEventListener("pagehide", browserAnalysis.close, { once: true });
