import { Hono } from "hono";
import type { ServerContext } from "../config/context.js";
import { getDB } from "../config/mongodb.js";
import { adminMiddleware } from "../middleware/auth.js";

export type AppSettings = {
    commentsEnabled: boolean;
    watchRequiresAuth: boolean;
    globalChatEnabled: boolean;
    updatedAt?: number;
};

const SETTINGS_DOC_ID = "global";

const DEFAULT_SETTINGS: AppSettings = {
    commentsEnabled: true,
    watchRequiresAuth: true,
    globalChatEnabled: true,
};

export const settingsRouter = new Hono<ServerContext>();

settingsRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

async function getSettings(db: any): Promise<AppSettings> {
    const doc = await db.collection("settings").findOne({ _id: SETTINGS_DOC_ID });
    const merged: AppSettings = { ...DEFAULT_SETTINGS, ...(doc || {}) };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = merged as any;
    return rest as AppSettings;
}

async function handleGet(c: any) {
    try {
        const db = await getDB();
        const settings = await getSettings(db);
        return c.json({ success: true, data: settings });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to load settings";
        return c.json({ success: true, data: DEFAULT_SETTINGS, warning: message });
    }
}

settingsRouter.get("", handleGet);
settingsRouter.get("/", handleGet);

async function handlePut(c: any) {
    const body = c.get("parsedBody") || (await c.req.json().catch(() => ({}))) as {
        commentsEnabled?: unknown;
        watchRequiresAuth?: unknown;
        globalChatEnabled?: unknown;
    };

    try {
        const db = await getDB();
        const patch: Partial<AppSettings> = {};
        if (typeof body.commentsEnabled === "boolean") patch.commentsEnabled = body.commentsEnabled;
        if (typeof body.watchRequiresAuth === "boolean") patch.watchRequiresAuth = body.watchRequiresAuth;
        if (typeof body.globalChatEnabled === "boolean") patch.globalChatEnabled = body.globalChatEnabled;

        await db.collection("settings").updateOne(
            ({ _id: SETTINGS_DOC_ID } as any),
            {
                $set: { ...DEFAULT_SETTINGS, ...patch, updatedAt: Date.now() },
                $setOnInsert: { _id: SETTINGS_DOC_ID },
            },
            { upsert: true }
        );

        const settings = await getSettings(db);
        return c.json({ success: true, data: settings });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Failed to update settings";
        return c.json({ success: false, error: message }, 503);
    }
}

settingsRouter.put("", adminMiddleware, handlePut);
settingsRouter.put("/", adminMiddleware, handlePut);
