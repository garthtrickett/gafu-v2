import { render } from "lit-html";
import { diagnosticView, loadDiagnostic } from "./diagnostic.ts";
import { createDevelopmentLogger } from "./log.ts";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) {
  throw new Error("Missing #app composition root");
}

const logger = createDevelopmentLogger((level, record) => {
  console[level](JSON.stringify({ level, ...record }));
});

const model = await loadDiagnostic(
  {
    check: async () => ({ message: "Executable skeleton is ready." }),
  },
  logger,
);

render(diagnosticView(model), app);
