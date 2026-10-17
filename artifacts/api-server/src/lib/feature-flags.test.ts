import { afterEach, describe, expect, it } from "vitest";
import { isEnabled } from "./feature-flags";

const KEY = "TEST_RECALL_FEATURE_FLAG";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("isEnabled", () => {
  it("defaults on and only disables explicit false", () => {
    delete process.env[KEY];
    expect(isEnabled(KEY)).toBe(true);
    process.env[KEY] = " FALSE ";
    expect(isEnabled(KEY)).toBe(false);
    process.env[KEY] = "true";
    expect(isEnabled(KEY)).toBe(true);
  });

  it("supports flags that default off", () => {
    delete process.env[KEY];
    expect(isEnabled(KEY, false)).toBe(false);
  });

  it("defaults every paid RECALL AI feature off", () => {
    const keys = [
      "RECALL_BACKGROUND_AI_ENABLED",
      "RECALL_ATTACHMENT_OCR_ENABLED",
      "RECALL_AI_DIGESTS_ENABLED",
      "RECALL_EMAIL_AI_SCAN_ENABLED",
      "RECALL_OPENAI_TTS_ENABLED",
      "RECALL_SERVER_STT_ENABLED",
      "RECALL_HOME_AI_DIGEST_ENABLED",
      "RECALL_EMBEDDING_WARM_ENABLED",
    ];
    const saved = new Map(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) {
        delete process.env[key];
        expect(isEnabled(key)).toBe(false);
        process.env[key] = "true";
        expect(isEnabled(key)).toBe(true);
      }
    } finally {
      for (const key of keys) {
        const value = saved.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
