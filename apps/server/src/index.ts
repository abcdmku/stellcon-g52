import http from "http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@stellcon/shared";
import { createApp } from "./http/createApp.js";
import { logServerError } from "./logging.js";
import { registerSocketHandlers } from "./socket/registerHandlers.js";
import { createGameStore } from "./store/gameStore.js";

const PORT = process.env.PORT || 4000;

const app = createApp();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "*",
  },
});

const store = createGameStore();

process.on("uncaughtException", (error) => {
  logServerError("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  logServerError("unhandledRejection", reason);
});

const { forceResolveIfExpired } = registerSocketHandlers(io, store);
const resolveInterval = setInterval(forceResolveIfExpired, 1000);

server.listen(PORT, () => {
  console.log(`StellCon server running on ${PORT}`);
});

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(resolveInterval);
  io.close();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 2000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
