import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildConnectedComponentIndex, inSameConnectedComponent, POWERUPS, RESOURCE_COLORS, RESOURCE_TYPES } from "@stellcon/shared";
import type { GameListItem, GameState, Orders, PowerupKey } from "@stellcon/shared";
import { demoPlayerId, demoState } from "./demoState.js";
import Board from "./features/board/Board";
import Lobby from "./features/lobby/Lobby.jsx";
import PlayerCard from "./features/lobby/PlayerCard.jsx";
import { emptyOrders } from "./shared/lib/orders";
import { useGameSocket } from "./shared/hooks/useGameSocket";
import { useOrders } from "./shared/hooks/useOrders";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const resourceLabels = {
  fusion: "Fusion",
  terrain: "Terrain",
  metal: "Metal",
  crystal: "Crystal",
};

const resourceAbbr = {
  fusion: "F",
  terrain: "T",
  metal: "M",
  crystal: "C",
};

const powerupHelp = {
  stellarBomb: "Place on any system you can attack; eliminates half the fleets. Blocked by Defense Net.",
  defenseNet: "Place on any of your systems; blocks all attacks (including Stellar Bombs).",
  terraform: "Place on one of your tier 0–1 systems; raises its tier by 1.",
  wormhole: "Place on any of your systems; lets you move from any of your systems to anywhere on the map.",
};

function FleetIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2.2c.4 0 .8.2 1 .6l2.6 4.9 5 .7c.5.1.9.5 1 .9.1.5-.1 1-.5 1.3l-3.7 3.5.9 4.9c.1.5-.1 1-.5 1.3-.4.3-1 .3-1.4.1L12 19.6 7.6 21.4c-.5.2-1 .2-1.4-.1-.4-.3-.6-.8-.5-1.3l.9-4.9-3.7-3.5c-.4-.3-.6-.8-.5-1.3.1-.4.5-.8 1-.9l5-.7 2.6-4.9c.2-.4.6-.6 1-.6Zm0 3.7-1.9 3.7c-.2.3-.5.6-.9.6l-4.1.6 3 2.8c.3.2.4.6.3 1l-.7 4 3.6-1.5c.3-.1.7-.1 1 0l3.6 1.5-.7-4c-.1-.4.1-.7.3-1l3-2.8-4.1-.6c-.4-.1-.7-.3-.9-.6L12 5.9Z"
      />
    </svg>
  );
}

function PowerupIcon({ type, size = 18 }: { type: PowerupKey; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false };
  switch (type) {
    case "stellarBomb":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 2.4c.5 0 .9.3 1 .8l.9 3.5 3.5-.9c.5-.1 1 .1 1.2.6.2.5 0 1-.4 1.3l-2.9 2.2 2.2 2.9c.3.4.3 1 0 1.3-.3.4-.8.6-1.3.4l-3.1-1.4-1.4 3.1c-.2.5-.7.8-1.2.7-.5 0-.9-.4-1-.9l-.3-3.6-3.6.3c-.5 0-1-.3-1.2-.8-.2-.5 0-1 .4-1.3l2.9-2.2-2.2-2.9c-.3-.4-.3-1 0-1.3.3-.4.8-.6 1.3-.4l3.1 1.4 1.4-3.1c.2-.4.6-.7 1.1-.7Z"
          />
        </svg>
      );
    case "terraform":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 3c4.5 0 8.2 3.7 8.2 8.2 0 4.2-3.2 7.7-7.3 8.2V21c0 .6-.4 1-1 1s-1-.4-1-1v-1.6C6.8 18.9 3.6 15.4 3.6 11.2 3.6 6.7 7.3 3 11.8 3Zm.1 2c-3.4 0-6.2 2.8-6.2 6.2 0 3 2.1 5.5 5.1 6.1v-2.6c0-2.5 1.2-4.7 3.1-6.1.5-.3 1.1-.2 1.4.3.3.5.2 1.1-.3 1.4-1.3 1-2.1 2.5-2.1 4.2v2.8c2.8-.8 4.9-3.4 4.9-6.1 0-3.4-2.8-6.2-6.2-6.2Z"
          />
        </svg>
      );
    case "defenseNet":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 2.6c.2 0 .4.1.6.2l7.2 3.2c.4.2.6.6.6 1v6.2c0 4.7-3.2 8.3-7.9 9.7h-.2c-.1 0-.3 0-.4-.1C7.2 21.6 4 18 4 13.2V7c0-.4.2-.8.6-1l7.2-3.2c.1-.1.3-.2.5-.2Zm0 2.2L6 7.3v5.9c0 3.7 2.4 6.6 6 7.6 3.6-1 6-3.9 6-7.6V7.3L12 4.8Z"
          />
        </svg>
      );
    case "wormhole":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 3c5 0 9 4 9 9 0 4.4-3 8.1-7.2 8.8-1 .2-1.9-.5-1.9-1.5 0-.7.5-1.3 1.2-1.4 3.2-.5 5.7-3.3 5.7-6.6 0-3.9-3.1-7-7-7S5 7.1 5 11c0 2.9 1.8 5.5 4.5 6.5.7.2 1.1 1 .8 1.7-.2.6-1 .9-1.6.7C5.4 18.6 3 15 3 11c0-5 4-9 9-9Zm-.2 5.2c.6 0 1 .4 1 1v6.8c0 .6-.4 1-1 1s-1-.4-1-1V9.2c0-.6.4-1 1-1Z"
          />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.5" />
        </svg>
      );
  }
}

