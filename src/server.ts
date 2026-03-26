import https from "https";

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { log } from "./config/logger.js";
import { corsConfig } from "./config/cors.js";
import { ratelimit } from "./config/ratelimit.js";
import { execGracefulShutdown } from "./utils.js";
import { DeploymentEnv, env, SERVERLESS_ENVIRONMENTS } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./config/errorHandler.js";
import type { ServerContext } from "./config/context.js";

import { userRouter } from "./routes/user.js";
import { commentsRouter } from "./routes/comments.js";
import { chatRouter } from "./routes/chat.js";
import { settingsRouter } from "./routes/settings.js";
import { announcementsRouter } from "./routes/announcements.js";
import { analyticsRouter } from "./routes/analytics.js";
import { triviaRouter } from "./routes/trivia.js";

import { logging } from "./middleware/logging.js";
import { cacheConfigSetter, cacheControl } from "./middleware/cache.js";
import { connectMongoDB } from "./config/mongodb.js";
import { initializeFirebaseAdmin } from "./config/firebase.js";
import { initChatWebhook, closeChatWebhook } from "./services/chatWebhook.js";

import pkgJson from "../package.json" with { type: "json" };

const BASE_PATH = "/api/v2" as const;

const app = new Hono<ServerContext>();

app.use(logging);
app.use(corsConfig);
app.use(cacheControl);

const isPersonalDeployment = Boolean(env.USER_API_HOSTNAME);
if (isPersonalDeployment) {
    app.use(ratelimit);
}

app.use("/", serveStatic({ root: "public" }));

app.get("/health", (c) => c.text("daijoubu", { status: 200 }));
app.get("/v", async (c) =>
    c.text(
        `user-api: v${"version" in pkgJson && pkgJson?.version ? pkgJson.version : "-1"}`
    )
);

app.use(cacheConfigSetter(BASE_PATH.length));

app.basePath(BASE_PATH).route("/user", userRouter);
app.basePath(BASE_PATH).route("/comments", commentsRouter);
app.basePath(BASE_PATH).route("/chat", chatRouter);
app.basePath(BASE_PATH).route("/settings", settingsRouter);
app.basePath(BASE_PATH).route("/announcements", announcementsRouter);
app.basePath(BASE_PATH).route("/analytics", analyticsRouter);
app.basePath(BASE_PATH).route("/trivia", triviaRouter);

app.notFound(notFoundHandler);
app.onError(errorHandler);

(function () {
    if (SERVERLESS_ENVIRONMENTS.includes(env.USER_API_DEPLOYMENT_ENV)) {
        return;
    }

    connectMongoDB().catch((err) => log.error(`MongoDB init error: ${err}`));
    initializeFirebaseAdmin();

    const server = serve({
        port: env.USER_API_PORT,
        hostname: "0.0.0.0",
        fetch: app.fetch,
    }).addListener("listening", () => {
        log.info(`user-api RUNNING at http://0.0.0.0:${env.USER_API_PORT}`);
        initChatWebhook(server as unknown as import("http").Server);
    });

    process.on("SIGINT", () => { closeChatWebhook(); execGracefulShutdown(server); });
    process.on("SIGTERM", () => { closeChatWebhook(); execGracefulShutdown(server); });
    process.on("uncaughtException", (err) => {
        log.error(`Uncaught Exception: ${err.message}`);
        closeChatWebhook();
        execGracefulShutdown(server);
    });
    process.on("unhandledRejection", (reason, promise) => {
        log.error(`Unhandled Rejection at: ${promise}, reason: ${reason instanceof Error ? reason.message : reason}`);
        closeChatWebhook();
        execGracefulShutdown(server);
    });

    // Keep-alive ping for Render free tier
    if (isPersonalDeployment && env.USER_API_DEPLOYMENT_ENV === DeploymentEnv.RENDER) {
        const INTERVAL_DELAY = 8 * 60 * 1000;
        const url = new URL(`https://${env.USER_API_HOSTNAME}/health`);
        setInterval(() => {
            https
                .get(url.href)
                .on("response", () => log.info(`user-api HEALTH_CHECK at ${new Date().toISOString()}`))
                .on("error", (err) => log.warn(`user-api HEALTH_CHECK failed; ${err.message.trim()}`));
        }, INTERVAL_DELAY);
    }
})();

export default app;
