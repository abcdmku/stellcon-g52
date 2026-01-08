import type { GameConfig, GameListItem, GameState, Orders } from "./types.js";

export interface CreateGamePayload {
  name: string;
  config?: Partial<GameConfig>;
  color?: string;
  previousGameId?: string;
}

export interface JoinGamePayload {
  gameId: string;
  name: string;
  color?: string;
}

export interface WatchGamePayload {
  gameId: string;
}

export interface RejoinGamePayload {
  gameId: string;
  playerId: string;
}

export interface UpdateOrdersPayload {
  orders: Orders;
}

export interface RequestAlliancePayload {
  targetId: string;
}

export interface AcceptAlliancePayload {
  fromId: string;
}

export interface GameIdResponse {
  gameId: string;
  playerId: string;
}

export interface GamesListResponse {
  games: GameListItem[];
}

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}

export type MaybeError<T> = T | ErrorResponse;

export interface ServerToClientEvents {
  gameState: (state: GameState) => void;
  gamesList: (games: GameListItem[]) => void;
  allianceRequest: (payload: { fromId: string }) => void;
  rematchCreated: (payload: { gameId: string; creatorName: string }) => void;
}

export interface ClientToServerEvents {
  createGame: (payload: CreateGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => void;
  joinGame: (payload: JoinGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => void;
  listGames: (payload: unknown, callback?: (response: GamesListResponse) => void) => void;
  watchGame: (payload: WatchGamePayload, callback?: (response: MaybeError<OkResponse>) => void) => void;
  rejoinGame: (payload: RejoinGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => void;
  leaveGame: (payload: unknown, callback?: (response: MaybeError<OkResponse>) => void) => void;
  updateOrders: (payload: UpdateOrdersPayload, callback?: (response: MaybeError<OkResponse>) => void) => void;
  lockIn: (payload: unknown, callback?: (response: MaybeError<OkResponse>) => void) => void;
  requestAlliance: (payload: RequestAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => void;
  acceptAlliance: (payload: AcceptAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => void;
  startGameEarly: (payload: unknown, callback?: (response: MaybeError<OkResponse>) => void) => void;
}
