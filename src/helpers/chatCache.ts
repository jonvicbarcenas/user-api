import { cache } from "../config/cache.js";
import type { Db } from "mongodb";

const CHAT_CACHE_TTL = 10; // 10 seconds
const UNREAD_CACHE_TTL = 15; // 15 seconds

export function makeChatMessagesCacheKey(
    limit: number,
    after?: number,
    before?: number
): string {
    const parts = [`chat:messages:limit:${limit}`];
    if (typeof after === "number") parts.push(`after:${after}`);
    if (typeof before === "number") parts.push(`before:${before}`);
    return parts.join(":");
}

export function makeUnreadCountCacheKey(userId: string): string {
    return `chat:unread:${userId}`;
}

export async function getCachedChatMessages(
    db: Db,
    limit: number,
    after?: number,
    before?: number
): Promise<{ messages: any[]; hasMore: boolean }> {
    const cacheKey = makeChatMessagesCacheKey(limit, after, before);

    return await cache.getOrSet(
        async () => {
            const createdAtQuery: Record<string, number> = {};
            if (Number.isFinite(after)) createdAtQuery.$gt = after!;
            if (Number.isFinite(before)) createdAtQuery.$lt = before!;

            const query: Record<string, unknown> = {};
            if (Object.keys(createdAtQuery).length > 0) {
                query.createdAt = createdAtQuery;
            }

            const docs = await db
                .collection("chatMessages")
                .find(query)
                .sort({ createdAt: -1 })
                .limit(limit + 1)
                .toArray();

            const hasMore = docs.length > limit;
            const messages = docs
                .slice(0, limit)
                .map((m) => ({
                    ...m,
                    _id: m._id.toString(),
                }))
                .reverse();

            return { messages, hasMore };
        },
        cacheKey,
        CHAT_CACHE_TTL
    );
}

export async function getCachedUnreadCount(
    db: Db,
    userId: string
): Promise<number> {
    const cacheKey = makeUnreadCountCacheKey(userId);

    return await cache.getOrSet(
        async () => {
            const count = await db.collection("chatMessages").countDocuments({
                $or: [
                    { seenBy: { $exists: false } },
                    { seenBy: { $size: 0 } },
                    { seenBy: { $not: { $elemMatch: { userId } } } },
                ],
            });
            return count;
        },
        cacheKey,
        UNREAD_CACHE_TTL
    );
}

export async function invalidateChatMessagesCache(): Promise<void> {
    try {
        const anyCache = cache as unknown as { enabled?: boolean; client?: any };
        if (!anyCache?.enabled || !anyCache?.client) {
            console.info("Chat cache invalidation: cache not enabled, skipping");
            return;
        }
        const client = anyCache.client;
        const pattern = "chat:messages:*";
        let cursor = "0";
        const keys: string[] = [];
        do {
            const res = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
            cursor = res[0];
            const batch = res[1] as string[];
            if (Array.isArray(batch) && batch.length) keys.push(...batch);
        } while (cursor !== "0");
        if (keys.length) {
            await client.del(...keys);
            console.info(`Chat cache invalidated: ${keys.length} keys deleted`);
        } else {
            console.info("Chat cache invalidation: no keys to delete");
        }
    } catch (err) {
        console.warn("Chat cache invalidation failed:", (err as Error)?.message || err);
    }
}

export async function invalidateUnreadCountCache(userId: string): Promise<void> {
    console.info(`Unread count cache invalidation triggered for user: ${userId}`);
}
