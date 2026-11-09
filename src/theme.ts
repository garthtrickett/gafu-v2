import { html, svg } from "lit-html";

/** Device-local appearance; never part of the learner's study preferences. */
const applyTheme = (light: boolean): void => {
  document.documentElement.dataset["theme"] = light ? "light" : "dark";
  for (const button of document.querySelectorAll(".theme-toggle")) {
    button.setAttribute("aria-pressed", String(light));
  }
};

export function installThemeSync(): void {
  window.addEventListener("storage", (event) => {
    if (event.key === "gafu-theme" || event.key === null) {
      applyTheme(event.newValue === "light");
    }
  });
}

export function themeToggle() {
  return html`<button
    type="button"
    class="secondary theme-toggle"
    aria-pressed=${document.documentElement.dataset["theme"] === "light"}
    @click=${() => {
      const light = document.documentElement.dataset["theme"] !== "light";
      applyTheme(light);
      try {
        localStorage.setItem("gafu-theme", light ? "light" : "dark");
      } catch {
        // Restricted browser storage still allows changing this visit's theme.
      }
    }}
  >
    ${svg`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>`}
    Light theme
  </button>`;
}
