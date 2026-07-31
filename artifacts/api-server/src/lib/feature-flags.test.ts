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
});
