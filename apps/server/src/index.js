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
  PLAYER_COLORS,
  redactGameState,
  setAlliance,
  startGame,
  startPlanningPhase,
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

function logServerError(label, error, extras = {}) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[server:${label}] ${message}`, extras);
}

process.on("uncaughtException", (error) => {
  logServerError("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  logServerError("unhandledRejection", reason);
});

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function ensureUniqueName(game, proposedName) {
  const name = normalizePlayerName(proposedName);
  if (!name) throw new Error("Name is required");
  const lower = name.toLowerCase();
  for (const player of Object.values(game.players || {})) {
    if (normalizePlayerName(player.name).toLowerCase() === lower) {
      throw new Error("Name already taken in this game");
    }
  }
  return name;
}

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
    .map((game) => {
      const usedColors = new Set(
        Object.values(game.players || {}).map((player) => String(player.color || "").toLowerCase())
      );
      return {
        gameId: game.id,
        players: Object.keys(game.players).length,
        maxPlayers: game.config.maxPlayers,
        availableColors: PLAYER_COLORS.filter((value) => !usedColors.has(String(value).toLowerCase())),
        mapSize: game.config.mapSize,
        turn: game.turn,
        phase: game.phase,
      };
    });
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
    try {
      resolveTimers.delete(game.id);
      finalizeResolution(game);
      emitState(game.id);
      emitGamesList();
    } catch (error) {
      logServerError("finalizeResolution", error, { gameId: game.id });
      resolveTimers.delete(game.id);
      try {
        delete game.revealedMoves;
        delete game.resolutionStartedAt;
        delete game.resolutionEndsAt;
        delete game.resolutionBattles;
        delete game.resolutionPlan;
        startPlanningPhase(game);
        emitState(game.id);
        emitGamesList();
      } catch (recoverError) {
        logServerError("recoverFinalize", recoverError, { gameId: game.id });
      }
    }
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
    try {
      if (game.phase !== "planning") continue;
      if (!game.turnEndsAt || game.turnEndsAt > now) continue;
      for (const player of Object.values(game.players)) {
        player.locked = true;
      }
      beginResolution(game);
      emitState(game.id);
      scheduleFinalize(game);
    } catch (error) {
      logServerError("forceResolveIfExpired", error, { gameId: game.id });
    }
  }
}

setInterval(forceResolveIfExpired, 1000);

io.on("connection", (socket) => {
  socket.on("createGame", (payload = {}, callback) => {
    try {
      const { name, config, color } = payload || {};
      const gameId = nanoid(6).toUpperCase();
      const game = createGame({ id: gameId, config, seed: `stellcon-${gameId}` });
      game.started = false;
      games.set(gameId, game);

      const playerId = nanoid(8);
      addPlayer(game, { id: playerId, name: ensureUniqueName(game, name), color });

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

  socket.on("joinGame", (payload = {}, callback) => {
    try {
      const { gameId, name, color } = payload || {};
      const game = ensureGame(gameId);
      if (Object.keys(game.players).length >= game.config.maxPlayers) {
        throw new Error("Game is full");
      }
      const playerId = nanoid(8);
      addPlayer(game, { id: playerId, name: ensureUniqueName(game, name), color });

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

  socket.on("watchGame", (payload = {}, callback) => {
    try {
      const { gameId } = payload || {};
      ensureGame(gameId);
      trackSession(socket.id, { gameId, playerId: null });
      socket.join(`game:${gameId}`);
      emitState(gameId);
      callback?.({ ok: true });
    } catch (error) {
      callback?.({ error: error.message });
    }
  });

  socket.on("rejoinGame", (payload = {}, callback) => {
    try {
      const { gameId, playerId } = payload || {};
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

  socket.on("updateOrders", (payload = {}, callback) => {
    try {
      const { orders } = payload || {};
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

  socket.on("requestAlliance", (payload = {}, callback) => {
    try {
      const { targetId } = payload || {};
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

  socket.on("acceptAlliance", (payload = {}, callback) => {
    try {
      const { fromId } = payload || {};
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
