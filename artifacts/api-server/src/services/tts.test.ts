import { afterEach, describe, expect, it } from "vitest";
import { assertServerTtsEnabled, getOpenAiTtsSettings } from "./tts";

const KEYS = [
  "RECALL_VOICE_AI_ENABLED",
  "RECALL_SERVER_TTS_ENABLED",
  "RECALL_OPENAI_TTS_ENABLED",
  "RECALL_TTS_MODEL",
  "RECALL_TTS_VOICE",
  "RECALL_TTS_INSTRUCTIONS",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
] as const;
const FLAG_KEYS = [
  "RECALL_VOICE_AI_ENABLED",
  "RECALL_SERVER_TTS_ENABLED",
  "RECALL_OPENAI_TTS_ENABLED",
] as const;
const original = new Map(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function expectDisabled() {
  try {
    assertServerTtsEnabled();
    throw new Error("Expected server TTS to be disabled");
  } catch (error) {
    expect(error).toMatchObject({ status: 503 });
  }
}

describe("paid /ai/tts flags", () => {
  it("returns 503 semantics when both flags are unset", () => {
    delete process.env.RECALL_SERVER_TTS_ENABLED;
    delete process.env.RECALL_OPENAI_TTS_ENABLED;
    expectDisabled();
  });

  it.each(FLAG_KEYS)(
    "returns 503 semantics with only %s enabled",
    (enabledKey) => {
      for (const key of KEYS) delete process.env[key];
      process.env[enabledKey] = "true";
      expectDisabled();
    },
  );

  it("allows the route only when all paid voice flags are enabled", () => {
    process.env.RECALL_VOICE_AI_ENABLED = "true";
    process.env.RECALL_SERVER_TTS_ENABLED = "true";
    process.env.RECALL_OPENAI_TTS_ENABLED = "true";
    expect(() => assertServerTtsEnabled()).not.toThrow();
  });
});

describe("server-side TTS settings", () => {
  it("defaults to tts-1 and the selected onyx voice", () => {
    delete process.env.RECALL_TTS_MODEL;
    delete process.env.RECALL_TTS_VOICE;
    delete process.env.OPENAI_TTS_MODEL;
    delete process.env.OPENAI_TTS_VOICE;
    expect(getOpenAiTtsSettings()).toEqual({
      model: "tts-1",
      voice: "onyx",
    });
  });

  it("rejects models and voices outside the allowlists", () => {
    process.env.RECALL_TTS_MODEL = "unknown";
    expect(() => getOpenAiTtsSettings()).toThrow(/model is not allowed/);
    process.env.RECALL_TTS_MODEL = "tts-1";
    process.env.RECALL_TTS_VOICE = "unknown";
    expect(() => getOpenAiTtsSettings()).toThrow(/voice is not allowed/);
  });

  it("sends instructions only for gpt-4o-mini-tts", () => {
    process.env.RECALL_TTS_INSTRUCTIONS = "Warm and concise";
    process.env.RECALL_TTS_MODEL = "tts-1";
    expect(getOpenAiTtsSettings()).not.toHaveProperty("instructions");
    process.env.RECALL_TTS_MODEL = "gpt-4o-mini-tts";
    expect(getOpenAiTtsSettings()).toMatchObject({
      instructions: "Warm and concise",
    });
  });
});
