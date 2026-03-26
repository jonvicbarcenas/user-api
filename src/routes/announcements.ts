import { Hono } from "hono";
import { ObjectId } from "mongodb";
import type { ServerContext } from "../config/context.js";
import { getDB } from "../config/mongodb.js";
import { adminMiddleware, getVerifiedUid } from "../middleware/auth.js";

export type AnnouncementPriority = "low" | "medium" | "high" | "critical";
export type AnnouncementType = "info" | "warning" | "maintenance" | "update" | "event";

export interface Announcement {
    _id?: ObjectId;
    subject: string;
    content: string;
    priority: AnnouncementPriority;
    type: AnnouncementType;
    isActive: boolean;
    isPinned: boolean;
    showOnce: boolean;
    startsAt?: number;
    expiresAt?: number;
    createdAt: number;
    updatedAt: number;
    createdBy: { uid: string; username: string };
}

const COLLECTION = "announcements";

export const announcementsRouter = new Hono<ServerContext>();

announcementsRouter.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
});

// GET / — Active announcements (public)
announcementsRouter.get("/", async (c) => {
    try {
        const db = await getDB();
        const now = Date.now();

        const announcements = await db
            .collection(COLLECTION)
            .find({
                isActive: true,
                $or: [
                    { startsAt: { $exists: false } },
                    { startsAt: { $eq: null } },
                    { startsAt: { $lte: now } },
                ],
                $and: [
                    {
                        $or: [
                            { expiresAt: { $exists: false } },
                            { expiresAt: { $eq: null } },
                            { expiresAt: { $gt: now } },
                        ],
                    },
                ],
            })
            .sort({ isPinned: -1, priority: -1, createdAt: -1 })
            .toArray() as Announcement[];

        const priorityOrder: Record<AnnouncementPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        const sorted = announcements.sort((a, b) => {
            if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
            const diff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (diff !== 0) return diff;
            return b.createdAt - a.createdAt;
        });

        return c.json({ success: true, data: sorted });
    } catch (e) {
        return c.json({ success: false, error: e instanceof Error ? e.message : "Failed to fetch announcements" }, 500);
    }
});

// GET /admin — All announcements (admin only)
announcementsRouter.get("/admin", adminMiddleware, async (c) => {
    try {
        const db = await getDB();
        const announcements = await db.collection(COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
        return c.json({ success: true, data: announcements });
    } catch (e) {
        return c.json({ success: false, error: e instanceof Error ? e.message : "Failed to fetch announcements" }, 500);
    }
});

// POST / — Create announcement (admin only)
announcementsRouter.post("/", adminMiddleware, async (c) => {
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { subject, content, priority, type, isActive, isPinned, showOnce, startsAt, expiresAt } = body as {
        subject?: string; content?: string; priority?: AnnouncementPriority; type?: AnnouncementType;
        isActive?: boolean; isPinned?: boolean; showOnce?: boolean; startsAt?: number; expiresAt?: number;
    };

    const uid = getVerifiedUid(c);
    if (!subject || !content) return c.json({ success: false, error: "subject and content are required" }, 400);

    const validPriorities: AnnouncementPriority[] = ["low", "medium", "high", "critical"];
    const validTypes: AnnouncementType[] = ["info", "warning", "maintenance", "update", "event"];
    if (priority && !validPriorities.includes(priority)) return c.json({ success: false, error: "Invalid priority" }, 400);
    if (type && !validTypes.includes(type)) return c.json({ success: false, error: "Invalid type" }, 400);

    try {
        const db = await getDB();
        const user = await db.collection("users").findOne({ uid });
        const now = Date.now();

        const announcement: Announcement = {
            subject: subject.trim(),
            content: content.trim(),
            priority: priority || "medium",
            type: type || "info",
            isActive: isActive !== false,
            isPinned: isPinned === true,
            showOnce: showOnce === true,
            startsAt: startsAt || undefined,
            expiresAt: expiresAt || undefined,
            createdAt: now,
            updatedAt: now,
            createdBy: { uid: uid || "unknown", username: user?.username || "Admin" },
        };

        const result = await db.collection(COLLECTION).insertOne(announcement);
        return c.json({ success: true, data: { ...announcement, _id: result.insertedId } });
    } catch (e) {
        return c.json({ success: false, error: e instanceof Error ? e.message : "Failed to create announcement" }, 500);
    }
});

// PUT /:id — Update announcement (admin only)
announcementsRouter.put("/:id", adminMiddleware, async (c) => {
    const id = c.req.param("id");
    const body = c.get("parsedBody") || await c.req.json().catch(() => ({}));
    const { subject, content, priority, type, isActive, isPinned, showOnce, startsAt, expiresAt } = body as {
        subject?: string; content?: string; priority?: AnnouncementPriority; type?: AnnouncementType;
        isActive?: boolean; isPinned?: boolean; showOnce?: boolean; startsAt?: number | null; expiresAt?: number | null;
    };

    if (!ObjectId.isValid(id)) return c.json({ success: false, error: "Invalid announcement ID" }, 400);

    try {
        const db = await getDB();
        const existing = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
        if (!existing) return c.json({ success: false, error: "Announcement not found" }, 404);

        const update: Partial<Announcement> = { updatedAt: Date.now() };
        if (subject !== undefined) update.subject = subject.trim();
        if (content !== undefined) update.content = content.trim();
        if (priority !== undefined) update.priority = priority;
        if (type !== undefined) update.type = type;
        if (isActive !== undefined) update.isActive = isActive;
        if (isPinned !== undefined) update.isPinned = isPinned;
        if (showOnce !== undefined) update.showOnce = showOnce;
        if (startsAt !== undefined) update.startsAt = startsAt || undefined;
        if (expiresAt !== undefined) update.expiresAt = expiresAt || undefined;

        await db.collection(COLLECTION).updateOne({ _id: new ObjectId(id) }, { $set: update });
        const updated = await db.collection(COLLECTION).findOne({ _id: new ObjectId(id) });
        return c.json({ success: true, data: updated });
    } catch (e) {
        return c.json({ success: false, error: e instanceof Error ? e.message : "Failed to update announcement" }, 500);
    }
});

// DELETE /:id — Delete announcement (admin only)
announcementsRouter.delete("/:id", adminMiddleware, async (c) => {
    const id = c.req.param("id");
    if (!ObjectId.isValid(id)) return c.json({ success: false, error: "Invalid announcement ID" }, 400);

    try {
        const db = await getDB();
        const result = await db.collection(COLLECTION).deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return c.json({ success: false, error: "Announcement not found" }, 404);
        return c.json({ success: true, message: "Announcement deleted" });
    } catch (e) {
        return c.json({ success: false, error: e instanceof Error ? e.message : "Failed to delete announcement" }, 500);
    }
});
