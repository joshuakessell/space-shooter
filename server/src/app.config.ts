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

        app.use("/monitor", monitor());

        if (process.env.NODE_ENV !== "production") {
            app.use("/", playground());
        }
    },
});

export default server;