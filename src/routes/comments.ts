import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { authMiddleware, getVerifiedUid } from "../middleware/auth.js";
import { isFirebaseConfigured } from "../config/firebase.js";

export const commentsRouter = new Hono<ServerContext>();

// Disable caching for comments
commentsRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

// Get latest comments across all anime (for landing page)
commentsRouter.get("/latest", async (c) => {
    const limitParam = c.req.query("limit");
    const limit = Math.min(Math.max(parseInt(limitParam || "10", 10) || 10, 1), 20);
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ parentId: null })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

    const uids = Array.from(new Set(comments.map((x: any) => x.userId).filter(Boolean)));
    let profiles: Record<string, any> = {};
    if (uids.length) {
        const { getProfilesBatch } = await import("../helpers/profileCache.js");
        profiles = await getProfilesBatch(db, uids);
    }

    const formattedComments = comments.map((cm: any) => {
        const p = profiles[cm.userId] || null;
        const fallback = { uid: cm.userId, username: cm.username ?? "unknown", avatarUrl: cm.userAvatar ?? null, displayName: null };
        return { ...cm, _id: cm._id.toString(), user: p ?? fallback };
    });

    return c.json({ success: true, data: formattedComments });
});

// Get comments for an anime (general, not episode-specific)
commentsRouter.get("/anime/:animeId", async (c) => {
    const { animeId } = c.req.param();
    const decodedAnimeId = decodeURIComponent(animeId);
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({
            animeId: decodedAnimeId,
            $or: [
                { episodeId: null },
                { episodeId: { $exists: false } },
            ],
        })
        .sort({ createdAt: -1 })
        .toArray();

    const uids = Array.from(new Set(comments.map((x: any) => x.userId).filter(Boolean)));
    let profiles: Record<string, any> = {};
    if (uids.length) {
        const { getProfilesBatch } = await import("../helpers/profileCache.js");
        profiles = await getProfilesBatch(db, uids);
    }

    const formattedComments = comments.map((cm: any) => {
        const p = profiles[cm.userId] || null;
        const fallback = { uid: cm.userId, username: cm.username ?? "unknown", avatarUrl: cm.userAvatar ?? null, displayName: null };
        return { ...cm, _id: cm._id.toString(), user: p ?? fallback };
    });

    return c.json({ success: true, data: formattedComments });
});

// Get comments for a specific episode (using wildcard to handle special chars)
commentsRouter.get("/episode/*", async (c) => {
    const path = c.req.path;
    const episodeId = decodeURIComponent(path.split("/episode/")[1] || "");
    if (!episodeId) {
        return c.json({ success: false, error: "episodeId is required" }, 400);
    }
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ episodeId })
        .sort({ createdAt: -1 })
        .toArray();

    const uids = Array.from(new Set(comments.map((x: any) => x.userId).filter(Boolean)));
    let profiles: Record<string, any> = {};
    if (uids.length) {
        const { getProfilesBatch } = await import("../helpers/profileCache.js");
        profiles = await getProfilesBatch(db, uids);
    }

    const formattedComments = comments.map((cm: any) => {
        const p = profiles[cm.userId] || null;
        const fallback = { uid: cm.userId, username: cm.username ?? "unknown", avatarUrl: cm.userAvatar ?? null, displayName: null };
        return { ...cm, _id: cm._id.toString(), user: p ?? fallback };
    });

    return c.json({ success: true, data: formattedComments });
});

// Get all comments for an anime (including all episodes)
commentsRouter.get("/anime/:animeId/all", async (c) => {
    const { animeId } = c.req.param();
    const decodedAnimeId = decodeURIComponent(animeId);
    const db = await getDB();
    const comments = await db.collection("comments")
        .find({ animeId: decodedAnimeId })
        .sort({ createdAt: -1 })
        .toArray();

    const uids = Array.from(new Set(comments.map((x: any) => x.userId).filter(Boolean)));
    let profiles: Record<string, any> = {};
    if (uids.length) {
        const { getProfilesBatch } = await import("../helpers/profileCache.js");
        profiles = await getProfilesBatch(db, uids);
    }

    const formattedComments = comments.map((cm: any) => {
        const p = profiles[cm.userId] || null;
        const fallback = { uid: cm.userId, username: cm.username ?? "unknown", avatarUrl: cm.userAvatar ?? null, displayName: null };
        return { ...cm, _id: cm._id.toString(), user: p ?? fallback };
    });

    return c.json({ success: true, data: formattedComments });
});

