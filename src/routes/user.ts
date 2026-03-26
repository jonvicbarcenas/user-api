import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { authMiddleware, adminMiddleware, getVerifiedUid } from "../middleware/auth.js";
import { isFirebaseConfigured } from "../config/firebase.js";

export const userRouter = new Hono<ServerContext>();

// Get user profile by uid (public - needed for login flow)
userRouter.get("/profile/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const profile = await db.collection("users").findOne({ uid });
    return c.json({ success: true, data: profile });
});

/**
 * Centralized avatar endpoint — always returns the latest avatar for a user.
 * GET /api/v2/user/:uid/avatar
 */
userRouter.get("/:uid/avatar", async (c) => {
    const { uid } = c.req.param();
    const FALLBACK = "https://api.dicebear.com/8.x/thumbs/svg?seed=" + encodeURIComponent(uid);

    try {
        const db = await getDB();
        const profile = await db.collection("users").findOne(
            { uid },
            { projection: { avatarUrl: 1, photoURL: 1 } }
        );

        const avatarUrl = profile?.avatarUrl || profile?.photoURL;

        if (avatarUrl && typeof avatarUrl === "string" && avatarUrl.startsWith("http")) {
            c.header("Cache-Control", "no-store, no-cache, must-revalidate");
            c.header("Pragma", "no-cache");
            return c.redirect(avatarUrl, 302);
        }

        c.header("Cache-Control", "no-store, no-cache, must-revalidate");
        return c.redirect(FALLBACK, 302);
    } catch {
        return c.redirect(FALLBACK, 302);
    }
});

// Get user profile by username (case-insensitive) - public for login
userRouter.get("/profile/by-username/:username", async (c) => {
    const { username } = c.req.param();
    const uname = String(username).trim();
    const escaped = uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`^${escaped}$`, "i");
    const db = await getDB();
    const profile = await db.collection("users").findOne({ username: { $regex: regex } });
    return c.json({ success: true, data: profile });
});

// Create/Update user profile - Protected
userRouter.post("/profile", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json();
    const { uid: bodyUid, username, ...profileData } = body;

    const verifiedUid = getVerifiedUid(c);
    const uid = verifiedUid || bodyUid;

    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    if (isFirebaseConfigured() && verifiedUid && bodyUid && verifiedUid !== bodyUid) {
        return c.json({ success: false, error: "Cannot update another user's profile" }, 403);
    }

    const db = await getDB();

    let finalUsername: string | undefined = undefined;
    if (typeof username === "string" && username.trim()) {
        const uname = username.trim();
        const escaped = uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`^${escaped}$`, "i");
        const existing = await db
            .collection("users")
            .findOne({ username: { $regex: regex }, uid: { $ne: uid } });
        if (existing) {
            return c.json({ success: false, error: "username-taken" }, 409);
        }
        finalUsername = uname.toLowerCase();
    }

    const isCurrentlyAdmin = c.get("isAdmin");
    if (profileData.isAdmin !== undefined && !isCurrentlyAdmin) {
        delete profileData.isAdmin;
    }

    await db.collection("users").updateOne(
        { uid },
        {
            $set: {
                ...profileData,
                uid,
                ...(finalUsername ? { username: finalUsername } : {}),
                updatedAt: Date.now(),
            },
        },
        { upsert: true }
    );

    try {
        const { invalidateProfileCache } = await import("../helpers/profileCache.js");
        await invalidateProfileCache(uid);
    } catch {}

    return c.json({ success: true });
});

// Get watchlist - Protected
userRouter.get("/watchlist/:uid", authMiddleware, async (c) => {
    const { uid: paramUid } = c.req.param();
    const verifiedUid = getVerifiedUid(c);

    if (isFirebaseConfigured() && verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Cannot access another user's watchlist" }, 403);
    }

    const uid = verifiedUid || paramUid;
    const db = await getDB();
    const items = await db.collection("watchlist")
        .find({ uid })
        .sort({ addedAt: -1 })
        .toArray();
    return c.json({ success: true, data: items });
});

// Add/Update watchlist item - Protected
userRouter.post("/watchlist", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json();
    const { uid: bodyUid, animeId, ...itemData } = body;

    const verifiedUid = getVerifiedUid(c);
    const uid = verifiedUid || bodyUid;

    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    if (isFirebaseConfigured() && verifiedUid && bodyUid && verifiedUid !== bodyUid) {
        return c.json({ success: false, error: "Cannot modify another user's watchlist" }, 403);
    }

    const db = await getDB();
    await db.collection("watchlist").updateOne(
        { uid, animeId },
        {
            $set: { ...itemData, uid, animeId, updatedAt: Date.now() },
            $setOnInsert: { addedAt: Date.now() },
        },
        { upsert: true }
    );
    return c.json({ success: true });
});

