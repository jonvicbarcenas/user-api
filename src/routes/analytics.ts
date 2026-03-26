import { Hono } from "hono";
import { getDB } from "../config/mongodb.js";
import type { ServerContext } from "../config/context.js";
import { adminMiddleware } from "../middleware/auth.js";

export const analyticsRouter = new Hono<ServerContext>();

// GET /overview
analyticsRouter.get("/overview", adminMiddleware, async (c) => {
    const db = await getDB();
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60_000;
    const twentyFourHAgo = now - 24 * 60 * 60_000;

    const [
        totalUsers,
        activeNowUids,
        activeTodayUids,
        totalWatchSessions,
        totalComments,
        totalChatMessages,
    ] = await Promise.all([
        db.collection("users").countDocuments(),
        db.collection("watchHistory").distinct("uid", { watchedAt: { $gte: fiveMinAgo } }),
        db.collection("watchHistory").distinct("uid", { watchedAt: { $gte: twentyFourHAgo } }),
        db.collection("watchHistory").countDocuments(),
        db.collection("comments").countDocuments(),
        db.collection("chatMessages").countDocuments(),
    ]);

    return c.json({
        success: true,
        data: {
            totalUsers,
            activeNow: activeNowUids.length,
            activeToday: activeTodayUids.length,
            totalWatchSessions,
            totalComments,
            totalChatMessages,
        },
    });
});

// GET /watch-trends?days=7
analyticsRouter.get("/watch-trends", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 7) || 7, 1), 30);
    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        { $match: { watchedAt: { $gte: since } } },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$watchedAt" } } },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
    ];

    const trends = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: trends });
});

// GET /top-anime?limit=10
analyticsRouter.get("/top-anime", adminMiddleware, async (c) => {
    const limitParam = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 50);
    const db = await getDB();

    const pipeline = [
        { $group: { _id: "$animeId", name: { $first: "$name" }, image: { $first: "$image" }, count: { $sum: 1 } } },
        { $sort: { count: -1 as const } },
        { $limit: limit },
        { $project: { _id: 0, animeId: "$_id", name: 1, image: 1, count: 1 } },
    ];

    const top = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data: top });
});

// GET /user-growth?days=30
analyticsRouter.get("/user-growth", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 30) || 30, 1), 90);
    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        { $addFields: { ts: { $ifNull: ["$createdAt", "$updatedAt"] } } },
        { $match: { ts: { $gte: since } } },
        {
            $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$ts" } } },
                count: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, date: "$_id", count: 1 } },
    ];

    const growth = await db.collection("users").aggregate(pipeline).toArray();
    return c.json({ success: true, data: growth });
});

// GET /unique-viewers?limit=10
analyticsRouter.get("/unique-viewers", adminMiddleware, async (c) => {
    const limitParam = c.req.query("limit");
    const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 50);
    const db = await getDB();

    const pipeline = [
        { $group: { _id: { animeId: "$animeId", uid: "$uid" }, name: { $first: "$name" }, image: { $first: "$image" } } },
        { $group: { _id: "$_id.animeId", name: { $first: "$name" }, image: { $first: "$image" }, uniqueViewers: { $sum: 1 } } },
        { $sort: { uniqueViewers: -1 as const } },
        { $limit: limit },
        { $project: { _id: 0, animeId: "$_id", name: 1, image: 1, uniqueViewers: 1 } },
    ];

    const data = await db.collection("watchHistory").aggregate(pipeline).toArray();
    return c.json({ success: true, data });
});

// GET /peak-hours?days=7
analyticsRouter.get("/peak-hours", adminMiddleware, async (c) => {
    const daysParam = c.req.query("days");
    const days = Math.min(Math.max(Number(daysParam ?? 7) || 7, 1), 30);
    const since = Date.now() - days * 24 * 60 * 60_000;
    const db = await getDB();

    const pipeline = [
        { $match: { watchedAt: { $gte: since } } },
        { $group: { _id: { $hour: { $toDate: "$watchedAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 as const } },
        { $project: { _id: 0, hour: "$_id", count: 1 } },
    ];

    const raw = await db.collection("watchHistory").aggregate(pipeline).toArray();
    const byHour = new Map(raw.map((r: any) => [r.hour, r.count]));
    const data = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: (byHour.get(h) as number) ?? 0,
    }));

    return c.json({ success: true, data });
});
