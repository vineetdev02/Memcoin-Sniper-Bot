import pino from "pino";
import { env } from "../config/env.js";

const isDev = env.NODE_ENV !== "production";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "engine", mode: env.MODE },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.HELIUS_API_KEY",
      "*.BIRDEYE_API_KEY",
      "*.BITQUERY_API_KEY",
      "*.RUGCHECK_API_KEY",
      "*.TELEGRAM_BOT_TOKEN",
      "*.privateKey",
      "*.secretKey",
      "headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,app",
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;

export const childLogger = (component: string) => logger.child({ component });
