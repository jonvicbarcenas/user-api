import type { Context, Next } from "hono";
import type { ServerContext } from "../config/context.js";
import { verifyIdToken, isFirebaseConfigured } from "../config/firebase.js";
import { getDB } from "../config/mongodb.js";
import { log } from "../config/logger.js";

export interface AuthVariables {
    uid: string;
    email?: string;
    isAdmin: boolean;
}

function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
    return parts[1];
}

export async function authMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            c.set("uid", decoded.uid);
            c.set("email", decoded.email);

            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                c.set("isAdmin", user?.isAdmin === true);
            } catch {
                c.set("isAdmin", false);
            }

            return next();
        }
    }

    return c.json({ success: false, error: "Invalid or missing authorization" }, 401);
}

export async function optionalAuthMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            c.set("uid", decoded.uid);
            c.set("email", decoded.email);

            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                c.set("isAdmin", user?.isAdmin === true);
            } catch {
                c.set("isAdmin", false);
            }
        }
    }

    return next();
}

export async function adminMiddleware(c: Context<ServerContext>, next: Next) {
    const authHeader = c.req.header("Authorization");
    const token = extractBearerToken(authHeader);

    if (isFirebaseConfigured() && token) {
        const decoded = await verifyIdToken(token);
        if (decoded) {
            try {
                const db = await getDB();
                const user = await db.collection("users").findOne({ uid: decoded.uid });
                if (!user || user.isAdmin !== true) {
                    return c.json({ success: false, error: "Unauthorized - Admin access required" }, 403);
                }

                c.set("uid", decoded.uid);
                c.set("email", decoded.email);
                c.set("isAdmin", true);
                return next();
            } catch (error) {
                log.error(`Admin check failed: ${error instanceof Error ? error.message : error}`);
                return c.json({ success: false, error: "Authorization check failed" }, 500);
            }
        }
    }

    return c.json({ success: false, error: "Invalid or missing authorization" }, 401);
}

export function getVerifiedUid(c: Context<ServerContext>): string | undefined {
    return c.get("uid");
}

export function isAdmin(c: Context<ServerContext>): boolean {
    return c.get("isAdmin") === true;
}
