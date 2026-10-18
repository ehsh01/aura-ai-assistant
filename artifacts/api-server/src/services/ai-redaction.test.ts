import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiService, resetAiServiceForTests } from "./ai";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAiServiceForTests();
});

describe("AI output redaction", () => {
  it("redacts degraded summarize and rewrite-style outputs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    resetAiServiceForTests();
    const service = createAiService();
    const secret = "FakePsychiatryPassword!42";

    const summary = await service.summarizeNote({
      content: `SSH password: ${secret}`,
    });
    const title = await service.generateNoteTitle({
      content: `Password: ${secret}\nPsychiatry Inventory App`,
    });

    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(JSON.stringify(title)).not.toContain(secret);
    expect(JSON.stringify({ summary, title })).toContain(
      "[hidden credential]",
    );
  });
});
