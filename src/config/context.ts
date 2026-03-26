import type { Prettify } from "../utils.js";

type ServerContextVariables = Prettify<{
    CACHE_CONFIG: {
        key: string;
        duration: number;
    };
    /** Verified user ID from Firebase token */
    uid?: string;
    /** Verified user email from Firebase token */
    email?: string;
    /** Whether the authenticated user is an admin */
    isAdmin?: boolean;
    /** Pre-parsed request body (used when body is consumed by middleware) */
    parsedBody?: any;
}>;

export type ServerContext = Prettify<{
    Variables: ServerContextVariables;
}>;
