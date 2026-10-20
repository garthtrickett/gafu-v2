/** Study fills the viewport even where browser fullscreen is unavailable. */
export const createStudyDisplay = (root: HTMLElement, redraw: () => void) => {
  let maximised = false;
  let nativeFullscreen = false;
  let scrollY = 0;
  const shell = () => root.querySelector<HTMLElement>(".study-shell");
  const focusToggle = () =>
    root
      .querySelector<HTMLElement>('[data-testid="study-display-toggle"]')
      ?.focus({ preventScroll: true });

  const restore = (): void => {
    if (!maximised) return;
    maximised = false;
    redraw();
    window.scrollTo({ top: scrollY, behavior: "instant" });
    focusToggle();
  };

  const exit = (): void => {
    const element = shell();
    restore();
    if (element !== null && document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => {
        // The viewport layout already restored; the browser also offers Exit.
      });
    }
  };

  const enter = async (): Promise<void> => {
    scrollY = window.scrollY;
    maximised = true;
    redraw();
    focusToggle();
    const element = shell();
    if (!document.fullscreenEnabled || element === null) return;
    try {
      await element.requestFullscreen();
      // A second tap may have restored Study while the request was pending.
      if (!maximised && document.fullscreenElement === element) {
        await document.exitFullscreen();
      }
    } catch {
      // Mobile browsers and embedded views may deny fullscreen. Study still
      // occupies the available viewport, with the same visible exit control.
    }
  };

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === shell()) {
      nativeFullscreen = true;
    } else if (nativeFullscreen) {
      nativeFullscreen = false;
      restore();
    }
  });

  return {
    isMaximised: () => maximised,
    toggle: (): void => {
      if (maximised) exit();
      else void enter();
    },
    exit,
  };
};