// Remove from watchlist - Protected
userRouter.delete("/watchlist/:uid/:animeId", authMiddleware, async (c) => {
    const { uid: paramUid, animeId } = c.req.param();
    const verifiedUid = getVerifiedUid(c);

    if (isFirebaseConfigured() && verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Cannot modify another user's watchlist" }, 403);
    }

    const uid = verifiedUid || paramUid;
    const db = await getDB();
    await db.collection("watchlist").deleteOne({ uid, animeId });
    return c.json({ success: true });
});

// Get watch history - Protected
userRouter.get("/history/:uid", authMiddleware, async (c) => {
    const { uid: paramUid } = c.req.param();
    const verifiedUid = getVerifiedUid(c);

    if (isFirebaseConfigured() && verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Cannot access another user's history" }, 403);
    }

    const uid = verifiedUid || paramUid;
    const db = await getDB();
    const items = await db.collection("watchHistory")
        .find({ uid })
        .sort({ watchedAt: -1 })
        .toArray();
    return c.json({ success: true, data: items });
});

// Add/Update watch history - Protected
userRouter.post("/history", authMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json();
    const { uid: bodyUid, animeId, episodeNum, ...itemData } = body;

    const verifiedUid = getVerifiedUid(c);
    const uid = verifiedUid || bodyUid;

    if (!uid) return c.json({ success: false, error: "uid required" }, 400);

    if (isFirebaseConfigured() && verifiedUid && bodyUid && verifiedUid !== bodyUid) {
        return c.json({ success: false, error: "Cannot modify another user's history" }, 403);
    }

    const db = await getDB();
    await db.collection("watchHistory").updateOne(
        { uid, animeId, episodeNum },
        { $set: { ...itemData, uid, animeId, episodeNum, watchedAt: Date.now() } },
        { upsert: true }
    );
    return c.json({ success: true });
});

// Clear watch history - Protected
userRouter.delete("/history/:uid", authMiddleware, async (c) => {
    const { uid: paramUid } = c.req.param();
    const verifiedUid = getVerifiedUid(c);

    if (isFirebaseConfigured() && verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Cannot clear another user's history" }, 403);
    }

    const uid = verifiedUid || paramUid;
    const db = await getDB();
    await db.collection("watchHistory").deleteMany({ uid });
    return c.json({ success: true });
});

// Remove specific history item - Protected
userRouter.delete("/history/:uid/:animeId/:episodeNum", authMiddleware, async (c) => {
    const { uid: paramUid, animeId, episodeNum } = c.req.param();
    const verifiedUid = getVerifiedUid(c);

    if (isFirebaseConfigured() && verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Cannot modify another user's history" }, 403);
    }

    const uid = verifiedUid || paramUid;
    const db = await getDB();
    await db.collection("watchHistory").deleteOne({
        uid,
        animeId,
        episodeNum: parseInt(episodeNum),
    });
    return c.json({ success: true });
});

// Admin: get most recent watchers across all users
userRouter.get("/admin/recent-watchers", adminMiddleware, async (c) => {
    const limitRaw = c.req.query("limit");
    const activeWithinRaw = c.req.query("activeWithinMinutes");

    const limit = Math.min(Math.max(Number(limitRaw ?? 25) || 25, 1), 200);
    const activeWithinMinutes = activeWithinRaw ? Number(activeWithinRaw) : undefined;
    const activeSince = Number.isFinite(activeWithinMinutes)
        ? Date.now() - Math.max(activeWithinMinutes!, 0) * 60_000
        : undefined;

    const db = await getDB();

    const matchStage: Record<string, unknown> = {};
    if (Number.isFinite(activeSince)) {
        matchStage.watchedAt = { $gte: activeSince };
    }

    const pipeline: any[] = [];
    if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

    pipeline.push(
        { $sort: { watchedAt: -1 } },
        {
            $group: {
                _id: "$uid",
                uid: { $first: "$uid" },
                animeId: { $first: "$animeId" },
                name: { $first: "$name" },
                image: { $first: "$image" },
                type: { $first: "$type" },
                episodeNum: { $first: "$episodeNum" },
                episodeId: { $first: "$episodeId" },
                watchedAt: { $first: "$watchedAt" },
                timeWatched: { $first: "$timeWatched" },
                duration: { $first: "$duration" },
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "uid",
                foreignField: "uid",
                as: "user",
            },
        },
        {
            $addFields: {
                username: { $ifNull: [{ $arrayElemAt: ["$user.username", 0] }, "unknown"] },
            },
        },
        {
            $project: {
                _id: 0,
                uid: 1,
                username: 1,
                animeId: 1,
                name: 1,
                image: 1,
                type: 1,
                episodeNum: 1,
                episodeId: 1,
                watchedAt: 1,
                timeWatched: 1,
                duration: 1,
            },
        },
        { $sort: { watchedAt: -1 } },
        { $limit: limit }
    );

    const items = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: items });
});
