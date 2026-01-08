import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildConnectedComponentIndex, computeIncome, inSameConnectedComponent, PLAYER_COLORS, POWERUPS, RESOURCE_COLORS, RESOURCE_TYPES, RESOLUTION_TRAVEL_MS } from "@stellcon/shared";
import type { GameListItem, GameState, Orders, PowerupKey } from "@stellcon/shared";
import { demoPlayerId, demoState } from "./demoState.js";
import Board from "./features/board/Board";
import Lobby from "./features/lobby/Lobby.jsx";
import LobbyStars from "./features/lobby/LobbyStars.jsx";
import GameStars from "./features/game/GameStars.jsx";
import PlayerCard from "./features/lobby/PlayerCard.jsx";
import { emptyOrders } from "./shared/lib/orders";
import { PowerupIcon } from "./shared/components/PowerupIcon";
import { useGameSocket } from "./shared/hooks/useGameSocket";
import { useOrders } from "./shared/hooks/useOrders";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const MUSIC_TRACKS = {
  intro: "/StellCon%20-%20Intro.mp3",
  recon: "/StellCon%20-%20Recon.Mp3",
  decisions: "/StellCon%20-%20Decisions.mp3",
} as const;
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
  wormhole: "Select a start system you own, then select any destination system; creates a wormhole link for 3 turns.",
};

type PlayerColor = (typeof PLAYER_COLORS)[number];

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

function MusicIcon({ muted, size = 18 }: { muted: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17 3.6c.3-.1.7 0 .9.2.3.2.4.5.4.8v10.6c0 2.3-1.8 4-4.2 4-2 0-3.6-1.3-3.6-3.1 0-2 1.9-3.3 4-3.3.7 0 1.3.1 1.9.3V7.2l-8 2V16c0 2.3-1.8 4-4.2 4-2 0-3.6-1.3-3.6-3.1 0-2 1.9-3.3 4-3.3.7 0 1.3.1 1.9.3V7.4c0-.5.3-.9.8-1l10-2.8Z"
      />
      {muted ? <path fill="currentColor" d="M4.4 4.4a1 1 0 0 1 1.4 0l13.8 13.8a1 1 0 0 1-1.4 1.4L4.4 5.8a1 1 0 0 1 0-1.4Z" /> : null}
    </svg>
  );
}

function SfxIcon({ muted, size = 18 }: { muted: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4.5 9.2c0-.6.4-1 1-1h3.2l4.6-3.6c.7-.5 1.7 0 1.7.9v13c0 .9-1 1.4-1.7.9l-4.6-3.6H5.5c-.6 0-1-.4-1-1V9.2Z"
      />
      <path
        fill="currentColor"
        d="M18.1 8.3c.4-.4 1-.4 1.4 0 1.1 1.1 1.8 2.6 1.8 4.2s-.7 3.1-1.8 4.2c-.4.4-1 .4-1.4 0-.4-.4-.4-1 0-1.4.8-.8 1.2-1.7 1.2-2.8s-.4-2-1.2-2.8c-.4-.4-.4-1 0-1.4Z"
        opacity={muted ? 0.25 : 0.95}
      />
      {muted ? <path fill="currentColor" d="M16.1 9.9a1 1 0 0 1 1.4 0l2.7 2.7a1 1 0 0 1 0 1.4l-2.7 2.7a1 1 0 1 1-1.4-1.4l2-2-2-2a1 1 0 0 1 0-1.4Z" /> : null}
    </svg>
  );
}

function SoundControls({
  musicMuted,
  sfxMuted,
  onToggleMusic,
  onToggleSfx,
}: {
  musicMuted: boolean;
  sfxMuted: boolean;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
}) {
  return (
    <div className="sound-controls" role="group" aria-label="Sound controls">
      <button
        type="button"
        className={`sound-toggle ${musicMuted ? "muted" : ""}`}
        onClick={onToggleMusic}
        aria-pressed={musicMuted}
        aria-label={musicMuted ? "Unmute music" : "Mute music"}
        title={musicMuted ? "Unmute music" : "Mute music"}
      >
        <MusicIcon muted={musicMuted} />
      </button>
      <button
        type="button"
        className={`sound-toggle ${sfxMuted ? "muted" : ""}`}
        onClick={onToggleSfx}
        aria-pressed={sfxMuted}
        aria-label={sfxMuted ? "Unmute sound effects" : "Mute sound effects"}
        title={sfxMuted ? "Unmute sound effects" : "Mute sound effects"}
      >
        <SfxIcon muted={sfxMuted} />
      </button>
    </div>
  );
}

