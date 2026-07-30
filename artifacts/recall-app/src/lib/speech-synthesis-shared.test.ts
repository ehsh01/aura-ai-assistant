import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPremiumTtsEnabled,
  setPremiumTtsEnabled,
} from "./speech-synthesis-shared";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("premium TTS preference", () => {
  it("defaults to off so Voice Answers never spend money automatically", () => {
    expect(getPremiumTtsEnabled()).toBe(false);
  });

  it("can be enabled explicitly for OpenAI TTS", () => {
    setPremiumTtsEnabled(true);
    expect(getPremiumTtsEnabled()).toBe(true);
    setPremiumTtsEnabled(false);
    expect(getPremiumTtsEnabled()).toBe(false);
  });
});
