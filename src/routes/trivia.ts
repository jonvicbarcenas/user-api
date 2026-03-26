import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { authMiddleware, getVerifiedUid } from "../middleware/auth.js";

export const triviaRouter = new Hono<ServerContext>();

// POST /score — Save a trivia game result
triviaRouter.post("/score", authMiddleware, async (c) => {
    const uid = getVerifiedUid(c);
    if (!uid) return c.json({ success: false, error: "Unauthorized" }, 401);

    const body = c.get("parsedBody") || await c.req.json();
    const { score, correct, total, difficulty } = body;

    if (typeof score !== "number" || typeof correct !== "number" || typeof total !== "number") {
        return c.json({ success: false, error: "Invalid payload" }, 400);
    }

    const db = await getDB();

    const entry = {
        uid,
        score,
        correct,
        total,
        difficulty: difficulty || "any",
        accuracy: Math.round((correct / total) * 100),
        playedAt: Date.now(),
    };

    await db.collection("triviaScores").insertOne(entry);

    await db.collection("triviaBest").updateOne(
        { uid },
        {
            $max: { bestScore: score },
            $inc: { gamesPlayed: 1, totalCorrect: correct, totalQuestions: total },
            $set: { uid, lastPlayedAt: Date.now() },
        },
        { upsert: true }
    );

    return c.json({ success: true });
});

// GET /best/:uid — Get best score for a user
triviaRouter.get("/best/:uid", async (c) => {
    const { uid } = c.req.param();
    const db = await getDB();
    const best = await db.collection("triviaBest").findOne({ uid });
    return c.json({ success: true, data: best });
});

// GET /leaderboard — Top players by best score
triviaRouter.get("/leaderboard", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitRaw ?? 10) || 10, 1), 50);

    const db = await getDB();

    const pipeline = [
        { $sort: { bestScore: -1 } },
        { $limit: limit },
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
                username: { $ifNull: [{ $arrayElemAt: ["$user.username", 0] }, "Anonymous"] },
                photoURL: { $ifNull: [{ $arrayElemAt: ["$user.photoURL", 0] }, null] },
            },
        },
        {
            $project: {
                _id: 0,
                uid: 1,
                username: 1,
                photoURL: 1,
                bestScore: 1,
                gamesPlayed: 1,
                totalCorrect: 1,
                totalQuestions: 1,
                lastPlayedAt: 1,
            },
        },
    ];

    const leaderboard = await db.collection("triviaBest").aggregate(pipeline).toArray();
    return c.json({ success: true, data: leaderboard });
});

// GET /history/:uid — Recent game history
triviaRouter.get("/history/:uid", authMiddleware, async (c) => {
    const { uid: paramUid } = c.req.param();
    const verifiedUid = getVerifiedUid(c);
    if (verifiedUid && verifiedUid !== paramUid) {
        return c.json({ success: false, error: "Forbidden" }, 403);
    }

    const limitRaw = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitRaw ?? 10) || 10, 1), 50);

    const db = await getDB();
    const history = await db
        .collection("triviaScores")
        .find({ uid: paramUid })
        .sort({ playedAt: -1 })
        .limit(limit)
        .toArray();

    return c.json({ success: true, data: history });
});
