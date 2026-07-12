import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  verifyAccessToken: vi.fn(),
  authenticateExtensionToken: vi.fn(),
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
  getUserById: mocks.getUserById,
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock("../services/extension-tokens", () => ({
  authenticateExtensionToken: mocks.authenticateExtensionToken,
  isExtensionToken: (token: string) => token.startsWith("recall_ext_"),
}));

import { requireAuth, requireCaptureAuth } from "./auth";

function responseDouble(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

function requestDouble(input: {
  bearer?: string;
  cookie?: string;
}): Request {
  return {
    headers: input.bearer
      ? { authorization: `Bearer ${input.bearer}` }
      : {},
    cookies: input.cookie ? { recall_session: input.cookie } : {},
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserById.mockResolvedValue({
    id: "user-1",
    email: "person@example.com",
    name: "Person",
  });
  mocks.verifyAccessToken.mockReturnValue({ sub: "user-1" });
});

describe("authentication boundaries", () => {
  it("does not accept a bearer JWT on ordinary protected routes", async () => {
    const req = requestDouble({ bearer: "legacy.jwt.value" });
    const res = responseDouble();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
  });

  it("accepts the HttpOnly session cookie on ordinary protected routes", async () => {
    const req = requestDouble({ cookie: "session.jwt.value" });
    const res = responseDouble();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(mocks.verifyAccessToken).toHaveBeenCalledWith("session.jwt.value");
    expect(req.authContext).toEqual({ kind: "session" });
    expect(next).toHaveBeenCalledOnce();
  });

  it("temporarily accepts a legacy bearer JWT at the capture boundary only", async () => {
    const req = requestDouble({ bearer: "legacy.jwt.value" });
    const res = responseDouble();
    const next = vi.fn() as NextFunction;

    await requireCaptureAuth(req, res, next);

    expect(mocks.verifyAccessToken).toHaveBeenCalledWith("legacy.jwt.value");
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts a scoped extension token at the capture boundary", async () => {
    mocks.authenticateExtensionToken.mockResolvedValue({
      userId: "user-1",
      tokenId: "ext-1",
    });
    const req = requestDouble({ bearer: "recall_ext_secret" });
    const res = responseDouble();
    const next = vi.fn() as NextFunction;

    await requireCaptureAuth(req, res, next);

    expect(mocks.authenticateExtensionToken).toHaveBeenCalledWith("recall_ext_secret");
    expect(req.authContext).toEqual({
      kind: "extension",
      extensionTokenId: "ext-1",
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
