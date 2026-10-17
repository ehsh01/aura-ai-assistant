/** True when Recall is running as an installed home-screen / standalone PWA. */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

/** Standalone PWAs (especially on iOS) may not persist cookies set via fetch(). */
export function needsFormBasedAuth(): boolean {
  return isStandalonePwa();
}
