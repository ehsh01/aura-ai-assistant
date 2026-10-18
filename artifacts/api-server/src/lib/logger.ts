import pino from "pino";
import { redactSensitiveValue } from "../services/secret-redaction";

const isProduction = process.env.NODE_ENV === "production";

export function redactLogArguments(args: unknown[]): unknown[] {
  return redactSensitiveValue(args);
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  hooks: {
    logMethod(args, method) {
      method.apply(this, redactLogArguments(args));
    },
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
