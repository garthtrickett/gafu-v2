import { mountStudyApp } from "./study/browser.ts";
import "./style.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) {
  throw new Error("Missing #app composition root");
}

// The offline shell. Registration is best effort: a dev server that does
// not build the worker, or a browser without one, changes nothing else.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

if (new URLSearchParams(location.search).get("diagnostic") === "phase0") {
  const { mountPhase0Diagnostic } = await import("./phase0-diagnostic-page.ts");
  await mountPhase0Diagnostic(app);
} else if (new URLSearchParams(location.search).get("view") === "prepare") {
  const { mountPreparationApp } = await import("./preparation/browser.ts");
  mountPreparationApp(app);
} else if (new URLSearchParams(location.search).get("view") === "watch") {
  const { mountWatchApp } = await import("./watch/browser.ts");
  mountWatchApp(app);
} else {
  mountStudyApp(app);
}
