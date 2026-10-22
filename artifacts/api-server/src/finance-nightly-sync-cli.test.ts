import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NIGHTLY_FINANCE_SKIPPED_EXIT_CODE,
  loadFinanceCliEnv,
  nightlyFinanceExitCode,
} from "./finance-nightly-sync-cli";

const touched = ["DATABASE_URL", "FINANCE_API_KEY", "FINANCE_CONNECTOR_ID"];
const original = Object.fromEntries(
  touched.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of touched) {
    const value = original[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("nightly finance CLI environment", () => {
  it("loads the API .env format without overriding process values", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "finance-cli-"));
    const envPath = path.join(directory, ".env");
    await writeFile(
      envPath,
      [
        "DATABASE_URL=postgresql://from-file",
        'FINANCE_API_KEY="file-key"',
        "export FINANCE_CONNECTOR_ID=finance-1",
      ].join("\n"),
    );
    process.env.FINANCE_API_KEY = "process-key";

    try {
      loadFinanceCliEnv(envPath);
      expect(process.env.DATABASE_URL).toBe("postgresql://from-file");
      expect(process.env.FINANCE_API_KEY).toBe("process-key");
      expect(process.env.FINANCE_CONNECTOR_ID).toBe("finance-1");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses a distinct temporary-failure exit code when overlap skips work", () => {
    expect(nightlyFinanceExitCode({ completed: 1, skipped: 0 })).toBe(0);
    expect(nightlyFinanceExitCode({ completed: 0, skipped: 1 })).toBe(
      NIGHTLY_FINANCE_SKIPPED_EXIT_CODE,
    );
    expect(NIGHTLY_FINANCE_SKIPPED_EXIT_CODE).toBe(75);
  });
});
