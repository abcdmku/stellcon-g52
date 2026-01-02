import { PLAYER_COLORS } from "@stellcon/shared";
import type { GameListItem, GameState } from "@stellcon/shared";

export type Session = {
  gameId: string;
  playerId: string | null;
};

export type ResolveTimer = ReturnType<typeof setTimeout>;

export type GameRecord = {
  started: boolean;
};

export type GameStore = {
  games: Map<string, GameState>;
  records: Map<string, GameRecord>;
  sessions: Map<string, Session>;
  pendingAlliances: Map<string, boolean>;
  resolveTimers: Map<string, ResolveTimer>;
};

export function createGameStore(): GameStore {
  return {
    games: new Map(),
    records: new Map(),
    sessions: new Map(),
    pendingAlliances: new Map(),
    resolveTimers: new Map(),
  };
}

export function getGame(store: GameStore, gameId: string) {
  return store.games.get(gameId);
}

export function getGameRecord(store: GameStore, gameId: string) {
  return store.records.get(gameId);
}

export function ensureGameRecord(store: GameStore, gameId: string) {
  const existing = getGameRecord(store, gameId);
  if (existing) return existing;
  const record = { started: false };
  store.records.set(gameId, record);
  return record;
}

export function ensureGame(store: GameStore, gameId: string) {
  const game = getGame(store, gameId);
  if (!game) throw new Error("Game not found");
  return game;
}

export function getSession(store: GameStore, socketId: string) {
  return store.sessions.get(socketId);
}

export function trackSession(store: GameStore, socketId: string, payload: Session) {
  store.sessions.set(socketId, payload);
}

export function clearSession(store: GameStore, socketId: string) {
  store.sessions.delete(socketId);
}

export function getSocketsForGame(store: GameStore, gameId: string) {
  return Array.from(store.sessions.entries()).filter(([, session]) => session.gameId === gameId);
}

export function listPublicGames(store: GameStore): GameListItem[] {
  return [...store.games.values()]
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