function App() {
  const [state, setState] = useState<GameState | null>(DEMO_MODE ? (demoState as unknown as GameState) : null);
  const [playerId, setPlayerId] = useState<string | null>(DEMO_MODE ? demoPlayerId : null);
  const [gameId, setGameId] = useState<string | null>(DEMO_MODE ? demoState.id : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [endgameDismissed, setEndgameDismissed] = useState(false);
  const { orders, resetOrders, replaceOrders, applyPlacement, queuePowerup, queueMove, removeMove, adjustMove } =
    useOrders(DEMO_MODE ? (demoState.players[demoPlayerId].orders as Orders) : emptyOrders());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moveOriginId, setMoveOriginId] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [powerupDraft, setPowerupDraft] = useState<PowerupKey | "">("");
  const [pendingAllianceFromIds, setPendingAllianceFromIds] = useState<Record<string, boolean>>({});
  const [timer, setTimer] = useState(0);
  const [availableGames, setAvailableGames] = useState<GameListItem[]>([]);
  const lastSeenTurnRef = useRef<{ turn: number | null; phase: string | null }>({ turn: null, phase: null });
  const noticeTimeoutRef = useRef<number | null>(null);

  const handleGameState = useCallback(
    (gameState: GameState) => {
      setState(gameState);
      if (playerId && gameState?.turn != null) {
        const last = lastSeenTurnRef.current;
        const phaseChanged = last.phase !== gameState.phase;
        const turnChanged = last.turn !== gameState.turn;

        if ((turnChanged || phaseChanged) && gameState.phase === "planning") {
          const serverOrders = gameState.players?.[playerId]?.orders;
          replaceOrders(serverOrders);
          setMoveOriginId(null);
        }

        lastSeenTurnRef.current = { turn: gameState.turn, phase: gameState.phase };
      }
      if (selectedId && gameState?.systems?.length) {
        const stillExists = gameState.systems.some((system) => system.id === selectedId);
        if (!stillExists) setSelectedId(null);
      }
    },
    [playerId, replaceOrders, selectedId]
  );

  const handleGamesList = useCallback((games: GameListItem[]) => {
    setAvailableGames(games || []);
  }, []);

  const handleAllianceRequest = useCallback((fromId: string) => {
    setPendingAllianceFromIds((current) => ({ ...current, [fromId]: true }));
    setError(`Alliance request from ${fromId}. Use Diplomacy in Commanders to accept.`);
  }, []);

  const socketCallbacks = useMemo(
    () => ({
      onGameState: handleGameState,
      onGamesList: handleGamesList,
      onAllianceRequest: handleAllianceRequest,
    }),
    [handleAllianceRequest, handleGameState, handleGamesList]
  );

  const {
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
  } = useGameSocket(SERVER_URL, DEMO_MODE, socketCallbacks);

  const me = playerId && state?.players ? state.players[playerId] : null;
  const systems = state?.systems || [];
  const links = state?.links || {};
  const componentById = useMemo(() => buildConnectedComponentIndex(systems.map((system) => system.id), links), [links, systems]);
  const totalPlaced = Object.values(orders.placements || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const fleetsRemaining = Math.max(0, (me?.fleetsToPlace || 0) - totalPlaced);
  const turnSeconds = Number(state?.config?.turnSeconds || 0);
  const planningRatio = turnSeconds > 0 && state?.phase === "planning" ? clamp(timer / turnSeconds, 0, 1) : 0;

  const flashNotice = (message: string) => {
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
    setNotice(message);
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimeoutRef.current = null;
    }, 2400);
  };

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!placementMode) return;
    if (state?.phase !== "planning" || fleetsRemaining <= 0) setPlacementMode(false);
  }, [fleetsRemaining, placementMode, state?.phase]);

  useEffect(() => {
    if (state?.phase === "planning") return;
    setMoveOriginId(null);
    setPowerupDraft("");
  }, [state?.phase]);

  useEffect(() => {
    if (state?.phase !== "complete") setEndgameDismissed(false);
  }, [state?.phase]);

  useEffect(() => {
    setEndgameDismissed(false);
    setSelectedId(null);
  }, [gameId]);

  useEffect(() => {
    if (!powerupDraft) return;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setPowerupDraft("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [powerupDraft]);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    if (gameId || playerId) return;
    const fromUrl = new URLSearchParams(window.location.search).get("game");
    if (fromUrl) {
      watchGame({ gameId: fromUrl }, (response) => {
        if (response && "error" in response) setError(response.error);
      });
      setGameId(fromUrl);
      return;
    }
    const stored = window.localStorage.getItem("stellcon.session");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (!parsed?.gameId || !parsed?.playerId) return;
      rejoinGame({ gameId: parsed.gameId, playerId: parsed.playerId }, (response) => {
        if (!response || "error" in response) {
          window.localStorage.removeItem("stellcon.session");
          return;
        }
        setGameId(response.gameId);
        setPlayerId(response.playerId);
        resetOrders();
        setSelectedId(null);
      });
    } catch {
      window.localStorage.removeItem("stellcon.session");
    }
  }, [socket, gameId, playerId, rejoinGame, resetOrders, watchGame]);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    if (gameId) return;
    listGames((response) => {
      setAvailableGames(response?.games || []);
    });
  }, [socket, gameId, listGames]);

  useEffect(() => {
    if (!state?.turnEndsAt) {
      setTimer(0);
      return;
    }
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((state.turnEndsAt - Date.now()) / 1000));
      setTimer(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [state?.turnEndsAt]);

  useEffect(() => {
    if (!socket || !playerId || DEMO_MODE) return;
    const timeout = setTimeout(() => {
      updateOrders({ orders });
    }, 150);
    return () => clearTimeout(timeout);
  }, [orders, socket, playerId, updateOrders]);

  useEffect(() => {
    if (!moveOriginId) return;
    const origin = systems.find((system) => system.id === moveOriginId);
    if (!origin || origin.ownerId !== playerId) {
      setMoveOriginId(null);
    }
  }, [moveOriginId, playerId, systems]);

  const handleCreate = ({ name, config, color }) => {
    if (!socket) return;
    setError("");
    createGame({ name, config, color }, (response) => {
      if (!response) {
        setError("No response from server.");
        return;
      }
      if ("error" in response) {
        setError(response.error);
        return;
      }
      setPlayerId(response.playerId);
      setGameId(response.gameId);
      resetOrders();
      setSelectedId(null);
      window.localStorage.setItem(
        "stellcon.session",
        JSON.stringify({ gameId: response.gameId, playerId: response.playerId })
      );
      const params = new URLSearchParams(window.location.search);
      params.set("game", response.gameId);
      window.history.replaceState(null, "", `?${params.toString()}`);
    });
  };

  const handleJoin = ({ name, gameId: target, color }) => {
    if (!socket) return;
    setError("");
    joinGame({ name, gameId: target, color }, (response) => {
      if (!response) {
        setError("No response from server.");
        return;
      }
      if ("error" in response) {
        setError(response.error);
        return;
      }
      setPlayerId(response.playerId);
      setGameId(response.gameId);
      resetOrders();
      setSelectedId(null);
      window.localStorage.setItem(
        "stellcon.session",
        JSON.stringify({ gameId: response.gameId, playerId: response.playerId })
      );
      const params = new URLSearchParams(window.location.search);
      params.set("game", response.gameId);
      window.history.replaceState(null, "", `?${params.toString()}`);
    });
  };

  const handleWatch = (target) => {
    if (!socket) return;
    setError("");
    watchGame({ gameId: target }, (response) => {
      if (response && "error" in response) {
        setError(response.error);
        return;
      }
      setPlayerId(null);
      setGameId(target);
      resetOrders();
      setSelectedId(null);
      const params = new URLSearchParams(window.location.search);
      params.set("game", target);
      window.history.replaceState(null, "", `?${params.toString()}`);
    });
  };

  const handlePlacement = (systemId, delta) => {
    applyPlacement(systemId, delta, Number(me?.fleetsToPlace || 0));
    setMoveOriginId(null);
  };

  const canAttackFromOwned = useCallback((targetId) => {
    if (!playerId) return false;
    if ((me?.wormholeTurns || 0) > 0) return true;
    for (const system of systems) {
      if (system.ownerId !== playerId) continue;
      if (links?.[system.id]?.includes(targetId)) return true;
    }
    return false;
  }, [links, me?.wormholeTurns, playerId, systems]);

  const isAlliedWith = useCallback(
    (ownerId) => {
      if (!ownerId) return false;
      if (!playerId) return false;
      if (ownerId === playerId) return false;
      return Boolean(me?.alliances?.[ownerId]);
    },
    [me?.alliances, playerId]
  );

  const powerupTargetIds = useMemo(() => {
    if (!playerId) return new Set<string>();
    if (!powerupDraft) return new Set<string>();
    if (state?.phase !== "planning") return new Set<string>();
    const powerup = POWERUPS[powerupDraft];
    if (!powerup) return new Set<string>();
    if ((me?.research?.[powerup.resource] || 0) < powerup.cost) return new Set<string>();

    const targets = new Set<string>();
    for (const system of systems) {
      if (powerupDraft === "defenseNet") {
        if (system.ownerId === playerId) targets.add(system.id);
        continue;
      }

      if (powerupDraft === "wormhole") {
        if (system.ownerId === playerId) targets.add(system.id);
        continue;
      }

      if (powerupDraft === "terraform") {
        const tier = system.tier ?? 0;
        if (system.ownerId === playerId && !system.terraformed && tier <= 1) targets.add(system.id);
        continue;
      }

      if (powerupDraft === "stellarBomb") {
        if (system.ownerId === playerId) continue;
        if (system.ownerId && isAlliedWith(system.ownerId)) continue;
        if (system.defenseNetTurns > 0) continue;
        if (!canAttackFromOwned(system.id)) continue;
        targets.add(system.id);
      }
    }
    return targets;
  }, [canAttackFromOwned, isAlliedWith, me?.research, playerId, powerupDraft, state?.phase, systems]);

  const powerupHighlightColor = useMemo(() => {
    if (!powerupDraft) return "";
    if (powerupDraft === "stellarBomb") return "var(--danger)";
    const resource = POWERUPS[powerupDraft]?.resource;
    return resource ? RESOURCE_COLORS[resource] : "";
  }, [powerupDraft]);

  const tryQueuePowerupAt = (system) => {
    if (!playerId) return false;
    if (state?.phase !== "planning") return false;
    if (!powerupDraft) return false;
    const powerup = POWERUPS[powerupDraft];
    if (!powerup) return false;
    if ((me?.research?.[powerup.resource] || 0) < powerup.cost) return false;
    if (!system?.id) return false;

    if (!powerupTargetIds.has(system.id)) {
      flashNotice("Not a valid target for that powerup.");
      return false;
    }

    queuePowerup(powerupDraft as PowerupKey, system.id);
    setPowerupDraft("");
    setMoveOriginId(null);
    return true;
  };

  const handleSystemClick = (system, event) => {
    setSelectedId(system.id);
    if (!system) return;

    if (powerupDraft) {
      if (tryQueuePowerupAt(system)) return;
      return;
    }

    if (placementMode) {
      if (!playerId) return;
      if (state?.phase !== "planning") return;
      if (fleetsRemaining <= 0) return;
      if (system.ownerId === playerId) handlePlacement(system.id, 1);
      return;
    }

    if (!playerId) return;
    if (state?.phase !== "planning") return;

    const wormholeActive = (me?.wormholeTurns || 0) > 0;

    const isOwnedByMe = system.ownerId === playerId;

    if (isOwnedByMe) {
      if (moveOriginId && moveOriginId !== system.id) {
        const canReach = wormholeActive || inSameConnectedComponent(componentById, moveOriginId, system.id);
        if (!canReach) {
          flashNotice("Not reachable (need Wormhole or a connected section).");
          return;
        }

        const origin = systems.find((entry) => entry.id === moveOriginId);
        if (!origin || origin.ownerId !== playerId) return;
        const placement = Number(orders.placements?.[moveOriginId] || 0);
        const originFleets = (origin.fleets || 0) + placement;
        const queued = orders.moves.reduce(
          (sum, move) => (move.fromId === moveOriginId ? sum + Number(move.count || 0) : sum),
          0
        );
        const available = Math.max(0, originFleets - queued);
        if (available <= 0) {
          flashNotice("No fleets left at that origin.");
          return;
        }
        queueMove(moveOriginId, system.id, origin.fleets || 0);
        return;
      }

      setMoveOriginId((current) => (current === system.id ? null : system.id));
      return;
    }

    if (!moveOriginId) {
      flashNotice("Select one of your systems first (origin), then click a target.");
      return;
    }

    if (system.ownerId && isAlliedWith(system.ownerId)) {
      flashNotice("Cannot move fleets into allied territory.");
      return;
    }

    if (system.ownerId && system.defenseNetTurns > 0) {
      flashNotice("Blocked by Defense Net.");
      return;
    }

    const isNeighbor = links?.[moveOriginId]?.includes(system.id);
    const canReach = wormholeActive || isNeighbor;
    if (!canReach) {
      flashNotice("Target not reachable (need Wormhole or a direct lane).");
      return;
    }

    const origin = systems.find((entry) => entry.id === moveOriginId);
    if (!origin || origin.ownerId !== playerId) return;
    const placement = Number(orders.placements?.[moveOriginId] || 0);
    const originFleets = (origin.fleets || 0) + placement;
    const queued = orders.moves.reduce(
      (sum, move) => (move.fromId === moveOriginId ? sum + Number(move.count || 0) : sum),
      0
    );
    const available = Math.max(0, originFleets - queued);
    if (available <= 0) {
      flashNotice("No fleets left at that origin.");
      return;
    }
    queueMove(moveOriginId, system.id, origin.fleets || 0);
  };

  const handleTogglePlacementMode = () => {
    if (!playerId) return;
    if (state?.phase !== "planning") return;
    if (fleetsRemaining <= 0) return;
    setMoveOriginId(null);
    setPowerupDraft("");
    setPlacementMode((current) => !current);
  };

  const handleRemoveMove = (index) => {
    removeMove(index);
  };

  const handleAdjustMove = (index, delta) => {
    const move = orders.moves[index];
    if (!move) return;
    const origin = systems.find((entry) => entry.id === move.fromId);
    if (!origin || origin.ownerId !== playerId) return;
    adjustMove(index, delta, origin.fleets || 0);
  };

  const handleLockIn = () => {
    lockIn((response) => {
      if (response && "error" in response) setError(response.error);
    });
  };

  const handleAlliance = (targetId) => {
    requestAlliance({ targetId });
  };

  const handleAcceptAlliance = (targetId) => {
    acceptAlliance({ fromId: targetId });
    setPendingAllianceFromIds((current) => {
      if (!current[targetId]) return current;
      const next = { ...current };
      delete next[targetId];
      return next;
    });
  };

  const handleLeaveGame = () => {
    window.localStorage.removeItem("stellcon.session");
    const params = new URLSearchParams(window.location.search);
    params.delete("game");
    window.history.replaceState(null, "", params.toString() ? `?${params.toString()}` : window.location.pathname);
    setGameId(null);
    setPlayerId(null);
    setState(null);
    resetOrders();
    setSelectedId(null);
    setMoveOriginId(null);
    setPendingAllianceFromIds({});
    setError("");
  };

  const handleNewMatch = () => {
    if (!socket || !state) return;
    const rawName = window.localStorage.getItem("stellcon.name") || me?.name || "";
    const name = rawName.trim().replace(/\s+/g, " ");
    const color = window.localStorage.getItem("stellcon.color") || me?.color || "";
    if (name.length < 2) {
      handleLeaveGame();
      return;
    }
    handleCreate({ name, config: state.config, color });
  };

  if (!gameId) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <Lobby
            onCreate={handleCreate}
            onJoin={handleJoin}
            onWatch={handleWatch}
            isBusy={!socket}
            games={availableGames}
          />
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="loading">
        <div>
          <div>Awaiting sector sync...</div>
          <button type="button" onClick={handleLeaveGame} className="secondary" style={{ marginTop: 12 }}>
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  const players = Object.values(state.players || {}).map((player) => ({
    ...player,
    systemCount: systems.filter((system) => system.ownerId === player.id).length,
  }));
  const commanderPlayers = [...players].sort((a, b) => {
    if (a.id === playerId) return -1;
    if (b.id === playerId) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  const rankedPlayers = [...players].sort((a, b) => b.systemCount - a.systemCount);
  const isComplete = state.phase === "complete";
  const winnerPlayer = (state.winnerId ? players.find((player) => player.id === state.winnerId) : null) || rankedPlayers[0] || null;

  return (
    <div className="app">
      <div className="overlay-top">
        {error ? <div className="alert">{error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}
        {powerupDraft ? (
          <div className="notice">
            Placing {POWERUPS[powerupDraft]?.label || powerupDraft}: click a highlighted system (Esc to cancel).
          </div>
        ) : null}
      </div>

      {isComplete && !endgameDismissed ? (
        <div className="endgame">
          <div className="endgame-card">
            <button type="button" className="endgame-close" onClick={() => setEndgameDismissed(true)} aria-label="Close">
              ×
            </button>
            <div className="endgame-winner">
              <div className="endgame-winner-title">
                <FleetIcon size={16} /> Winner
              </div>
              <div className="endgame-winner-name">{winnerPlayer?.name || "Unknown"}</div>
              <div className="endgame-winner-meta">{winnerPlayer?.systemCount ?? 0} systems</div>
            </div>
            <div className="panel-title">Final Rankings</div>
            <div className="endgame-list">
              {rankedPlayers.map((player, index) => (
                <div key={player.id} className={`endgame-row${player.id === winnerPlayer?.id ? " winner" : ""}`}>
                  <span>
                    {index + 1}. {player.name}
                  </span>
                  <span>{player.systemCount} systems</span>
                </div>
              ))}
            </div>
            <div className="endgame-actions">
              <button type="button" onClick={handleNewMatch}>
                New Match
              </button>
              <button type="button" className="secondary" onClick={handleLeaveGame}>
                Return to Lobby
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overlay-hud">
        <aside className="overlay-section left">
          <div className="panel left-commanders-card">
            <div className="panel-title">Commanders</div>
            <div className="game-code">Game Code: {gameId}</div>
            <div className="player-list">
              {commanderPlayers.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  highlight={player.id === playerId}
                  diplomacy={(() => {
                    if (!playerId) return null;
                    if (player.id === playerId) return null;

                    const alliedTurns = Number(me?.alliances?.[player.id] || 0);
                    if (alliedTurns > 0) {
                      return {
                        label: `Allied (${alliedTurns})`,
                        disabled: true,
                        title: "Alliance lasts 3 turns.",
                        onClick: () => {},
                      };
                    }

                    if (pendingAllianceFromIds[player.id]) {
                      return {
                        label: "Accept",
                        disabled: false,
                        title: "Accept alliance (lasts 3 turns).",
                        onClick: () => handleAcceptAlliance(player.id),
                      };
                    }

                    return {
                      label: "Diplomacy",
                      disabled: false,
                      title: "Request alliance (lasts 3 turns).",
                      onClick: () => handleAlliance(player.id),
                    };
                  })()}
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="board-area">
          <Board
            systems={systems}
            links={links}
            players={state.players}
            orders={orders}
            revealedMoves={state.revealedMoves}
            resolutionStartedAt={state.resolutionStartedAt}
            resolutionEndsAt={state.resolutionEndsAt}
            resolutionBattles={state.resolutionBattles}
            phase={state.phase}
            viewerId={playerId}
            wormholeTurns={me?.wormholeTurns || 0}
            powerupDraft={powerupDraft}
            powerupTargetIds={powerupTargetIds}
            powerupHighlightColor={powerupHighlightColor}
            placementMode={placementMode}
            fleetsRemaining={fleetsRemaining}
            selectedId={selectedId}
            moveOriginId={moveOriginId}
            onSystemClick={handleSystemClick}
            onBackgroundClick={() => setSelectedId(null)}
            onMoveAdjust={handleAdjustMove}
            onMoveCancel={handleRemoveMove}
          />
        </section>

        <aside className="overlay-section right">
          <div className="right-actions-stack">
            <div className="top-actions right-actions-top">
              <button type="button" onClick={handleLeaveGame} className="secondary">
                Return to Lobby
              </button>
            </div>

            <div className="panel right-actions-card">
              <div className="panel-subtitle">Fleet Placement</div>
              <div className="panel-row">
                <button
                  type="button"
                  className={`bottom-placement ${placementMode ? "active" : ""}`}
                  onClick={handleTogglePlacementMode}
                  disabled={!playerId || state.phase !== "planning" || fleetsRemaining <= 0}
                  aria-pressed={placementMode}
                  title={placementMode ? "Placement mode active" : "Enter placement mode"}
                >
                  <FleetIcon />
                  <span className="bottom-placement-count">{fleetsRemaining}</span>
                </button>
                <div className="muted">Click one of your systems to place 1 fleet.</div>
              </div>

              <div className="panel-subtitle">Powerups</div>
              <div className="powerup-grid">
                {Object.values(POWERUPS).map((powerup) => {
                  const points = Number(me?.research?.[powerup.resource] || 0);
                  const ratio = clamp(points / powerup.cost, 0, 1);
                  const canUse = !!playerId && state.phase === "planning" && points >= powerup.cost;
                  return (
                    <div key={powerup.key} className="powerup-row">
                      <button
                        type="button"
                        className={`${powerupDraft === powerup.key ? "active" : ""} ${canUse ? "available" : ""}`}
                        disabled={!playerId || state.phase !== "planning"}
                        onClick={() => {
                          setPlacementMode(false);
                          setMoveOriginId(null);
                          setPowerupDraft((current) => (current === powerup.key ? "" : powerup.key));
                        }}
                        aria-label={`${powerup.label}: ${points}/${powerup.cost} ${resourceLabels[powerup.resource]}`}
                        title={`${powerup.label}: ${points}/${powerup.cost} ${resourceLabels[powerup.resource]}`}
                        style={{ "--res-color": RESOURCE_COLORS[powerup.resource] || "rgba(255,255,255,0.6)" }}
                      >
                        <span className="powerup-label">{powerup.label}</span>
                        <span className="cost">
                          {canUse ? "Ready" : `${powerup.cost} ${resourceLabels[powerup.resource]}`}
                        </span>
                        <span className="powerup-progress" aria-label={`${powerup.label} resource progress`}>
                          <span className="powerup-progress-track" aria-hidden="true">
                            <span className="powerup-progress-fill" style={{ width: `${ratio * 100}%` }} />
                          </span>
                          <span className="powerup-progress-label">
                            {Math.min(points, powerup.cost)}/{powerup.cost}
                          </span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {powerupDraft ? (
                <div className="muted">{powerupHelp[powerupDraft] || "Click a highlighted system to place."}</div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      <div className="overlay-bottom" aria-label="Game Status">
        <div className="bottom-hud">
          <div className="bottom-main">
            <div className="countdown" role="status" aria-label="Turn Countdown">
              <div className="countdown-track" aria-hidden="true">
                <div className="countdown-fill" style={{ width: `${planningRatio * 100}%` }} />
              </div>
              <div className="countdown-text">
                Turn {state.turn} of {state.config.maxTurns} — {state.phase === "planning" ? `${timer}s` : "Resolving..."}
              </div>
            </div>

            <div className="bottom-actions">
              <button type="button" onClick={handleLockIn} disabled={state.phase !== "planning" || me?.locked}>
                {me?.locked ? "Locked" : "Lock In"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default App;
