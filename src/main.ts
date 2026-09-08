import { render } from "lit-html";
import { createBrowserAnalysisClient } from "./analysis/browser-client.ts";
import { diagnosticView, loadDiagnostic } from "./diagnostic.ts";
import { createDevelopmentLogger } from "./log.ts";
import { runPhase0Proof } from "./phase0-proof.ts";
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

window.gafuDiagnostics = {
  analyzeJapanese: (text) =>
    browserAnalysis.analyzer.analyze("browser-diagnostic", text),
};

const proof = await runPhase0Proof(browserAnalysis.analyzer);
const model = await loadDiagnostic(
  {
    check: async () => {
      if (!proof.ok) throw new Error(`Integrated proof failed: ${proof.error.kind}`);
      return { message: "Integrated Phase 0 proof passed." };
    },
  },
  logger,
);

render(diagnosticView({ ...model, proof }), app);

window.addEventListener("pagehide", browserAnalysis.close, { once: true });
