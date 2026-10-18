import { afterEach, describe, expect, it } from "vitest";
import { assertServerTtsEnabled } from "./tts";

const KEYS = [
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

  it.each(KEYS)("returns 503 semantics with only %s enabled", (enabledKey) => {
    for (const key of KEYS) delete process.env[key];
    process.env[enabledKey] = "true";
    expectDisabled();
  });

  it("allows the route only when both flags are enabled", () => {
    process.env.RECALL_SERVER_TTS_ENABLED = "true";
    process.env.RECALL_OPENAI_TTS_ENABLED = "true";
    expect(() => assertServerTtsEnabled()).not.toThrow();
  });
});
