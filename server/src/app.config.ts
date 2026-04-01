import {
    defineServer,
    defineRoom,
    monitor,
    playground,
    createRouter,
    createEndpoint,
} from "colyseus";

import { GameRoom } from "./rooms/GameRoom.js";

const server = defineServer({
    rooms: {
        game_room: defineRoom(GameRoom),
    },

    routes: createRouter({
        api_health: createEndpoint("/api/health", { method: "GET" }, async (_ctx) => {
            return { status: "ok", timestamp: Date.now() };
        }),
    }),

    express: (app) => {
        app.get("/health", (_req, res) => {
            res.json({ status: "ok" });
        });

        // Gate monitor behind MONITOR_PASSWORD env var (basic auth)
        app.use("/monitor", (req, res, next) => {
            const password = process.env.MONITOR_PASSWORD;
            if (!password) {
                res.status(403).json({ error: "Monitor disabled: MONITOR_PASSWORD not set" });
                return;
            }
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${password}`) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            next();
        }, monitor());

        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }
    },
});

export default server;