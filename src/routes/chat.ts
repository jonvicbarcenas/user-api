import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { authMiddleware, getVerifiedUid } from "../middleware/auth.js";
import { isFirebaseConfigured } from "../config/firebase.js";
import { broadcastChatMessage } from "../services/chatWebhook.js";
import {
    getCachedChatMessages,
    getCachedUnreadCount,
    invalidateChatMessagesCache,
} from "../helpers/chatCache.js";
import { ObjectId } from "mongodb";

export const chatRouter = new Hono<ServerContext>();

// Disable caching for chat
chatRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

// Mark messages as seen up to a timestamp - Protected
chatRouter.post("/messages/seen", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { userId: bodyUserId, username, upToCreatedAt } = body as {
        userId?: string;
        username?: string;
        upToCreatedAt?: number;
    };

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!userId || !username || !Number.isFinite(upToCreatedAt)) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    if (isFirebaseConfigured() && verifiedUid && bodyUserId && verifiedUid !== bodyUserId) {
        return c.json({ success: false, error: "Cannot mark messages as seen for another user" }, 403);
    }

    const db = await getDB();
    await db.collection("chatMessages").updateMany(
        { createdAt: { $lte: upToCreatedAt! } },
        { $addToSet: { seenBy: { userId, username } } }
    );

    return c.json({ success: true });
});

// Unread count for a user - Protected
chatRouter.get("/unread-count", authMiddleware, async (c) => {
    const queryUserId = c.req.query("userId");
    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || queryUserId;

    if (!userId) return c.json({ success: false, error: "userId required" }, 400);

    if (isFirebaseConfigured() && verifiedUid && queryUserId && verifiedUid !== queryUserId) {
        return c.json({ success: false, error: "Cannot check unread count for another user" }, 403);
    }

    const db = await getDB();
    const count = await getCachedUnreadCount(db, userId);
    return c.json({ success: true, data: { count } });
});

// Get chat messages
chatRouter.get("/messages", async (c) => {
    const limitParam = c.req.query("limit");
    const afterParam = c.req.query("after");
    const beforeParam = c.req.query("before");

    const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);
    const after = afterParam ? Number(afterParam) : undefined;
    const before = beforeParam ? Number(beforeParam) : undefined;

    const db = await getDB();
    const data = await getCachedChatMessages(db, limit, after, before);

    const uids = Array.from(new Set((data.messages || []).map((m: any) => m.userId).filter(Boolean)));
    if (uids.length) {
        const { getProfilesBatch } = await import("../helpers/profileCache.js");
        const profiles = await getProfilesBatch(db, uids);
        data.messages = (data.messages || []).map((m: any) => {
            const p = profiles[m.userId] || null;
            const fallback = { uid: m.userId, username: m.username ?? "unknown", avatarUrl: m.userAvatar ?? null, displayName: null };
            return { ...m, user: p ?? fallback };
        });
    }

    return c.json({ success: true, data });
});

// Post a chat message - Protected
chatRouter.post("/messages", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { userId: bodyUserId, username, userAvatar, text } = body as {
        userId?: string;
        username?: string;
        userAvatar?: string;
        text?: string;
    };

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!userId || !text) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    if (isFirebaseConfigured() && verifiedUid && bodyUserId && verifiedUid !== bodyUserId) {
        return c.json({ success: false, error: "Cannot post message as another user" }, 403);
    }

    const trimmed = String(text).trim();
    if (!trimmed) return c.json({ success: false, error: "Message cannot be empty" }, 400);
    if (trimmed.length > 500) return c.json({ success: false, error: "Message exceeds 500 character limit" }, 400);

    const message = { userId, text: trimmed, createdAt: Date.now() };

    const db = await getDB();
    const result = await db.collection("chatMessages").insertOne(message);
    const newMessage = { ...message, _id: result.insertedId.toString() };

    await invalidateChatMessagesCache();
    broadcastChatMessage(newMessage);

    return c.json({ success: true, data: newMessage });
});

// Toggle heart reaction on a message - Protected
chatRouter.post("/messages/:messageId/react", authMiddleware, async (c) => {
    const { messageId } = c.req.param();
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { userId: bodyUserId, username } = body as { userId?: string; username?: string };

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!userId || !username) return c.json({ success: false, error: "Missing required fields" }, 400);

    if (isFirebaseConfigured() && verifiedUid && bodyUserId && verifiedUid !== bodyUserId) {
        return c.json({ success: false, error: "Cannot react as another user" }, 403);
    }

    let oid: ObjectId;
    try {
        oid = new ObjectId(messageId);
    } catch {
        return c.json({ success: false, error: "Invalid messageId" }, 400);
    }

    const db = await getDB();
    const existing = await db.collection("chatMessages").findOne({ _id: oid });
    if (!existing) return c.json({ success: false, error: "Message not found" }, 404);

    const reactions: Array<{ userId: string; username: string }> = (existing as any).reactions || [];
    const hasReacted = reactions.some((r) => r.userId === userId);

    if (hasReacted) {
        await db.collection("chatMessages").updateOne({ _id: oid }, { $pull: { reactions: { userId } } as any });
    } else {
        await db.collection("chatMessages").updateOne({ _id: oid }, { $addToSet: { reactions: { userId, username } } });
    }

    const updated = await db.collection("chatMessages").findOne({ _id: oid });
    if (!updated) return c.json({ success: false, error: "Failed to load updated message" }, 500);

    const updatedMessage = { ...(updated as any), _id: (updated as any)._id.toString() };

    await invalidateChatMessagesCache();
    broadcastChatMessage(updatedMessage);

    return c.json({ success: true, data: updatedMessage });
});
