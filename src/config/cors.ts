import { cors } from "hono/cors";
import { env } from "./env.js";
import { log } from "./logger.js";

const DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:4000",
    "http://localhost:4001",
    "http://localhost:5173",
    "http://localhost:5174",
    "https://myronix.jvbarcenas.space",
    "https://myronix.strangled.net",
];

const allowedOrigins = env.USER_API_CORS_ALLOWED_ORIGINS
    ? env.USER_API_CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
    : DEFAULT_ALLOWED_ORIGINS;

const isWildcard = allowedOrigins.includes("*");

if (isWildcard && env.NODE_ENV === "production") {
    log.warn(
        "⚠️ SECURITY WARNING: CORS is configured with wildcard '*' in production. " +
        "Set USER_API_CORS_ALLOWED_ORIGINS to your specific domains."
    );
}

export const corsConfig = cors({
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
    credentials: !isWildcard,
    origin: isWildcard ? "*" : allowedOrigins,
});
