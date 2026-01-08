import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AcceptAlliancePayload,
  ClientToServerEvents,
  CreateGamePayload,
  DeclineAlliancePayload,
  JoinGamePayload,
  MaybeError,
  OkResponse,
  RequestAlliancePayload,
  RetractAlliancePayload,
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
  onAllianceRetracted: (fromId: string) => void;
  onAllianceDeclined: (byId: string) => void;
  onRematchCreated: (gameId: string, creatorName: string) => void;
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
    socket.on("allianceRetracted", ({ fromId }) => callbacks.onAllianceRetracted(fromId));
    socket.on("allianceDeclined", ({ byId }) => callbacks.onAllianceDeclined(byId));
    socket.on("rematchCreated", ({ gameId, creatorName }) => callbacks.onRematchCreated(gameId, creatorName));
    return () => {
      socket.off("gameState");
      socket.off("gamesList");
      socket.off("allianceRequest");
      socket.off("allianceRetracted");
      socket.off("allianceDeclined");
      socket.off("rematchCreated");
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

  const leaveGame = useCallback(
    (callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("leaveGame", null, callback);
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

  const retractAlliance = useCallback(
    (payload: RetractAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("retractAlliance", payload, callback);
    },
    [socket]
  );

  const declineAlliance = useCallback(
    (payload: DeclineAlliancePayload, callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("declineAlliance", payload, callback);
    },
    [socket]
  );

  const startGameEarly = useCallback(
    (callback?: (response: MaybeError<OkResponse>) => void) => {
      socket?.emit("startGameEarly", null, callback);
    },
    [socket]
  );

  return {
    socket,
    createGame,
    joinGame,
    watchGame,
    rejoinGame,
    leaveGame,
    listGames,
    updateOrders,
    lockIn,
    requestAlliance,
    acceptAlliance,
    retractAlliance,
    declineAlliance,
    startGameEarly,
  };
}
