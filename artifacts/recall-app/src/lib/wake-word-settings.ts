export const WAKE_WORD_PREF_KEY = "recall.wakeWordEnabled";

export function getWakeWordOptIn(): boolean {
  if (typeof window === "undefined") return false;
  const value = window.localStorage.getItem(WAKE_WORD_PREF_KEY);
  return value === "1" || value === "true";
}

export function setWakeWordOptIn(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WAKE_WORD_PREF_KEY, enabled ? "1" : "0");
}

export function isDesktopBrowser(
  navigatorLike: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): boolean {
  const userAgent = navigatorLike.userAgent.toLowerCase();
  if (/android|iphone|ipad|ipod|mobile|silk|kindle/.test(userAgent)) {
    return false;
  }
  // iPadOS can identify itself as Macintosh when requesting desktop sites.
  if (
    navigatorLike.platform.toLowerCase().includes("mac") &&
    navigatorLike.maxTouchPoints > 1
  ) {
    return false;
  }
  return /windows|macintosh|linux|cros|x11/.test(userAgent);
}

export function canStartWakeWord(input: {
  serverEnabled: boolean;
  desktopBrowser: boolean;
  optedIn: boolean;
}): boolean {
  return input.serverEnabled && input.desktopBrowser && input.optedIn;
}
