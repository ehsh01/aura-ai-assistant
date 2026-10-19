import { createServer, type Server } from "node:http";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  allowance: vi.fn(),
  queryVoice: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("../services/ai-usage", () => ({
  voiceAiAllowance: mocks.allowance,
  voiceSessionSilenceMs: () => 8_000,
  recordAiUsage: mocks.recordUsage,
  withVoiceAiLock: vi.fn(async (_userId: string, fn: () => Promise<unknown>) =>
    fn(),
  ),
}));

vi.mock("../services/voice-answer", () => ({
  isVoiceLinkQuestion: (question: string) => /\blink\b/i.test(question),
  queryVoiceNotesForUser: mocks.queryVoice,
  VOICE_LIMIT_REPLY: "Daily voice limit reached. Free search still works.",
  VOICE_MONTHLY_LIMIT_REPLY:
    "Monthly voice limit reached. Free search still works.",
}));

import aiRouter from "./ai";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "voice@example.com",
      name: "Voice Test",
      isAdmin: false,
    };
    next();
  });
  app.use(aiRouter);
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ message: error.message });
    },
  );
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind voice fallback test server");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  mocks.allowance.mockReset();
  mocks.queryVoice.mockReset();
  mocks.recordUsage.mockReset();
  mocks.recordUsage.mockResolvedValue(undefined);
  mocks.queryVoice.mockResolvedValue({
    answer:
      "Your Psychiatry website link is https://psychiatry.example.com/edit-links, from your note Adding and editing a web link on the Psychiatry website.",
    sources: [],
    privacy: { model: null },
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("POST /ai/voice/query deterministic link fallback", () => {
  it.each(["disabled", "daily_limit", "monthly_limit"] as const)(
    "answers without model access when voice AI is %s",
    async (reason) => {
      mocks.allowance.mockResolvedValue({ allowed: false, reason });

      const response = await fetch(`${baseUrl}/ai/voice/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "What's my Psychiatry link?" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        answer: expect.stringContaining(
          "https://psychiatry.example.com/edit-links",
        ),
        limitReason:
          reason === "daily_limit" || reason === "monthly_limit"
            ? reason
            : null,
      });
      expect(mocks.queryVoice).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        "What's my Psychiatry link?",
        null,
        { allowModel: false },
      );
    },
  );

  it("records a deterministic session turn against the voice Ask cap", async () => {
    mocks.allowance.mockResolvedValue({ allowed: true, remaining: 99 });

    const response = await fetch(`${baseUrl}/ai/voice/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What's my Psychiatry link?" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "11111111-1111-4111-8111-111111111111",
        feature: "voice_ask",
        model: "notes-only",
        costMicros: 0,
      }),
      { strict: true },
    );
  });
});
