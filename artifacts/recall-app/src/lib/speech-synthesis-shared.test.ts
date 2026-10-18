import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPremiumTtsEnabled,
  getServerSttEnabled,
  getVoiceAnswersEnabled,
  setPremiumTtsEnabled,
  setServerSttEnabled,
  setVoiceAnswersEnabled,
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

describe("voice defaults", () => {
  it("defaults voice answers off until the user enables them", () => {
    expect(getVoiceAnswersEnabled()).toBe(false);
    setVoiceAnswersEnabled(true);
    expect(getVoiceAnswersEnabled()).toBe(true);
  });

  it("defaults paid server transcription off until explicitly enabled", () => {
    expect(getServerSttEnabled()).toBe(false);
    setServerSttEnabled(true);
    expect(getServerSttEnabled()).toBe(true);
    setServerSttEnabled(false);
    expect(getServerSttEnabled()).toBe(false);
  });
});
