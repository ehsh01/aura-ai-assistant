import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canStartWakeWord,
  getWakeWordOptIn,
  isDesktopBrowser,
  setWakeWordOptIn,
} from "./wake-word-settings";

const store = new Map<string, string>();

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe("wake-word opt-in gating", () => {
  it("defaults off and persists only an explicit opt-in", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    expect(getWakeWordOptIn()).toBe(false);
    setWakeWordOptIn(true);
    expect(getWakeWordOptIn()).toBe(true);
    setWakeWordOptIn(false);
    expect(getWakeWordOptIn()).toBe(false);
  });

  it("requires the server switch, desktop browser, and user opt-in", () => {
    expect(
      canStartWakeWord({
        serverEnabled: true,
        desktopBrowser: true,
        optedIn: true,
      }),
    ).toBe(true);
    for (const input of [
      { serverEnabled: false, desktopBrowser: true, optedIn: true },
      { serverEnabled: true, desktopBrowser: false, optedIn: true },
      { serverEnabled: true, desktopBrowser: true, optedIn: false },
    ]) {
      expect(canStartWakeWord(input)).toBe(false);
    }
  });

  it("rejects mobile and iPad desktop user agents", () => {
    expect(
      isDesktopBrowser({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 0,
      }),
    ).toBe(true);
    expect(
      isDesktopBrowser({
        userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
    expect(
      isDesktopBrowser({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });
});
