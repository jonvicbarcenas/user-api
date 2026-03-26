import { config } from "dotenv";
import { cleanEnv, num, str, url, port } from "envalid";

config();

export enum DeploymentEnv {
    NODEJS = "nodejs",
    DOCKER = "docker",
    VERCEL = "vercel",
    CLOUDFLARE_WORKERS = "cloudflare-workers",
    RENDER = "render",
}
export const API_DEPLOYMENT_ENVIRONMENTS = Object.values(DeploymentEnv);
export const SERVERLESS_ENVIRONMENTS = [
    DeploymentEnv.VERCEL,
    DeploymentEnv.CLOUDFLARE_WORKERS,
    DeploymentEnv.RENDER,
];

export const env = cleanEnv(process.env, {
    // Firebase Admin SDK Configuration
    FIREBASE_PROJECT_ID: str({
        default: undefined,
        desc: "Firebase project ID for Admin SDK authentication.",
    }),
    FIREBASE_CLIENT_EMAIL: str({
        default: undefined,
        desc: "Firebase service account client email.",
    }),
    FIREBASE_PRIVATE_KEY: str({
        default: undefined,
        desc: "Firebase service account private key (with newlines as \\n).",
    }),

    USER_API_PORT: port({
        default: 4001,
        desc: "Port number of the User API.",
    }),

    USER_API_WINDOW_MS: num({
        default: isDevEnv() ? 60 * 60 * 1000 : 30 * 60 * 1000,
        desc: "Duration to track requests for rate limiting (in milliseconds).",
    }),

    USER_API_MAX_REQS: num({
        default: isDevEnv() ? 600 : 300,
        desc: "Maximum number of requests in the USER_API_WINDOW_MS time period.",
    }),

    USER_API_CORS_ALLOWED_ORIGINS: str({
        default: undefined,
        example: "https://your-production-domain.com,https://another-trusted-domain.com",
        desc: "Allowed origins, separated by commas (CSV).",
    }),

    USER_API_DEPLOYMENT_ENV: str({
        choices: API_DEPLOYMENT_ENVIRONMENTS,
        default: DeploymentEnv.NODEJS,
        example: DeploymentEnv.VERCEL,
        desc: "The deployment environment of the User API.",
    }),

    USER_API_HOSTNAME: str({
        default: undefined,
        example: "your-production-domain.com",
        desc: "Set this to your api instance's hostname to enable rate limiting.",
    }),

    USER_API_REDIS_CONN_URL: url({
        default: undefined,
        example: "rediss://default:your-secure-password@your-redis-instance.provider.com:6379",
        desc: "Optional Redis connection URL for caching.",
    }),

    USER_API_S_MAXAGE: num({
        default: 60,
        desc: "Specifies the maximum amount of time (in seconds) a resource is considered fresh by CDN.",
    }),

    USER_API_STALE_WHILE_REVALIDATE: num({
        default: 30,
        desc: "Specifies the amount of time (in seconds) a resource is served stale while a new one is fetched.",
    }),

    NODE_ENV: str({
        default: "development",
        choices: ["development", "production", "test", "staging"],
        desc: "The environment in which the application is running.",
    }),
});

function isDevEnv(): boolean {
    return (
        !process.env.NODE_ENV ||
        process.env.NODE_ENV === "development" ||
        process.env.NODE_ENV === "test"
    );
}
