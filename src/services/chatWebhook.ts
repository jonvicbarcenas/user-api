import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "../config/logger.js";

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initChatWebhook(server: Server) {
    wss = new WebSocketServer({
        server,
        path: "/api/v2/chat/webhook",
    });

    wss.on("connection", (ws: WebSocket) => {
        log.info("[Chat Webhook] Client connected");
        clients.add(ws);

        ws.on("close", () => {
            log.info("[Chat Webhook] Client disconnected");
            clients.delete(ws);
        });

        ws.on("error", (error) => {
            log.error(`[Chat Webhook] Error: ${error.message}`);
            clients.delete(ws);
        });

        ws.send(JSON.stringify({ type: "connected", message: "Chat webhook connected" }));
    });

    log.info("[Chat Webhook] WebSocket server initialized");
}

export function broadcastChatMessage(message: unknown) {
    if (!wss || clients.size === 0) return;

    const payload = JSON.stringify({
        type: "message",
        data: message,
        timestamp: Date.now(),
    });

    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });

    log.info(`[Chat Webhook] Broadcasted message to ${clients.size} clients`);
}

export function closeChatWebhook() {
    if (wss) {
        clients.forEach((client) => client.close());
        clients.clear();
        wss.close();
        wss = null;
        log.info("[Chat Webhook] WebSocket server closed");
    }
}
