import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AcceptAlliancePayload,
  ClientToServerEvents,
  CreateGamePayload,
  JoinGamePayload,
  MaybeError,
  OkResponse,
  RequestAlliancePayload,
  ServerToClientEvents,
  WatchGamePayload,
  RejoinGamePayload,
  GameIdResponse,
  UpdateOrdersPayload,
  GamesListResponse,
} from "@stellcon/shared";
import type { GameListItem, GameState } from "@stellcon/shared";

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type SocketCallbacks = {
  onGameState: (state: GameState) => void;
  onGamesList: (games: GameListItem[]) => void;
  onAllianceRequest: (fromId: string) => void;
};

export function useGameSocket(serverUrl: string, demoMode: boolean, callbacks: SocketCallbacks) {
  const [socket, setSocket] = useState<GameSocket | null>(null);

  useEffect(() => {
    if (demoMode) return;
    const nextSocket: GameSocket = io(serverUrl);
    setSocket(nextSocket);
    return () => {
      nextSocket.disconnect();
    };
  }, [demoMode, serverUrl]);

  useEffect(() => {
    if (!socket) return;
    socket.on("gameState", callbacks.onGameState);
    socket.on("gamesList", callbacks.onGamesList);
    socket.on("allianceRequest", ({ fromId }) => callbacks.onAllianceRequest(fromId));
    return () => {
      socket.off("gameState");
      socket.off("gamesList");
      socket.off("allianceRequest");
    };
  }, [callbacks, socket]);

  const createGame = useCallback(
    (payload: CreateGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => {
      socket?.emit("createGame", payload, callback);
    },
    [socket]
  );

  const joinGame = useCallback(
    (payload: JoinGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => {
      socket?.emit("joinGame", payload, callback);
    },
    [socket]
  );

  const watchGame = useCallback(
    (payload: WatchGamePayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("watchGame", payload, callback);
    },
    [socket]
  );

  const rejoinGame = useCallback(
    (payload: RejoinGamePayload, callback?: (response: MaybeError<GameIdResponse>) => void) => {
      socket?.emit("rejoinGame", payload, callback);
    },
    [socket]
  );

  const listGames = useCallback(
    (callback?: (response: GamesListResponse) => void) => {
      socket?.emit("listGames", null, callback);
    },
    [socket]
  );

  const updateOrders = useCallback(
    (payload: UpdateOrdersPayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("updateOrders", payload, callback);
    },
    [socket]
  );

  const lockIn = useCallback(
    (callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("lockIn", null, callback);
    },
    [socket]
  );

  const requestAlliance = useCallback(
    (payload: RequestAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("requestAlliance", payload, callback);
    },
    [socket]
  );

  const acceptAlliance = useCallback(
    (payload: AcceptAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("acceptAlliance", payload, callback);
    },
    [socket]
  );

  return {
    socket,
    createGame,
    joinGame,
    watchGame,
    rejoinGame,
    listGames,
    updateOrders,
    lockIn,
    requestAlliance,
    acceptAlliance,
  };
}
