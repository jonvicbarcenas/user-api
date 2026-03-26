import { Redis } from "ioredis";
import { env } from "./env.js";

export class UserAPICache {
    private static instance: UserAPICache | null = null;

    private client: Redis | null;
    public enabled: boolean = false;

    static enabled = false;
    // 5 mins
    static DEFAULT_CACHE_EXPIRY_SECONDS = 300 as const;
    static CACHE_EXPIRY_HEADER_NAME = "User-Cache-Expiry" as const;

    constructor() {
        const redisConnURL = env.USER_API_REDIS_CONN_URL;
        this.enabled = UserAPICache.enabled = Boolean(redisConnURL);

        if (this.enabled) {
            const urlString = String(redisConnURL);

            this.client = new Redis(urlString, {
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
                lazyConnect: false,
            });

            this.client.on("connect", () => {
                console.info("Redis cache connected successfully");
            });

            this.client.on("error", (err) => {
                console.error("Redis cache error:", err.message);
            });
        } else {
            this.client = null;
        }
    }

    static getInstance() {
        if (!UserAPICache.instance) {
            UserAPICache.instance = new UserAPICache();
        }
        return UserAPICache.instance;
    }

    async getOrSet<T>(
        dataGetter: () => Promise<T>,
        key: string,
        expirySeconds: number = UserAPICache.DEFAULT_CACHE_EXPIRY_SECONDS
    ) {
        const cachedData = this.enabled
            ? (await this.client?.get?.(key)) || null
            : null;
        let data = JSON.parse(String(cachedData)) as T;

        if (!data) {
            data = await dataGetter();
            await this.client?.set?.(key, JSON.stringify(data), "EX", expirySeconds);
        }
        return data;
    }

    closeConnection() {
        this.client
            ?.quit()
            ?.then(() => {
                this.client = null;
                UserAPICache.instance = null;
                console.info("user-api redis connection closed and cache instance reset");
            })
            .catch((err) => {
                console.error(`user-api error while closing redis connection: ${err}`);
            });
    }
}

export const cache = UserAPICache.getInstance();
