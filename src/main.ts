import { mountStudyApp } from "./study/browser.ts";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) {
  throw new Error("Missing #app composition root");
}

if (new URLSearchParams(location.search).get("diagnostic") === "phase0") {
  const { mountPhase0Diagnostic } = await import("./phase0-diagnostic-page.ts");
  await mountPhase0Diagnostic(app);
} else if (new URLSearchParams(location.search).get("view") === "prepare") {
  const { mountPreparationApp } = await import("./preparation/browser.ts");
  mountPreparationApp(app);
} else {
  mountStudyApp(app);
}
