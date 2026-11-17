// The contract every new dashboard page follows. The original pages (General,
// Pet, Care, Dock, History, About) live in settings.ts and render themselves.
export interface DashPage {
  /** Matches the sidebar button's data-tab and the .page's data-page. */
  id: string;
  /** Builds the page into its container once, at startup. */
  mount(root: HTMLElement): void;
  /** The page became visible (refresh, start live updates). */
  show?(): void;
  /** Another page was opened (stop live updates). */
  hide?(): void;
}

/** Opens a page as if its sidebar button was clicked. */
export function goTo(page: string): void {
  document.querySelector<HTMLButtonElement>(`.tabbar .tab[data-tab="${page}"]`)?.click();
}

/** Re-render at most once per animation frame, and only while visible. */
export function scheduler(render: () => void, isVisible: () => boolean): () => void {
  let queued = false;
  return () => {
    if (queued || !isVisible()) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  };
}

/**
 * Re-render only when `signature()` changed: Home Assistant sends updates for
 * every entity every few seconds, and a page must not rebuild (and lose the
 * text you are typing) for data it does not show.
 */
export function onlyWhenChanged(render: () => void, signature: () => string): (force?: boolean) => void {
  let last = "";
  return (force = false) => {
    const sig = signature();
    if (!force && sig === last) return;
    last = sig;
    render();
  };
}
