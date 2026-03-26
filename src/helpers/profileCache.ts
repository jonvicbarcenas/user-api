import type { Db } from "mongodb";
import { cache } from "../config/cache.js";
import { env } from "../config/env.js";

function getApiBase(): string {
    return env.USER_API_HOSTNAME
        ? `https://${env.USER_API_HOSTNAME}`
        : "";
}

export type PublicUserProfile = {
    uid: string;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
};

const PROFILE_TTL_SECONDS = 5 * 60; // 5 minutes

function profileCacheKey(uid: string) {
    return `user:profile:${uid}`;
}

function toPublicProfile(doc: any | null, apiBase?: string): PublicUserProfile | null {
    if (!doc) return null;
    const uid = String(doc.uid);
    const avatarUrl = apiBase
        ? `${apiBase}/api/v2/user/${encodeURIComponent(uid)}/avatar`
        : (doc.avatarUrl ?? doc.photoURL ?? null);
    return {
        uid,
        username: doc.username ?? null,
        displayName: doc.displayName ?? null,
        avatarUrl,
    };
}

export async function getProfile(db: Db, uid: string): Promise<PublicUserProfile | null> {
    const key = profileCacheKey(uid);
    const apiBase = getApiBase();
    return await cache.getOrSet(async () => {
        const doc = await db.collection("users").findOne({ uid });
        return toPublicProfile(doc, apiBase);
    }, key, PROFILE_TTL_SECONDS);
}

export async function getProfilesBatch(
    db: Db,
    uids: string[]
): Promise<Record<string, PublicUserProfile | null>> {
    const unique = Array.from(new Set(uids.filter(Boolean)));
    const result: Record<string, PublicUserProfile | null> = {};
    if (unique.length === 0) return result;

    const anyCache = cache as unknown as { enabled?: boolean; client?: any };

    let cachedMap: Record<string, PublicUserProfile | null> = {};
    const misses: string[] = [];

    if (anyCache?.enabled && anyCache.client) {
        const keys = unique.map(profileCacheKey);
        const values = await anyCache.client.mget(keys);
        for (let i = 0; i < unique.length; i++) {
            const uid = unique[i];
            const raw = values?.[i];
            if (raw) {
                try {
                    cachedMap[uid] = JSON.parse(raw);
                } catch {
                    cachedMap[uid] = null;
                    misses.push(uid);
                }
            } else {
                misses.push(uid);
            }
        }
    } else {
        misses.push(...unique);
    }

    if (misses.length) {
        const apiBase = getApiBase();
        const docs = await db
            .collection("users")
            .find({ uid: { $in: misses } })
            .toArray();

        const mapFromDb: Record<string, PublicUserProfile | null> = {};
        for (const doc of docs) {
            const p = toPublicProfile(doc, apiBase);
            if (p) mapFromDb[p.uid] = p;
        }
        for (const uid of misses) {
            if (!(uid in mapFromDb)) mapFromDb[uid] = null;
        }

        if (anyCache?.enabled && anyCache.client) {
            const pipeline = anyCache.client.multi();
            for (const uid of misses) {
                const key = profileCacheKey(uid);
                pipeline.setex(key, PROFILE_TTL_SECONDS, JSON.stringify(mapFromDb[uid]));
            }
            await pipeline.exec();
        }

        cachedMap = { ...cachedMap, ...mapFromDb };
    }

    for (const uid of unique) {
        result[uid] = cachedMap[uid] ?? null;
    }
    return result;
}

export async function invalidateProfileCache(uid: string): Promise<void> {
    try {
        const anyCache = cache as unknown as { enabled?: boolean; client?: any };
        if (!anyCache?.enabled || !anyCache?.client) return;
        await anyCache.client.del(profileCacheKey(uid));
    } catch (err) {
        console.warn("Profile cache invalidation failed:", (err as Error)?.message || err);
    }
}