// Post a new comment - Protected
commentsRouter.post("/", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json();
    const { animeId, episodeId, userId: bodyUserId, content, parentId, isSpoiler } = body;

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!animeId || !userId || !content) {
        return c.json({ success: false, error: "Missing required fields" }, 400);
    }

    if (isFirebaseConfigured() && verifiedUid && bodyUserId && verifiedUid !== bodyUserId) {
        return c.json({ success: false, error: "Cannot post comment as another user" }, 403);
    }

    if (content.length > 500) {
        return c.json({ success: false, error: "Comment exceeds 500 character limit" }, 400);
    }

    const db = await getDB();
    const comment = {
        animeId,
        episodeId: episodeId || null,
        userId,
        content,
        parentId: parentId || null,
        isSpoiler: isSpoiler || false,
        likes: [],
        createdAt: Date.now(),
        isEdited: false,
    };

    const result = await db.collection("comments").insertOne(comment);
    return c.json({ success: true, data: { ...comment, _id: result.insertedId.toString() } });
});

// Edit a comment - Protected
commentsRouter.put("/:commentId", authMiddleware, async (c) => {
    const { commentId } = c.req.param();
    const body = c.get("parsedBody") || await c.req.json();
    const { content, userId: bodyUserId } = body;

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!content || !userId) {
        return c.json({ success: false, error: "Content and userId are required" }, 400);
    }

    if (content.length > 500) {
        return c.json({ success: false, error: "Comment exceeds 500 character limit" }, 400);
    }

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) return c.json({ success: false, error: "Comment not found" }, 404);

    if (comment.userId !== userId) {
        return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    await db.collection("comments").updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { content, isEdited: true, updatedAt: Date.now() } }
    );

    return c.json({ success: true });
});

// Delete a comment - Protected
commentsRouter.delete("/:commentId", authMiddleware, async (c) => {
    const { commentId } = c.req.param();
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { userId: bodyUserId } = body;

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!userId) return c.json({ success: false, error: "userId is required" }, 400);

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) return c.json({ success: false, error: "Comment not found" }, 404);

    if (comment.userId !== userId) {
        return c.json({ success: false, error: "Unauthorized" }, 403);
    }

    await db.collection("comments").deleteMany({
        $or: [
            { _id: new ObjectId(commentId) },
            { parentId: commentId },
        ],
    });

    return c.json({ success: true });
});

// Like/Unlike a comment - Protected
commentsRouter.post("/:commentId/like", authMiddleware, async (c) => {
    const { commentId } = c.req.param();
    const body = c.get("parsedBody") || await c.req.json();
    const { userId: bodyUserId } = body;

    const verifiedUid = getVerifiedUid(c);
    const userId = verifiedUid || bodyUserId;

    if (!userId) return c.json({ success: false, error: "userId is required" }, 400);

    if (isFirebaseConfigured() && verifiedUid && bodyUserId && verifiedUid !== bodyUserId) {
        return c.json({ success: false, error: "Cannot like as another user" }, 403);
    }

    const db = await getDB();
    const comment = await db.collection("comments").findOne({ _id: new ObjectId(commentId) });

    if (!comment) return c.json({ success: false, error: "Comment not found" }, 404);

    const likes = comment.likes || [];
    const hasLiked = likes.includes(userId);

    if (hasLiked) {
        await db.collection("comments").updateOne(
            { _id: new ObjectId(commentId) },
            { $pull: { likes: userId } }
        );
    } else {
        await db.collection("comments").updateOne(
            { _id: new ObjectId(commentId) },
            { $addToSet: { likes: userId } }
        );
    }

    return c.json({ success: true, liked: !hasLiked });
});
