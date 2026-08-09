/** True when the tab is backgrounded. SSR-safe (returns false without a document). */
export function isTabHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}
