import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  addPlayer,
  beginResolution,
  createGame,
  finalizeResolution,
  lockIn,
  redactGameState,
  setAlliance,
  startGame,
  submitOrders,
} from "@stellcon/shared";

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const games = new Map();
const sessions = new Map();
const pendingAlliances = new Map();
const resolveTimers = new Map();
const BASE_RESOLVE_DELAY_MS = 1600;

function getGame(gameId) {
  return games.get(gameId);
}

function ensureGame(gameId) {
  const game = getGame(gameId);
  if (!game) throw new Error("Game not found");
  return game;
}

function getSession(socketId) {
  return sessions.get(socketId);
}

function trackSession(socketId, payload) {
  sessions.set(socketId, payload);
}

function clearSession(socketId) {
  sessions.delete(socketId);
}

function getSocketsForGame(gameId) {
  return Array.from(sessions.entries()).filter(([, session]) => session.gameId === gameId);
}

function emitState(gameId) {
  const game = getGame(gameId);
  if (!game) return;
  for (const [socketId, session] of getSocketsForGame(gameId)) {
    const state = redactGameState(game, session.playerId);
    io.to(socketId).emit("gameState", state);
  }
}

function listPublicGames() {
  return [...games.values()]
    .filter((game) => !game.config?.isPrivate)
    .filter((game) => game.phase !== "complete")
    .map((game) => ({
      gameId: game.id,
      players: Object.keys(game.players).length,
      maxPlayers: game.config.maxPlayers,
      mapSize: game.config.mapSize,
      turn: game.turn,
      phase: game.phase,
    }));
}

function emitGamesList() {
  io.emit("gamesList", listPublicGames());
}

function scheduleFinalize(game) {
  if (resolveTimers.has(game.id)) {
    clearTimeout(resolveTimers.get(game.id));
  }
  let delay = BASE_RESOLVE_DELAY_MS;
  if (typeof game.resolutionEndsAt === "number" && game.resolutionEndsAt > Date.now()) {
    delay = game.resolutionEndsAt - Date.now();
  }
  delay = Math.max(1200, delay);
  game.resolutionEndsAt = Date.now() + delay;
  const timer = setTimeout(() => {
    resolveTimers.delete(game.id);
    finalizeResolution(game);
    emitState(game.id);
    emitGamesList();
  }, delay);
  resolveTimers.set(game.id, timer);
}

function maybeStartGame(game) {
  const players = Object.keys(game.players).length;
  if (!game.started && players >= game.config.maxPlayers) {
    game.started = true;
    startGame(game);
  }
}

function forceResolveIfExpired() {
  const now = Date.now();
  for (const game of games.values()) {
    if (game.phase !== "planning") continue;
    if (!game.turnEndsAt || game.turnEndsAt > now) continue;
    for (const player of Object.values(game.players)) {
      player.locked = true;
    }
    beginResolution(game);
    emitState(game.id);
    scheduleFinalize(game);
  }
}

setInterval(forceResolveIfExpired, 1000);

io.on("connection", (socket) => {
  socket.on("createGame", ({ name, config }, callback) => {
    try {
      const gameId = nanoid(6).toUpperCase();
      const game = createGame({ id: gameId, config, seed: `stellcon-${gameId}` });
      game.started = false;
      games.set(gameId, game);

      const playerId = nanoid(8);
      addPlayer(game, { id: playerId, name: name || "Commander" });

      trackSession(socket.id, { gameId, playerId });
      socket.join(`game:${gameId}`);

      maybeStartGame(game);
      emitState(gameId);
      emitGamesList();

      callback?.({ gameId, playerId });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("joinGame", ({ gameId, name }, callback) => {
    try {
      const game = ensureGame(gameId);
      if (Object.keys(game.players).length >= game.config.maxPlayers) {
        throw new Error("Game is full");
      }
      const playerId = nanoid(8);
      addPlayer(game, { id: playerId, name: name || "Commander" });

      trackSession(socket.id, { gameId, playerId });
      socket.join(`game:${gameId}`);

      maybeStartGame(game);
      emitState(gameId);
      emitGamesList();

      callback?.({ gameId, playerId });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("listGames", (payload, callback) => {
    const list = listPublicGames();
    callback?.({ games: list });
  });

  socket.on("watchGame", ({ gameId }, callback) => {
    try {
      ensureGame(gameId);
      trackSession(socket.id, { gameId, playerId: null });
      socket.join(`game:${gameId}`);
      emitState(gameId);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("rejoinGame", ({ gameId, playerId }, callback) => {
    try {
      const game = ensureGame(gameId);
      const player = game.players[playerId];
      if (!player) throw new Error("Player not found");

      player.connected = true;
      trackSession(socket.id, { gameId, playerId });
      socket.join(`game:${gameId}`);

      emitState(gameId);
      callback?.({ gameId, playerId });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("updateOrders", ({ orders }, callback) => {
    try {
      const session = getSession(socket.id);
      if (!session) throw new Error("Not in game");
      if (!session.playerId) throw new Error("Spectators cannot submit orders");
      const game = ensureGame(session.gameId);
      submitOrders(game, session.playerId, orders || {});
      emitState(game.id);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("lockIn", (payload, callback) => {
    try {
      const session = getSession(socket.id);
      if (!session) throw new Error("Not in game");
      if (!session.playerId) throw new Error("Spectators cannot lock in");
      const game = ensureGame(session.gameId);
      const allLocked = lockIn(game, session.playerId);
      if (allLocked) {
        beginResolution(game);
        scheduleFinalize(game);
      }
      emitState(game.id);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("requestAlliance", ({ targetId }, callback) => {
    try {
      const session = getSession(socket.id);
      if (!session) throw new Error("Not in game");
      if (!session.playerId) throw new Error("Spectators cannot request alliances");
      const game = ensureGame(session.gameId);
      const key = `${session.gameId}:${session.playerId}:${targetId}`;
      pendingAlliances.set(key, true);

      for (const [socketId, playerSession] of getSocketsForGame(game.id)) {
        if (playerSession.playerId === targetId) {
          io.to(socketId).emit("allianceRequest", { fromId: session.playerId });
        }
      }
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("acceptAlliance", ({ fromId }, callback) => {
    try {
      const session = getSession(socket.id);
      if (!session) throw new Error("Not in game");
      if (!session.playerId) throw new Error("Spectators cannot accept alliances");
      const game = ensureGame(session.gameId);
      const key = `${session.gameId}:${fromId}:${session.playerId}`;
      if (pendingAlliances.has(key)) {
        pendingAlliances.delete(key);
        setAlliance(game, fromId, session.playerId);
        emitState(game.id);
      }
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("disconnect", () => {
    const session = getSession(socket.id);
    if (session) {
      const game = getGame(session.gameId);
      if (game && session.playerId && game.players[session.playerId]) {
        game.players[session.playerId].connected = false;
        emitState(game.id);
      }
    }
    clearSession(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`StellCon server running on ${PORT}`);
});
