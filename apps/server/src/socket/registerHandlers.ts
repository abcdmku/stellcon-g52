import { nanoid } from "nanoid";
import type { Server as IOServer, Socket } from "socket.io";
import {
  addPlayer,
  beginResolution,
  createGame,
  finalizeResolution,
  lockIn,
  redactGameState,
  setAlliance,
  startGame,
  startPlanningPhase,
  submitOrders,
} from "@stellcon/shared";
import type { BotDifficulty, ClientToServerEvents, ServerToClientEvents, GameState } from "@stellcon/shared";
import {
  clearSession,
  deleteGame,
  ensureGame,
  ensureGameRecord,
  getGameRecord,
  getGame,
  getSession,
  getSocketsForGame,
  listPublicGames,
  trackSession,
  type GameStore,
} from "../store/gameStore.js";
import { logServerError } from "../logging.js";
import { planBotOrders } from "../ai/bots.js";

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
const BASE_RESOLVE_DELAY_MS = 1600;

function normalizePlayerName(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function ensureUniqueName(game: GameState, proposedName: string) {
  const name = normalizePlayerName(proposedName);
  if (!name) throw new Error("Name is required");
  const lower = name.toLowerCase();
  for (const player of Object.values(game.players)) {
    if (normalizePlayerName(player.name).toLowerCase() === lower) {
      throw new Error("Name already taken in this game");
    }
  }
  return name;
}

function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

export function registerSocketHandlers(io: IO, store: GameStore) {
  const emitState = (gameId: string) => {
    const game = getGame(store, gameId);
    if (!game) return;
    for (const [socketId, session] of getSocketsForGame(store, gameId)) {
      const state = redactGameState(game, session.playerId);
      io.to(socketId).emit("gameState", state);
    }
  };

  const emitGamesList = () => {
    io.emit("gamesList", listPublicGames(store));
  };

  const clearPendingAlliancesForGame = (gameId: string) => {
    // Collect all pending alliance keys for this game
    const keysToDelete: string[] = [];
    const notifications: { targetId: string; fromId: string }[] = [];

    for (const key of store.pendingAlliances.keys()) {
      if (key.startsWith(`${gameId}:`)) {
        keysToDelete.push(key);
        // Extract fromId and targetId from key format: gameId:fromId:targetId
        const parts = key.split(":");
        if (parts.length === 3) {
          notifications.push({ fromId: parts[1], targetId: parts[2] });
        }
      }
    }

    // Delete all pending alliances for this game
    for (const key of keysToDelete) {
      store.pendingAlliances.delete(key);
    }

    // Notify target players that offers expired
    for (const { fromId, targetId } of notifications) {
      for (const [socketId, session] of getSocketsForGame(store, gameId)) {
        if (session.playerId === targetId) {
          io.to(socketId).emit("allianceRetracted", { fromId });
        }
      }
    }
  };

  const runBotsForGame = (gameId: string) => {
    const game = getGame(store, gameId);
    if (!game) return;
    const record = getGameRecord(store, gameId);
    if (!record?.started) return;
    if (game.phase !== "planning") return;

    let anySubmitted = false;
    let shouldResolve = false;

    for (const [botPlayerId, bot] of store.bots.entries()) {
      if (bot.gameId !== gameId) continue;
      const player = game.players[botPlayerId];
      if (!player || !player.isBot) {
        store.bots.delete(botPlayerId);
        continue;
      }
      if (player.locked) continue;

      try {
        const orders = planBotOrders(game, botPlayerId, bot.difficulty);
        submitOrders(game, botPlayerId, orders);
        anySubmitted = true;
        if (lockIn(game, botPlayerId)) {
          shouldResolve = true;
        }
      } catch (error) {
        logServerError("botPlan", error, { gameId, botPlayerId, difficulty: bot.difficulty });
      }
    }

    if (shouldResolve && game.phase === "planning") {
      beginResolution(game);
      scheduleFinalize(game);
    }

    if (anySubmitted || shouldResolve) {
      emitState(gameId);
    }
  };

  const scheduleFinalize = (game: GameState) => {
    if (store.resolveTimers.has(game.id)) {
      clearTimeout(store.resolveTimers.get(game.id));
    }
    let delay = BASE_RESOLVE_DELAY_MS;
    if (typeof game.resolutionEndsAt === "number" && game.resolutionEndsAt > Date.now()) {
      delay = game.resolutionEndsAt - Date.now();
    }
    delay = Math.max(1200, delay);
    game.resolutionEndsAt = Date.now() + delay;
    const timer = setTimeout(() => {
      try {
        store.resolveTimers.delete(game.id);
        finalizeResolution(game);
        runBotsForGame(game.id);
        clearPendingAlliancesForGame(game.id);
        emitState(game.id);
        emitGamesList();
      } catch (error) {
        logServerError("finalizeResolution", error, { gameId: game.id });
        store.resolveTimers.delete(game.id);
        try {
          delete game.revealedMoves;
          delete game.resolutionStartedAt;
          delete game.resolutionEndsAt;
          delete game.resolutionBattles;
          delete game.resolutionPlan;
          startPlanningPhase(game);
          runBotsForGame(game.id);
          emitState(game.id);
          emitGamesList();
        } catch (recoverError) {
          logServerError("recoverFinalize", recoverError, { gameId: game.id });
        }
      }
    }, delay);
    store.resolveTimers.set(game.id, timer);
  };

  const maybeStartGame = (game: GameState) => {
    const players = Object.keys(game.players).length;
    const record = ensureGameRecord(store, game.id);
    if (!record.started && players >= game.config.maxPlayers) {
      record.started = true;
      startGame(game);
      runBotsForGame(game.id);
    }
  };

  const createBotName = (game: GameState, difficulty: BotDifficulty) => {
    const label = difficulty === "easy" ? "Easy" : difficulty === "medium" ? "Medium" : "Hard";
    const base = `AI (${label})`;
    for (let i = 1; i <= 99; i += 1) {
      const candidate = i === 1 ? base : `${base} ${i}`;
      try {
        return ensureUniqueName(game, candidate);
      } catch {
        // keep trying
      }
    }
    return ensureUniqueName(game, `${base} ${nanoid(4)}`);
  };

  const forceResolveIfExpired = () => {
    const now = Date.now();
    for (const game of store.games.values()) {
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
  };

  io.on("connection", (socket: GameSocket) => {
    socket.on("createGame", (payload, callback) => {
      try {
        const { name, config, color, previousGameId } = payload;
        const gameId = nanoid(6).toUpperCase();
        const game = createGame({ id: gameId, config, seed: `stellcon-${gameId}` });
        store.games.set(gameId, game);
        ensureGameRecord(store, gameId);

        const playerId = nanoid(8);
        const playerName = ensureUniqueName(game, name);
        addPlayer(game, { id: playerId, name: playerName, color });

        trackSession(store, socket.id, { gameId, playerId });
        socket.join(`game:${gameId}`);

        maybeStartGame(game);
        emitState(gameId);
        emitGamesList();

        // Notify players in the previous game about the rematch
        if (previousGameId) {
          const previousGame = getGame(store, previousGameId);
          if (previousGame) {
            io.to(`game:${previousGameId}`).emit("rematchCreated", { gameId, creatorName: playerName });
          }
        }

        callback?.({ gameId, playerId });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("joinGame", (payload, callback) => {
      try {
        const { gameId, name, color } = payload;
        const game = ensureGame(store, gameId);
        if (Object.keys(game.players).length >= game.config.maxPlayers) {
          throw new Error("Game is full");
        }
        const playerId = nanoid(8);
        addPlayer(game, { id: playerId, name: ensureUniqueName(game, name), color });

        trackSession(store, socket.id, { gameId, playerId });
        socket.join(`game:${gameId}`);

        maybeStartGame(game);
        emitState(gameId);
        emitGamesList();

        callback?.({ gameId, playerId });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("listGames", (payload, callback) => {
      const list = listPublicGames(store);
      callback?.({ games: list });
    });

    socket.on("watchGame", (payload, callback) => {
      try {
        const { gameId } = payload;
        ensureGame(store, gameId);
        trackSession(store, socket.id, { gameId, playerId: null });
        socket.join(`game:${gameId}`);
        emitState(gameId);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("rejoinGame", (payload, callback) => {
      try {
        const { gameId, playerId } = payload;
        const game = ensureGame(store, gameId);
        const player = game.players[playerId];
        if (!player) throw new Error("Player not found");
        if (player.isBot) throw new Error("Cannot rejoin as an AI player");

        player.connected = true;
        trackSession(store, socket.id, { gameId, playerId });
        socket.join(`game:${gameId}`);

        emitState(gameId);
        callback?.({ gameId, playerId });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("rejoinGameByName", (payload, callback) => {
      try {
        const { gameId, name } = payload;
        const game = ensureGame(store, gameId);
        const normalizedName = normalizePlayerName(name).toLowerCase();

        // Find player by normalized name
        const playerEntry = Object.entries(game.players).find(
          ([, player]) => normalizePlayerName(player.name).toLowerCase() === normalizedName
        );

        if (!playerEntry) {
          throw new Error("Player not found in this game");
        }

        const [playerId, player] = playerEntry;
        if (player.isBot) throw new Error("Cannot rejoin as an AI player");

        // Check if player is already connected from another socket
        const existingSession = Array.from(store.sessions.values()).find(
          (s) => s.playerId === playerId && s.gameId === gameId
        );

        if (existingSession && player.connected) {
          throw new Error("Player is already connected to this game");
        }

        player.connected = true;
        trackSession(store, socket.id, { gameId, playerId });
        socket.join(`game:${gameId}`);

        emitState(gameId);
        callback?.({ gameId, playerId });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("leaveGame", (payload, callback) => {
      try {
        const session = getSession(store, socket.id);
        if (!session) {
          callback?.({ ok: true });
          return;
        }

        const game = getGame(store, session.gameId);
        if (game && session.playerId) {
          const record = getGameRecord(store, game.id);
          const started = Boolean(record?.started);
          const player = game.players[session.playerId];
          if (player) {
            if (!started) {
              delete game.players[session.playerId];
            } else {
              player.connected = false;
            }
          }
        }

        socket.leave(`game:${session.gameId}`);
        clearSession(store, socket.id);

        if (game) {
          const hasConnectedPlayers = getSocketsForGame(store, game.id).some(([, s]) => s.playerId !== null);
          if (!hasConnectedPlayers) {
            deleteGame(store, game.id);
          } else {
            emitState(game.id);
          }
          emitGamesList();
        }

        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("updateOrders", (payload, callback) => {
      try {
        const { orders } = payload;
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot submit orders");
        const game = ensureGame(store, session.gameId);
        const record = ensureGameRecord(store, game.id);
        if (!record.started) throw new Error("Game hasn't started yet");
        submitOrders(game, session.playerId, orders);
        emitState(game.id);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("lockIn", (payload, callback) => {
      try {
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot lock in");
        const game = ensureGame(store, session.gameId);
        const record = ensureGameRecord(store, game.id);
        if (!record.started) throw new Error("Game hasn't started yet");
        const allLocked = lockIn(game, session.playerId);
        if (allLocked) {
          beginResolution(game);
          scheduleFinalize(game);
        }
        emitState(game.id);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("requestAlliance", (payload, callback) => {
      try {
        const { targetId } = payload;
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot request alliances");
        const game = ensureGame(store, session.gameId);
        const key = `${session.gameId}:${session.playerId}:${targetId}`;
        store.pendingAlliances.set(key, true);

        for (const [socketId, playerSession] of getSocketsForGame(store, game.id)) {
          if (playerSession.playerId === targetId) {
            io.to(socketId).emit("allianceRequest", { fromId: session.playerId });
          }
        }
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("acceptAlliance", (payload, callback) => {
      try {
        const { fromId } = payload;
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot accept alliances");
        const game = ensureGame(store, session.gameId);
        const key = `${session.gameId}:${fromId}:${session.playerId}`;
        if (store.pendingAlliances.has(key)) {
          store.pendingAlliances.delete(key);
          setAlliance(game, fromId, session.playerId);
          emitState(game.id);
        }
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("retractAlliance", (payload, callback) => {
      try {
        const { targetId } = payload;
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot retract alliances");
        const game = ensureGame(store, session.gameId);
        const key = `${session.gameId}:${session.playerId}:${targetId}`;
        if (store.pendingAlliances.has(key)) {
          store.pendingAlliances.delete(key);
          // Notify the target player that the offer was retracted
          for (const [socketId, playerSession] of getSocketsForGame(store, game.id)) {
            if (playerSession.playerId === targetId) {
              io.to(socketId).emit("allianceRetracted", { fromId: session.playerId });
            }
          }
        }
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("declineAlliance", (payload, callback) => {
      try {
        const { fromId } = payload;
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot decline alliances");
        const game = ensureGame(store, session.gameId);
        const key = `${session.gameId}:${fromId}:${session.playerId}`;
        if (store.pendingAlliances.has(key)) {
          store.pendingAlliances.delete(key);
          // Notify the requester that their offer was declined
          for (const [socketId, playerSession] of getSocketsForGame(store, game.id)) {
            if (playerSession.playerId === fromId) {
              io.to(socketId).emit("allianceDeclined", { byId: session.playerId });
            }
          }
        }
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("addBot", (payload, callback) => {
      try {
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot add bots");
        const game = ensureGame(store, session.gameId);
        const record = ensureGameRecord(store, game.id);
        if (record.started) throw new Error("Game already started");
        if (!payload || !isBotDifficulty(payload.difficulty)) throw new Error("Invalid bot difficulty");
        if (Object.keys(game.players).length >= game.config.maxPlayers) throw new Error("Game is full");

        const botPlayerId = nanoid(8);
        const botName = createBotName(game, payload.difficulty);
        addPlayer(game, { id: botPlayerId, name: botName });
        const botPlayer = game.players[botPlayerId];
        botPlayer.isBot = true;
        botPlayer.botDifficulty = payload.difficulty;
        botPlayer.connected = true;
        botPlayer.locked = false;
        store.bots.set(botPlayerId, { gameId: game.id, playerId: botPlayerId, difficulty: payload.difficulty });

        maybeStartGame(game);
        emitState(game.id);
        emitGamesList();
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("removeBot", (payload, callback) => {
      try {
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot remove bots");
        const game = ensureGame(store, session.gameId);
        const record = ensureGameRecord(store, game.id);
        if (record.started) throw new Error("Game already started");
        const targetId = payload?.playerId;
        if (!targetId) throw new Error("Bot id required");
        const targetPlayer = game.players[targetId];
        if (!targetPlayer) throw new Error("Player not found");
        if (!targetPlayer.isBot) throw new Error("Not a bot player");

        delete game.players[targetId];
        store.bots.delete(targetId);
        emitState(game.id);
        emitGamesList();
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("startGameEarly", (payload, callback) => {
      try {
        const session = getSession(store, socket.id);
        if (!session) throw new Error("Not in game");
        if (!session.playerId) throw new Error("Spectators cannot start the game");
        const game = ensureGame(store, session.gameId);
        const record = ensureGameRecord(store, game.id);
        if (record.started) throw new Error("Game already started");
        const players = Object.keys(game.players).length;
        if (players < 2) throw new Error("Need at least 2 players to start");
        if (game.config.maxPlayers < 3) throw new Error("Cannot start early for 2-player games");
        record.started = true;
        startGame(game);
        runBotsForGame(game.id);
        emitState(game.id);
        emitGamesList();
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    socket.on("disconnect", () => {
      const session = getSession(store, socket.id);
      if (session) {
        const game = getGame(store, session.gameId);
        if (game && session.playerId && game.players[session.playerId]) {
          game.players[session.playerId].connected = false;
        }

        // Check if any OTHER players are still connected to the game
        // (before clearing this session)
        if (game) {
          const remainingSockets = getSocketsForGame(store, game.id);
          const hasOtherConnectedPlayers = remainingSockets.some(
            ([socketId, s]) => socketId !== socket.id && s.playerId !== null
          );

          clearSession(store, socket.id);

          if (!hasOtherConnectedPlayers) {
            // No other players left in the game, delete the room
            deleteGame(store, game.id);
            emitGamesList();
          } else {
            emitState(game.id);
          }
        } else {
          clearSession(store, socket.id);
        }
      } else {
        clearSession(store, socket.id);
      }
    });
  });

  return { forceResolveIfExpired };
}
