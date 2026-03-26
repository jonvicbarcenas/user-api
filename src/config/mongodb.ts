import { MongoClient, type Db } from "mongodb";
import { log } from "./logger.js";

const MONGODB_URI = process.env.MONGODB_URI || "";

if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is required");
}

const DB_NAME = "animeApp";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongoDB(): Promise<Db> {
    if (db) return db;

    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db(DB_NAME);
        log.info("Connected to MongoDB");
        return db;
    } catch (error) {
        log.error(`MongoDB connection error: ${error}`);
        throw error;
    }
}

export async function getDB(): Promise<Db> {
    if (!db) {
        return await connectMongoDB();
    }
    return db;
}

export async function closeMongoDB(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
        log.info("MongoDB connection closed");
    }
}
