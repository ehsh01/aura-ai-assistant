import { once } from "node:events";
import type { AddressInfo } from "node:net";
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
  loginUser: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("../lib/config", () => ({
  config: {
    allowPublicRegister: true,
    appPublicUrl: "https://recall-app.net",
    registerInviteCode: null,
    sessionCookieDomain: ".recall-app.net",
    sessionCookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    sessionCookieName: "recall_session",
    sessionCookieSecure: true,
  },
}));

vi.mock("../middleware/security", () => ({
  loginRateLimiter: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

vi.mock("../middleware/auth", () => ({
  handleAuthRouteError: (err: unknown, _res: Response, next: NextFunction) =>
    next(err),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../services/auth-sessions", () => ({
  revokeAllAuthSessionsForUser: vi.fn(),
  revokeAuthSession: vi.fn(),
}));

vi.mock("../services/audit", () => ({
  writeAuditLog: mocks.writeAuditLog,
}));

vi.mock("../services/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  adminSetUserAdmin: vi.fn(),
  adminSetUserDisabled: vi.fn(),
  adminSetUserPassword: vi.fn(),
  assertAuthConfigured: vi.fn(),
  changePasswordForUser: vi.fn(),
  listUsersForAdmin: vi.fn(),
  loginUser: mocks.loginUser,
  registerUser: vi.fn(),
  toPublicUser: vi.fn(),
  verifyAccessToken: vi.fn(),
}));

import authRouter from "./auth";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use("/api", authRouter);
app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginUser.mockResolvedValue({
    token: "session-token",
    user: {
      id: "pwa-user",
      email: "pwa@example.com",
      name: "PWA User",
      isAdmin: false,
    },
  });
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("standalone PWA form authentication", () => {
  it("sets the shared HttpOnly session cookie on a navigation response", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login-form`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "pwa@example.com",
        password: "correct-password",
      }),
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://recall-app.net/today",
    );
    expect(response.headers.get("set-cookie")).toEqual(
      expect.stringContaining("recall_session=session-token"),
    );
    expect(response.headers.get("set-cookie")).toEqual(
      expect.stringContaining("Domain=.recall-app.net"),
    );
    expect(response.headers.get("set-cookie")).toEqual(
      expect.stringContaining("HttpOnly"),
    );
    expect(response.headers.get("set-cookie")).toEqual(
      expect.stringContaining("SameSite=Lax"),
    );
    expect(mocks.loginUser).toHaveBeenCalledWith({
      email: "pwa@example.com",
      password: "correct-password",
    });
  });
});