function App() {
  const [state, setState] = useState<GameState | null>(DEMO_MODE ? (demoState as unknown as GameState) : null);
  const [playerId, setPlayerId] = useState<string | null>(DEMO_MODE ? demoPlayerId : null);
  const [gameId, setGameId] = useState<string | null>(DEMO_MODE ? demoState.id : null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [endgameDismissed, setEndgameDismissed] = useState(false);
  const { orders, resetOrders, replaceOrders, applyPlacement, queuePowerup, queueWormhole, queueMove, removeMove, adjustMove } =
    useOrders(DEMO_MODE ? (demoState.players[demoPlayerId].orders as Orders) : emptyOrders());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moveOriginId, setMoveOriginId] = useState<string | null>(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [powerupDraft, setPowerupDraft] = useState<PowerupKey | "">("");
  const [wormholeFromId, setWormholeFromId] = useState<string | null>(null);
  const [powerupFx, setPowerupFx] = useState<Array<{ type: Exclude<PowerupKey, "wormhole">; targetId: string; startedAt: number }>>([]);
  const [pendingAllianceFromIds, setPendingAllianceFromIds] = useState<Record<string, boolean>>({});
  const [pendingAllianceToIds, setPendingAllianceToIds] = useState<Record<string, boolean>>({});
  const [declinedAllianceByIds, setDeclinedAllianceByIds] = useState<Record<string, boolean>>({});
  const [alliancePopup, setAlliancePopup] = useState<{ fromId: string; fromName: string } | null>(null);
  const [timer, setTimer] = useState(0);
  const [availableGames, setAvailableGames] = useState<GameListItem[]>([]);
  const lastSeenTurnRef = useRef<{ turn: number | null; phase: string | null }>({ turn: null, phase: null });
  const noticeTimeoutRef = useRef<number | null>(null);
  const powerupFxTimeoutRef = useRef<number[]>([]);
  const lastResolutionStartedAtRef = useRef<number | null>(null);
  const prevSystemsRef = useRef<Map<string, { defenseNetTurns: number; terraformed: boolean; tier: number; fleets: number }>>(new Map());
  const backgroundMusicRef = useRef<HTMLAudioElement | null>(null);
  const backgroundTrackRef = useRef<string | null>(null);
  const [backgroundAudioEl, setBackgroundAudioEl] = useState<HTMLAudioElement | null>(null);
  const [musicMuted, setMusicMuted] = useState(() => window.localStorage.getItem("stellcon.muteMusic") === "1");
  const [sfxMuted, setSfxMuted] = useState(() => window.localStorage.getItem("stellcon.muteSfx") === "1");
  const [codeCopied, setCodeCopied] = useState(false);
  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [rematchInfo, setRematchInfo] = useState<{ gameId: string; creatorName: string } | null>(null);
  const [joinName, setJoinName] = useState(() => window.localStorage.getItem("stellcon.name") || "");
  const [joinColor, setJoinColor] = useState<PlayerColor | "">(() => {
    const stored = window.localStorage.getItem("stellcon.color");
    if (!stored) return "";
    return (PLAYER_COLORS as readonly string[]).includes(stored) ? (stored as PlayerColor) : "";
  });
  const [joinError, setJoinError] = useState("");

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
          setSelectedId(null);
          // Reset alliance offer states at the start of each turn (offers expire each round)
          setPendingAllianceToIds({});
          setDeclinedAllianceByIds({});
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
    // Show popup - name will be resolved from state when rendering
    setAlliancePopup({ fromId, fromName: fromId });
  }, []);

  const handleAllianceRetracted = useCallback((fromId: string) => {
    // Remove the incoming offer and dismiss popup if it's from this player
    setPendingAllianceFromIds((current) => {
      if (!current[fromId]) return current;
      const next = { ...current };
      delete next[fromId];
      return next;
    });
    setAlliancePopup((current) => (current?.fromId === fromId ? null : current));
  }, []);

  const handleAllianceDeclined = useCallback((byId: string) => {
    // Remove the pending outgoing offer and mark as declined
    setPendingAllianceToIds((current) => {
      if (!current[byId]) return current;
      const next = { ...current };
      delete next[byId];
      return next;
    });
    setDeclinedAllianceByIds((current) => ({ ...current, [byId]: true }));
  }, []);

  const handleRematchCreated = useCallback((gameId: string, creatorName: string) => {
    setRematchInfo({ gameId, creatorName });
  }, []);

  const socketCallbacks = useMemo(
    () => ({
      onGameState: handleGameState,
      onGamesList: handleGamesList,
      onAllianceRequest: handleAllianceRequest,
      onAllianceRetracted: handleAllianceRetracted,
      onAllianceDeclined: handleAllianceDeclined,
      onRematchCreated: handleRematchCreated,
    }),
    [handleAllianceDeclined, handleAllianceRequest, handleAllianceRetracted, handleGameState, handleGamesList, handleRematchCreated]
  );

  const {
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
      for (const id of powerupFxTimeoutRef.current) window.clearTimeout(id);
      powerupFxTimeoutRef.current = [];
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("stellcon.muteMusic", musicMuted ? "1" : "0");
  }, [musicMuted]);

  useEffect(() => {
    window.localStorage.setItem("stellcon.muteSfx", sfxMuted ? "1" : "0");
  }, [sfxMuted]);

  useEffect(() => {
    document.documentElement.dataset.stellconMusicMuted = musicMuted ? "1" : "0";
    document.documentElement.dataset.stellconSfxMuted = sfxMuted ? "1" : "0";
    window.dispatchEvent(new CustomEvent("stellcon:sound", { detail: { musicMuted, sfxMuted } }));
  }, [musicMuted, sfxMuted]);

  useEffect(() => {
    if (!backgroundMusicRef.current) {
      const audio = new Audio(MUSIC_TRACKS.intro);
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0.35;
      backgroundMusicRef.current = audio;
      setBackgroundAudioEl(audio);
      backgroundTrackRef.current = MUSIC_TRACKS.intro;
    }

    const audio = backgroundMusicRef.current;
    if (!backgroundAudioEl) setBackgroundAudioEl(audio);
    const playerCount = state ? Object.keys(state.players || {}).length : 0;
    const maxPlayers = state?.config?.maxPlayers || 2;
    const isWaiting = state && state.turn === 1 && playerCount < maxPlayers;
    const inLobby = !gameId || isWaiting;
    const maxTurns = Number(state?.config?.maxTurns || 0);
    const turn = Number(state?.turn || 0);
    const shouldSwitchToDecisions = !inLobby && maxTurns > 0 && turn >= Math.ceil(maxTurns * 0.25);
    const desiredTrack = inLobby ? MUSIC_TRACKS.intro : shouldSwitchToDecisions ? MUSIC_TRACKS.decisions : MUSIC_TRACKS.recon;
    const shouldPlay = !musicMuted;

    let resumeHandler: (() => void) | null = null;
    let visibilityHandler: (() => void) | null = null;

    const targetVolume = 0.35;
    const fadeDuration = 500; // 0.5 seconds
    let fadeInterval: number | null = null;
    let needsFadeIn = false;

    const fadeInAudio = () => {
      audio.volume = 0;
      const startTime = Date.now();
      fadeInterval = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / fadeDuration, 1);
        audio.volume = targetVolume * progress;
        if (progress >= 1 && fadeInterval) {
          window.clearInterval(fadeInterval);
          fadeInterval = null;
        }
      }, 16);
    };

    const tryPlay = (withFade: boolean) => {
      audio.muted = false;
      if (withFade) {
        fadeInAudio();
      } else {
        audio.volume = targetVolume;
      }
      void audio.play().catch(() => {
        if (!shouldPlay) return;
        resumeHandler = () => {
          resumeHandler = null;
          // On user interaction resume, use fade only if it was a fresh track
          if (withFade) fadeInAudio();
          else audio.volume = targetVolume;
          void audio.play().catch(() => {});
        };
        window.addEventListener("pointerdown", resumeHandler, { once: true });
        window.addEventListener("keydown", resumeHandler, { once: true });
      });
    };

    const switchTrack = () => {
      if (backgroundTrackRef.current === desiredTrack) return false;
      backgroundTrackRef.current = desiredTrack;
      audio.pause();
      audio.src = desiredTrack;
      audio.load();
      return true;
    };

    needsFadeIn = switchTrack();

    if (!shouldPlay) {
      audio.pause();
      audio.muted = true;
    } else {
      tryPlay(needsFadeIn);
    }

    visibilityHandler = () => {
      if (document.visibilityState !== "visible") {
        audio.pause();
        return;
      }
      if (!shouldPlay) return;
      const switched = switchTrack();
      // Only fade in if we switched tracks, otherwise just resume at normal volume
      tryPlay(switched);
    };

    document.addEventListener("visibilitychange", visibilityHandler);

    return () => {
      document.removeEventListener("visibilitychange", visibilityHandler!);
      if (resumeHandler) {
        window.removeEventListener("pointerdown", resumeHandler);
        window.removeEventListener("keydown", resumeHandler);
      }
      if (fadeInterval) {
        window.clearInterval(fadeInterval);
      }
    };
  }, [backgroundAudioEl, gameId, musicMuted, state?.config?.maxTurns, state?.config?.maxPlayers, state?.turn, state?.players]);

  useEffect(() => {
    if (!placementMode) return;
    if (state?.phase !== "planning" || fleetsRemaining <= 0) setPlacementMode(false);
  }, [fleetsRemaining, placementMode, state?.phase]);

  useEffect(() => {
    if (state?.phase === "planning") return;
    setMoveOriginId(null);
    setPowerupDraft("");
    setWormholeFromId(null);
  }, [state?.phase]);

  useEffect(() => {
    if (state?.phase !== "complete") setEndgameDismissed(false);
  }, [state?.phase]);

  useEffect(() => {
    setEndgameDismissed(false);
    setSelectedId(null);
    setRematchInfo(null);
    setPendingAllianceFromIds({});
    setPendingAllianceToIds({});
    setDeclinedAllianceByIds({});
    setAlliancePopup(null);
  }, [gameId]);

  // Set default join color when prompt opens or available colors change
  useEffect(() => {
    if (!showJoinPrompt || !state) return;
    const takenColors = Object.values(state.players || {}).map((p) => p.color);
    const available = PLAYER_COLORS.filter((c) => !takenColors.includes(c));
    if (available.length > 0 && (!joinColor || !available.includes(joinColor))) {
      setJoinColor(available[0]);
    }
  }, [showJoinPrompt, state, joinColor]);

  useEffect(() => {
    if (!powerupDraft) return;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setPowerupDraft("");
      setWormholeFromId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [powerupDraft]);

  useEffect(() => {
    if (powerupDraft !== "wormhole") setWormholeFromId(null);
  }, [powerupDraft]);

  useEffect(() => {
    if (!state?.systems?.length) return;
    const currentById = new Map(
      state.systems.map((system) => [
        system.id,
        {
          defenseNetTurns: Number(system.defenseNetTurns || 0),
          terraformed: Boolean(system.terraformed),
          tier: Number(system.tier || 0),
          fleets: Number(system.fleets || 0),
        },
      ])
    );

    const startedAt = state.resolutionStartedAt || null;
    if (state.phase === "resolving" && startedAt && lastResolutionStartedAtRef.current !== startedAt) {
      lastResolutionStartedAtRef.current = startedAt;

      for (const id of powerupFxTimeoutRef.current) window.clearTimeout(id);
      powerupFxTimeoutRef.current = [];

      const prevById = prevSystemsRef.current;
      const immediate: Array<{ type: Exclude<PowerupKey, "wormhole">; targetId: string; startedAt: number }> = [];
      const bomb: Array<{ type: Exclude<PowerupKey, "wormhole">; targetId: string; startedAt: number }> = [];
      for (const player of Object.values(state.players || {})) {
        for (const action of player?.orders?.powerups || []) {
          if (!action || action.type === "wormhole") continue;
          if (!("targetId" in action) || !action.targetId) continue;
          const prev = prevById.get(action.targetId);
          const next = currentById.get(action.targetId);
          if (!next) continue;

          if (action.type === "defenseNet") {
            if (!prev || (prev.defenseNetTurns || 0) <= 0) {
              if (next.defenseNetTurns > 0) immediate.push({ type: "defenseNet", targetId: action.targetId, startedAt });
            }
            continue;
          }

          if (action.type === "terraform") {
            if (!prev || (!prev.terraformed && next.terraformed) || (prev.tier || 0) !== (next.tier || 0)) {
              immediate.push({ type: "terraform", targetId: action.targetId, startedAt });
            }
            continue;
          }

          if (action.type === "stellarBomb") {
            bomb.push({ type: "stellarBomb", targetId: action.targetId, startedAt: startedAt + RESOLUTION_TRAVEL_MS });
          }
        }
      }

      if (immediate.length) {
        setPowerupFx(immediate);
        powerupFxTimeoutRef.current.push(
          window.setTimeout(() => {
            setPowerupFx([]);
          }, 1300)
        );
      }

      if (bomb.length) {
        const delayMs = Math.max(0, startedAt + RESOLUTION_TRAVEL_MS - Date.now());
        powerupFxTimeoutRef.current.push(
          window.setTimeout(() => {
            setPowerupFx(bomb);
            powerupFxTimeoutRef.current.push(
              window.setTimeout(() => {
                setPowerupFx([]);
              }, 1100)
            );
          }, delayMs)
        );
      }
    }

    prevSystemsRef.current = currentById;
  }, [state?.phase, state?.players, state?.resolutionStartedAt, state?.systems]);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    if (gameId || playerId) return;
    const fromUrl = new URLSearchParams(window.location.search).get("game");
    if (fromUrl) {
      watchGame({ gameId: fromUrl }, (response) => {
        if (response && "error" in response) {
          setError(response.error);
          const params = new URLSearchParams(window.location.search);
          params.delete("game");
          window.history.replaceState(null, "", params.toString() ? `?${params.toString()}` : window.location.pathname);
          setGameId(null);
        } else {
          setShowJoinPrompt(true);
        }
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

  const plannedWormholes = useMemo(() => {
    const active = Array.isArray(state?.wormholes) ? state.wormholes : [];
    const queued = (orders.powerups || [])
      .filter((entry) => entry.type === "wormhole")
      .map((entry) => ({ fromId: entry.fromId, toId: entry.toId, turnsRemaining: POWERUPS.wormhole.duration }));
    return [...active, ...queued];
  }, [orders.powerups, state?.wormholes]);

  const canAttackFromOwned = useCallback((targetId) => {
    if (!playerId) return false;
    for (const system of systems) {
      if (system.ownerId !== playerId) continue;
      if (links?.[system.id]?.includes(targetId)) return true;
    }
    const systemMap = new Map(systems.map((system) => [system.id, system]));
    for (const wormhole of plannedWormholes) {
      if ((wormhole.turnsRemaining || 0) <= 0) continue;
      const from = systemMap.get(wormhole.fromId);
      const to = systemMap.get(wormhole.toId);
      if (from?.ownerId === playerId && wormhole.toId === targetId) return true;
      if (to?.ownerId === playerId && wormhole.fromId === targetId) return true;
    }
    return false;
  }, [links, plannedWormholes, playerId, systems]);

  const canTravelViaWormhole = useCallback(
    (fromId: string, toId: string) =>
      plannedWormholes.some(
        (wormhole) =>
          (wormhole.turnsRemaining || 0) > 0 &&
          ((wormhole.fromId === fromId && wormhole.toId === toId) || (wormhole.fromId === toId && wormhole.toId === fromId))
      ),
    [plannedWormholes]
  );

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
        if (!wormholeFromId) {
          if (system.ownerId === playerId) targets.add(system.id);
        } else if (system.id !== wormholeFromId) {
          targets.add(system.id);
        }
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
  }, [canAttackFromOwned, isAlliedWith, me?.research, playerId, powerupDraft, state?.phase, systems, wormholeFromId]);

  const powerupHighlightColor = useMemo(() => {
    if (!powerupDraft) return "";
    if (powerupDraft === "stellarBomb") return RESOURCE_COLORS.metal;
    const resource = POWERUPS[powerupDraft]?.resource;
    return resource ? RESOURCE_COLORS[resource] : "";
  }, [powerupDraft]);

  const tryQueuePowerupAt = (system) => {
    if (!playerId) return false;
    if (state?.phase !== "planning") return false;
    if (!powerupDraft) return false;
    if (powerupDraft === "wormhole") return false;
    const powerup = POWERUPS[powerupDraft];
    if (!powerup) return false;
    if ((me?.research?.[powerup.resource] || 0) < powerup.cost) return false;
    if (!system?.id) return false;

    if (!powerupTargetIds.has(system.id)) {
      flashNotice("Not a valid target for that powerup.");
      return false;
    }

    queuePowerup(powerupDraft as Exclude<PowerupKey, "wormhole">, system.id);
    setPowerupDraft("");
    setMoveOriginId(null);
    return true;
  };

  const handleSystemClick = (system, event) => {
    setSelectedId(system.id);
    if (!system) return;

    if (powerupDraft) {
      if (powerupDraft === "wormhole") {
        if (!playerId) return;
        if (state?.phase !== "planning") return;
        const powerup = POWERUPS.wormhole;
        if (!powerup) return;
        if ((me?.research?.[powerup.resource] || 0) < powerup.cost) return;

        if (!wormholeFromId) {
          if (!powerupTargetIds.has(system.id)) {
            flashNotice("Select one of your systems to start the wormhole.");
            return;
          }
          setWormholeFromId(system.id);
          return;
        }

        if (system.id === wormholeFromId) {
          setWormholeFromId(null);
          return;
        }

        if (!powerupTargetIds.has(system.id)) {
          flashNotice("Not a valid destination for that wormhole.");
          return;
        }

        queueWormhole(wormholeFromId, system.id);
        setPowerupDraft("");
        setWormholeFromId(null);
        setMoveOriginId(null);
        return;
      }

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

    const isOwnedByMe = system.ownerId === playerId;

    if (isOwnedByMe) {
      if (moveOriginId && moveOriginId !== system.id) {
        const canReach = canTravelViaWormhole(moveOriginId, system.id) || inSameConnectedComponent(componentById, moveOriginId, system.id);
        if (!canReach) {
          flashNotice("Not reachable (need a connected section or a Wormhole link).");
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
    const canReach = isNeighbor || canTravelViaWormhole(moveOriginId, system.id);
    if (!canReach) {
      flashNotice("Target not reachable (need a direct lane or a Wormhole link).");
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

  const handleAlliance = (targetId: string) => {
    requestAlliance({ targetId });
    setPendingAllianceToIds((current) => ({ ...current, [targetId]: true }));
  };

  const handleRetractAlliance = (targetId: string) => {
    retractAlliance({ targetId });
    setPendingAllianceToIds((current) => {
      if (!current[targetId]) return current;
      const next = { ...current };
      delete next[targetId];
      return next;
    });
  };

  const handleAcceptAlliance = (targetId: string) => {
    acceptAlliance({ fromId: targetId });
    setPendingAllianceFromIds((current) => {
      if (!current[targetId]) return current;
      const next = { ...current };
      delete next[targetId];
      return next;
    });
    if (alliancePopup?.fromId === targetId) {
      setAlliancePopup(null);
    }
  };

  const handleDeclineAlliance = (fromId: string) => {
    declineAlliance({ fromId });
    setPendingAllianceFromIds((current) => {
      if (!current[fromId]) return current;
      const next = { ...current };
      delete next[fromId];
      return next;
    });
    if (alliancePopup?.fromId === fromId) {
      setAlliancePopup(null);
    }
  };

  const handleLeaveGame = () => {
    if (socket && !DEMO_MODE) {
      leaveGame();
    }
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
    // Pass the current gameId as previousGameId to notify other players about the rematch
    setError("");
    createGame({ name, config: state.config, color, previousGameId: gameId || undefined }, (response) => {
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

  if (!gameId) {
    return (
      <div className="lobby">
        <LobbyStars audioEl={backgroundAudioEl} />
        <div className="lobby-shell">
          <div className="lobby-brand" aria-label="Stellcon">
            <div className="lobby-brand-title">Stellcon</div>
          </div>
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
        <SoundControls
          musicMuted={musicMuted}
          sfxMuted={sfxMuted}
          onToggleMusic={() => setMusicMuted((current) => !current)}
          onToggleSfx={() => setSfxMuted((current) => !current)}
        />
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
        <SoundControls
          musicMuted={musicMuted}
          sfxMuted={sfxMuted}
          onToggleMusic={() => setMusicMuted((current) => !current)}
          onToggleSfx={() => setSfxMuted((current) => !current)}
        />
      </div>
    );
  }

  const players = Object.values(state.players || {}).map((player) => {
    const income = computeIncome(state, player.id);
    return {
      ...player,
      systemCount: systems.filter((system) => system.ownerId === player.id).length,
      fleetProduction: income.fleets,
    };
  });
  const commanderPlayers = [...players].sort((a, b) => {
    if (a.id === playerId) return -1;
    if (b.id === playerId) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  // Sort by fleet production first, then by system count as tiebreaker
  const rankedPlayers = [...players].sort((a, b) => {
    if (b.fleetProduction !== a.fleetProduction) return b.fleetProduction - a.fleetProduction;
    return b.systemCount - a.systemCount;
  });
  const isComplete = state.phase === "complete";
  const isTie = state.winnerId === null && isComplete;
  const winnerPlayer = isTie ? null : (state.winnerId ? players.find((player) => player.id === state.winnerId) : rankedPlayers[0] || null);
  const isWaitingForPlayers = state.turn === 1 && players.length < state.config.maxPlayers;

  // For join prompt: calculate available colors and existing names
  const takenColors = players.map((p) => p.color);
  const availableColors = PLAYER_COLORS.filter((c) => !takenColors.includes(c));
  const existingNames = players.map((p) => (p.name || "").toLowerCase().trim());
  const trimmedJoinName = joinName.trim().replace(/\s+/g, " ");
  const isJoinNameValid = trimmedJoinName.length >= 2;
  const isJoinNameUnique = !existingNames.includes(trimmedJoinName.toLowerCase());
  const canJoinGame = showJoinPrompt && !playerId && availableColors.length > 0 && players.length < state.config.maxPlayers;

  // Show lobby with waiting overlay while waiting for players
  if (isWaitingForPlayers) {
    return (
      <div className="lobby">
        <LobbyStars audioEl={backgroundAudioEl} />
        <div className="lobby-shell">
          <div className="lobby-brand" aria-label="Stellcon">
            <div className="lobby-brand-title">Stellcon</div>
          </div>
          <div className="lobby-card">
            <div className="waiting-lobby">
              <div className="waiting-title">Waiting for Players</div>
              <div className="waiting-count">
                {players.length} / {state.config.maxPlayers} Commanders
              </div>
              <div className="waiting-players">
                {players.map((player) => (
                  <div key={player.id} className="waiting-player" style={{ "--player-color": player.color } as React.CSSProperties}>
                    <span className="waiting-player-dot" />
                    <span className="waiting-player-name">{player.name}</span>
                    {player.id === playerId ? <span className="waiting-player-you">(You)</span> : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="waiting-code"
                onClick={() => {
                  if (gameId && !codeCopied) {
                    navigator.clipboard.writeText(gameId).then(() => {
                      setCodeCopied(true);
                      setTimeout(() => setCodeCopied(false), 2000);
                    }).catch(() => {});
                  }
                }}
                title="Click to copy"
              >
                <span className="waiting-code-label">Game Code</span>
                <span className="waiting-code-value">{gameId}</span>
                <span className={`waiting-code-hint ${codeCopied ? "copied" : ""}`}>{codeCopied ? "Copied!" : "Click to copy"}</span>
              </button>
              <div className="waiting-hint">Share the game code with friends to join</div>
              {playerId && state.config.maxPlayers > 2 && players.length >= 2 ? (
                <button
                  type="button"
                  className="waiting-start"
                  onClick={() => {
                    startGameEarly((response) => {
                      if (response && "error" in response) {
                        setError(response.error);
                      }
                    });
                  }}
                >
                  Start with {players.length} Players
                </button>
              ) : null}
              <button type="button" className="secondary waiting-leave" onClick={handleLeaveGame}>
                Leave Game
              </button>
            </div>
          </div>
        </div>
        {canJoinGame ? (
          <div className="join-prompt-overlay">
            <div className="join-prompt-card">
              <div className="join-prompt-title">Join Game</div>
              <div className="join-prompt-subtitle">
                {players.length} / {state.config.maxPlayers} players
              </div>
              {joinError ? <div className="join-prompt-error">{joinError}</div> : null}
              <label className="join-prompt-label">
                Commander Name
                <input
                  type="text"
                  className="join-prompt-input"
                  value={joinName}
                  onChange={(e) => {
                    setJoinName(e.target.value);
                    setJoinError("");
                  }}
                  placeholder="Enter your name"
                  autoFocus
                />
                {!isJoinNameUnique && trimmedJoinName.length > 0 ? (
                  <span className="join-prompt-name-error">Name already taken</span>
                ) : null}
              </label>
              <div className="join-prompt-label">
                Select Color
                <div className="join-prompt-colors">
                  {availableColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`join-prompt-color ${joinColor === c ? "active" : ""}`}
                      style={{ "--swatch-color": c } as React.CSSProperties}
                      onClick={() => setJoinColor(c)}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>
              <div className="join-prompt-actions">
                <button
                  type="button"
                  disabled={!isJoinNameValid || !isJoinNameUnique || !joinColor}
                  onClick={() => {
                    if (!isJoinNameValid || !isJoinNameUnique || !joinColor || !gameId) return;
                    window.localStorage.setItem("stellcon.name", joinName);
                    window.localStorage.setItem("stellcon.color", joinColor);
                    joinGame({ name: trimmedJoinName, gameId, color: joinColor }, (response) => {
                      if (!response) {
                        setJoinError("No response from server.");
                        return;
                      }
                      if ("error" in response) {
                        setJoinError(response.error);
                        return;
                      }
                      setPlayerId(response.playerId);
                      setShowJoinPrompt(false);
                      setJoinError("");
                      resetOrders();
                      setSelectedId(null);
                      window.localStorage.setItem(
                        "stellcon.session",
                        JSON.stringify({ gameId: response.gameId, playerId: response.playerId })
                      );
                    });
                  }}
                >
                  Join Game
                </button>
                <button type="button" className="secondary" onClick={() => setShowJoinPrompt(false)}>
                  Watch Only
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <SoundControls
          musicMuted={musicMuted}
          sfxMuted={sfxMuted}
          onToggleMusic={() => setMusicMuted((current) => !current)}
          onToggleSfx={() => setSfxMuted((current) => !current)}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <GameStars />
      <div className="corner-brand" aria-hidden="true">
        <div className="lobby-brand-title">Stellcon</div>
      </div>
      <div className="overlay-top">
        {error ? <div className="alert">{error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}
        {powerupDraft ? (
          <div className="notice">
            {powerupDraft === "wormhole"
              ? wormholeFromId
                ? "Placing Wormhole: select a destination system (Esc to cancel)."
                : "Placing Wormhole: select a start system you own (Esc to cancel)."
              : `Placing ${POWERUPS[powerupDraft]?.label || powerupDraft}: click a highlighted system (Esc to cancel).`}
          </div>
        ) : null}
        {alliancePopup ? (
          <div className="alliance-popup">
            <span className="alliance-popup-text">
              {state?.players?.[alliancePopup.fromId]?.name || alliancePopup.fromId} requests an alliance
            </span>
            <button type="button" className="alliance-popup-accept" onClick={() => handleAcceptAlliance(alliancePopup.fromId)}>
              Accept
            </button>
            <button type="button" className="alliance-popup-decline" onClick={() => handleDeclineAlliance(alliancePopup.fromId)}>
              Decline
            </button>
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
                <FleetIcon size={16} /> {isTie ? "Tie Game" : "Winner"}
              </div>
              {isTie ? (
                <div className="endgame-winner-name">Draw</div>
              ) : (
                <>
                  <div className="endgame-winner-name">{winnerPlayer?.name || "Unknown"}</div>
                  <div className="endgame-winner-meta">{winnerPlayer?.fleetProduction ?? 0} fleet production</div>
                </>
              )}
            </div>
            <div className="panel-title">Final Rankings</div>
            <div className="endgame-list">
              {rankedPlayers.map((player, index) => (
                <div key={player.id} className={`endgame-row${!isTie && player.id === winnerPlayer?.id ? " winner" : ""}`}>
                  <span>
                    {index + 1}. {player.name}
                  </span>
                  <span>{player.fleetProduction} fleets · {player.systemCount} systems</span>
                </div>
              ))}
            </div>
            {rematchInfo ? (
              <div className="endgame-rematch">
                <div className="endgame-rematch-text">
                  {rematchInfo.creatorName} started a rematch!
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const rawName = window.localStorage.getItem("stellcon.name") || me?.name || "";
                    const name = rawName.trim().replace(/\s+/g, " ");
                    const color = window.localStorage.getItem("stellcon.color") || me?.color || "";
                    if (name.length < 2) {
                      handleWatch(rematchInfo.gameId);
                      return;
                    }
                    handleJoin({ name, gameId: rematchInfo.gameId, color });
                  }}
                >
                  Join Rematch
                </button>
              </div>
            ) : null}
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

      {canJoinGame ? (
        <div className="join-prompt-overlay">
          <div className="join-prompt-card">
            <div className="join-prompt-title">Join Game</div>
            <div className="join-prompt-subtitle">
              {players.length} / {state.config.maxPlayers} players
            </div>
            {joinError ? <div className="join-prompt-error">{joinError}</div> : null}
            <label className="join-prompt-label">
              Commander Name
              <input
                type="text"
                className="join-prompt-input"
                value={joinName}
                onChange={(e) => {
                  setJoinName(e.target.value);
                  setJoinError("");
                }}
                placeholder="Enter your name"
                autoFocus
              />
              {!isJoinNameUnique && trimmedJoinName.length > 0 ? (
                <span className="join-prompt-name-error">Name already taken</span>
              ) : null}
            </label>
            <div className="join-prompt-label">
              Select Color
              <div className="join-prompt-colors">
                {availableColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`join-prompt-color ${joinColor === c ? "active" : ""}`}
                    style={{ "--swatch-color": c } as React.CSSProperties}
                    onClick={() => setJoinColor(c)}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
            <div className="join-prompt-actions">
              <button
                type="button"
                disabled={!isJoinNameValid || !isJoinNameUnique || !joinColor}
                onClick={() => {
                  if (!isJoinNameValid || !isJoinNameUnique || !joinColor || !gameId) return;
                  window.localStorage.setItem("stellcon.name", joinName);
                  window.localStorage.setItem("stellcon.color", joinColor);
                  joinGame({ name: trimmedJoinName, gameId, color: joinColor }, (response) => {
                    if (!response) {
                      setJoinError("No response from server.");
                      return;
                    }
                    if ("error" in response) {
                      setJoinError(response.error);
                      return;
                    }
                    setPlayerId(response.playerId);
                    setShowJoinPrompt(false);
                    setJoinError("");
                    resetOrders();
                    setSelectedId(null);
                    window.localStorage.setItem(
                      "stellcon.session",
                      JSON.stringify({ gameId: response.gameId, playerId: response.playerId })
                    );
                  });
                }}
              >
                Join Game
              </button>
              <button type="button" className="secondary" onClick={() => setShowJoinPrompt(false)}>
                Watch Only
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

                    if (pendingAllianceToIds[player.id]) {
                      return {
                        label: "Retract",
                        disabled: false,
                        title: "Retract alliance offer.",
                        onClick: () => handleRetractAlliance(player.id),
                      };
                    }

                    if (declinedAllianceByIds[player.id]) {
                      return {
                        label: "Declined",
                        disabled: true,
                        title: "Alliance declined (resets next turn).",
                        onClick: () => {},
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
            wormholes={plannedWormholes}
            wormholeDraftFromId={powerupDraft === "wormhole" ? wormholeFromId : null}
            powerupFx={powerupFx}
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
                          setWormholeFromId(null);
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

      <SoundControls
        musicMuted={musicMuted}
        sfxMuted={sfxMuted}
        onToggleMusic={() => setMusicMuted((current) => !current)}
        onToggleSfx={() => setSfxMuted((current) => !current)}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default App;
