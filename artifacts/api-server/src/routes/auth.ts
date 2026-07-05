import { Router, type IRouter } from "express";
import { DatabaseError } from "pg";
import {
  LoginBody,
  LoginResponse,
  GetCurrentUserResponse,
  RegisterBody,
} from "@workspace/api-zod";
import { handleAuthRouteError, requireAuth } from "../middleware/auth";
import {
  assertAuthConfigured,
  AuthError,
  loginUser,
  registerUser,
  toPublicUser,
} from "../services/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res, next) => {
  try {
    assertAuthConfigured();
    const body = RegisterBody.parse(req.body);
    if (body.password.length < 8) {
      throw new AuthError(
        "WEAK_PASSWORD",
        "Password must be at least 8 characters",
      );
    }
    const result = await registerUser(body);
    res.status(201).json(
      LoginResponse.parse({
        user: result.user,
        token: result.token,
      }),
    );
  } catch (err) {
    if (err instanceof DatabaseError && err.code === "23505") {
      res.status(409).json({
        error: "EMAIL_IN_USE",
        message: "An account with this email already exists",
      });
      return;
    }
    handleAuthRouteError(err, res, next);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    assertAuthConfigured();
    const body = LoginBody.parse(req.body);
    const result = await loginUser(body);
    res.json(
      LoginResponse.parse({
        user: result.user,
        token: result.token,
      }),
    );
  } catch (err) {
    handleAuthRouteError(err, res, next);
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  const data = GetCurrentUserResponse.parse({ user: toPublicUser(req.user!) });
  res.json(data);
});

export default router;
