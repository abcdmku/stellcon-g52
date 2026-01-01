import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { MAP_SIZES, POWERUPS, RESOURCE_TYPES, RESOLUTION_TRAVEL_MS } from "@stellcon/shared";
import { demoPlayerId, demoState } from "./demoState.js";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const HEX_SIZE = 56;
const HEX_SPACING = 1.08;

const resourceLabels = {
  fusion: "Fusion",
  terrain: "Terrain",
  metal: "Metal",
  crystal: "Crystal",
};

function axialToPixel(q, r, size) {
  // Flat-top hex layout to match the tile orientation used in CSS.
  const x = size * 1.5 * q * HEX_SPACING;
  const y = size * Math.sqrt(3) * (r + q / 2) * HEX_SPACING;
  return { x, y };
}

function axialDistanceCoords(a, b) {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  const ds = Math.abs((a.q + a.r) - (b.q + b.r));
  return Math.max(dq, dr, ds);
}

function emptyOrders() {
  return { placements: {}, moves: [], powerups: [], research: [] };
}

function hexToRgba(hexColor, alpha) {
  const value = (hexColor || "").trim();
  if (!value.startsWith("#")) return null;
  const hex = value.slice(1);
  if (hex.length !== 6) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function Lobby({ onCreate, onJoin, isBusy }) {
  const [name, setName] = useState("");
  const [gameId, setGameId] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [mapSize, setMapSize] = useState("medium");
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxTurns, setMaxTurns] = useState(20);
  const [turnSeconds, setTurnSeconds] = useState(90);

  return (
    <>
      <div className="lobby-title">StellCon Command Nexus</div>
      <p className="lobby-subtitle">
        Create a new sector or join a live operation. Players lock moves before battles resolve.
      </p>
      <div className="lobby-grid">
          <label>
            Commander Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Commander" />
          </label>
          <label>
            Game Code
            <input value={gameId} onChange={(event) => setGameId(event.target.value.toUpperCase())} />
          </label>
          <label>
            Players
            <input
              type="number"
              min="2"
              max="6"
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(Number(event.target.value))}
            />
          </label>
          <label>
            Map Size
            <select value={mapSize} onChange={(event) => setMapSize(event.target.value)}>
              {Object.entries(MAP_SIZES).map(([key, value]) => (
                <option key={key} value={key}>
                  {key} ({value.width}x{value.height})
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            Private Game
            <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
          </label>
          <label>
            Max Turns
            <input
              type="number"
              min="10"
              max="50"
              value={maxTurns}
              onChange={(event) => setMaxTurns(Number(event.target.value))}
            />
          </label>
          <label>
            Turn Seconds
            <input
              type="number"
              min="30"
              max="180"
              value={turnSeconds}
              onChange={(event) => setTurnSeconds(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="lobby-actions">
          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              onCreate({
                name,
                config: {
                  maxPlayers,
                  mapSize,
                  maxTurns,
                  turnSeconds,
                  isPrivate,
                },
              })
            }
          >
            Create Game
          </button>
          <button type="button" disabled={isBusy || !gameId} onClick={() => onJoin({ name, gameId })}>
            Join Game
          </button>
        </div>
    </>
  );
}

function GamesList({ games, onWatch, onJoin }) {
  if (!games?.length) {
    return <div className="muted">No public games right now. Create one!</div>;
  }

  return (
    <div className="games-list">
      {games.map((game) => (
        <div key={game.gameId} className="game-row">
          <div>
            <div className="game-code">{game.gameId}</div>
            <div className="muted">
              {game.players}/{game.maxPlayers} players - {game.mapSize} - turn {game.turn} ({game.phase})
            </div>
          </div>
          <div className="game-actions">
            <button type="button" onClick={() => onWatch(game.gameId)}>
              Watch
            </button>
            <button type="button" onClick={() => onJoin(game.gameId)} disabled={game.players >= game.maxPlayers}>
              Join
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerCard({ player, highlight }) {
  const fleets = player.fleetsToPlace ?? 0;
  const owned = player.systemCount ?? 0;

  return (
    <div className={`player-card ${highlight ? "active" : ""}`}>
      <div className="player-head">
        <span className="player-color" style={{ background: player.color }} />
        <div>
          <div className="player-name">{player.name}</div>
          <div className="player-meta">
            {owned} systems - {fleets} fleets
          </div>
        </div>
      </div>
      <div className="player-bars">
        {RESOURCE_TYPES.map((key) => (
          <div className="bar" key={key}>
            <span>{player.income?.[key] ?? 0}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, (player.income?.[key] ?? 0) * 6)}%`,
                  background: `var(--${key})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Board({
  systems,
  links,
  players,
  orders,
  revealedMoves,
  resolutionStartedAt,
  resolutionEndsAt,
  resolutionBattles,
  phase,
  viewerId,
  wormholeTurns,
  selectedId,
  moveOriginId,
  onSystemClick,
  onMoveAdjust,
  onMoveCancel,
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const neighborIds = useMemo(() => {
    if (!moveOriginId || !viewerId) return new Set();
    const systemMap = new Map(systems.map((system) => [system.id, system]));
    const origin = systemMap.get(moveOriginId);
    if (!origin || origin.ownerId !== viewerId) return new Set();

    const reachable = new Set();
    if (wormholeTurns > 0) {
      for (const system of systems) {
        if (system.ownerId === viewerId && system.id !== moveOriginId) reachable.add(system.id);
      }
    } else {
      const visited = new Set([moveOriginId]);
      const queue = [moveOriginId];
      while (queue.length) {
        const current = queue.shift();
        for (const nextId of links?.[current] || []) {
          if (visited.has(nextId)) continue;
          const next = systemMap.get(nextId);
          if (!next) continue;
          if (next.ownerId !== viewerId) continue;
          visited.add(nextId);
          if (nextId !== moveOriginId) reachable.add(nextId);
          queue.push(nextId);
        }
      }
    }

    for (const nextId of links?.[moveOriginId] || []) reachable.add(nextId);
    return reachable;
  }, [links, moveOriginId, systems, viewerId, wormholeTurns]);

  const positions = useMemo(() => {
    const entries = {};
    for (const system of systems) {
      entries[system.id] = axialToPixel(system.q, system.r, HEX_SIZE);
    }
    return entries;
  }, [systems]);

  const systemById = useMemo(() => {
    const entries = {};
    for (const system of systems) entries[system.id] = system;
    return entries;
  }, [systems]);

  const laneEdges = useMemo(() => {
    const lanes = [];
    const seen = new Set();
    for (const [fromId, neighbors] of Object.entries(links || {})) {
      for (const toId of neighbors) {
        const key = [fromId, toId].sort().join("-");
        if (seen.has(key)) continue;
        seen.add(key);
        const from = systemById[fromId];
        const to = systemById[toId];
        if (!from || !to) continue;
        if (axialDistanceCoords(from, to) <= 1) continue;
        lanes.push({ fromId, toId });
      }
    }
    return lanes;
  }, [links, systemById]);

  const moveLines = useMemo(() => {
    const source = revealedMoves && revealedMoves.length ? revealedMoves : orders?.moves || [];
    return source
      .map((move) => ({
        key: `${move.playerId || "me"}-${move.fromId}-${move.toId}-${move.count}`,
        playerId: move.playerId || null,
        count: Number(move.count) || 0,
        from: positions[move.fromId],
        to: positions[move.toId],
      }))
      .filter((entry) => entry.from && entry.to);
  }, [orders, positions, revealedMoves]);

  const movePaths = useMemo(() => {
    const groups = new Map();
    for (const entry of moveLines) {
      const fromKey = `${entry.playerId || "me"}:${entry.from.x},${entry.from.y}`;
      if (!groups.has(fromKey)) groups.set(fromKey, []);
      groups.get(fromKey).push(entry);
    }

    const result = [];
    for (const entries of groups.values()) {
      const sorted = entries
        .slice()
        .sort(
          (a, b) =>
            Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x) - Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x)
        );
      const n = sorted.length;
      for (let i = 0; i < n; i += 1) {
        const entry = sorted[i];
        const dx = entry.to.x - entry.from.x;
        const dy = entry.to.y - entry.from.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const lane = i - (n - 1) / 2;
        const laneOffset = lane * 14;
        const mx = entry.from.x + dx * 0.5;
        const my = entry.from.y + dy * 0.5;
        const cx = mx + nx * laneOffset * 1.2;
        const cy = my + ny * laneOffset * 1.2;
        const labelX = mx + nx * laneOffset * 1.9;
        const labelY = my + ny * laneOffset * 1.9;
        const d = `M ${entry.from.x} ${entry.from.y} Q ${cx} ${cy} ${entry.to.x} ${entry.to.y}`;
        result.push({ ...entry, d, labelX, labelY });
      }
    }

    return result;
  }, [moveLines]);

  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (!resolutionStartedAt || !resolutionEndsAt) return;
    let raf = 0;
    const tick = () => {
      setNowMs(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [resolutionStartedAt, resolutionEndsAt]);

  const particles = useMemo(() => {
    if (!resolutionStartedAt || !resolutionEndsAt) return [];
    if (!revealedMoves || revealedMoves.length === 0) return [];
    return revealedMoves
      .map((move, index) => {
        const from = positions[move.fromId];
        const to = positions[move.toId];
        if (!from || !to) return null;
        const color = players?.[move.playerId]?.color || "#ffffff";
        return { index, from, to, color };
      })
      .filter(Boolean);
  }, [players, positions, resolutionEndsAt, resolutionStartedAt, revealedMoves]);

  const outgoingByFromId = useMemo(() => {
    const map = new Map();
    for (const move of revealedMoves || []) {
      const fromId = move.fromId;
      const count = Number(move.count) || 0;
      if (!fromId || count <= 0) continue;
      map.set(fromId, (map.get(fromId) || 0) + count);
    }
    return map;
  }, [revealedMoves]);

  const [combatNow, setCombatNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== "resolving" || !resolutionStartedAt) return;
    let raf = 0;
    const tick = () => {
      setCombatNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, resolutionStartedAt]);

  const activeBattle = useMemo(() => {
    if (phase !== "resolving") return null;
    if (!resolutionStartedAt || !resolutionBattles?.length) return null;
    const elapsed = combatNow - resolutionStartedAt;
    return (
      resolutionBattles.find(
        (battle) => elapsed >= battle.startOffsetMs && elapsed < battle.startOffsetMs + battle.durationMs
      ) || null
    );
  }, [combatNow, phase, resolutionBattles, resolutionStartedAt]);

  const battleByTargetId = useMemo(() => {
    const map = new Map();
    for (const battle of resolutionBattles || []) {
      map.set(battle.targetId, battle);
    }
    return map;
  }, [resolutionBattles]);

  const activeBattleState = useMemo(() => {
    if (!activeBattle || !resolutionStartedAt) return null;
    const elapsed = combatNow - resolutionStartedAt - activeBattle.startOffsetMs;
    const skirmishRounds = activeBattle.attackerSkirmishRounds || [];
    const combatRounds = activeBattle.rounds || [];
    const skirmishMs = skirmishRounds.length * 1000;

    if (elapsed < skirmishMs && skirmishRounds.length) {
      const index = Math.min(skirmishRounds.length - 1, Math.floor(elapsed / 1000));
      const snapshot = skirmishRounds[index];
      const leader = snapshot.reduce((best, entry) => (!best || entry.fleets > best.fleets ? entry : best), null);
      return { mode: "skirmish", attackers: snapshot, attackerLeader: leader };
    }

    if (combatRounds.length) {
      const index = Math.min(combatRounds.length - 1, Math.floor((elapsed - skirmishMs) / 1000));
      const snapshot = combatRounds[index];
      return { mode: "combat", attacker: snapshot.attacker, defender: snapshot.defender };
    }

    return null;
  }, [activeBattle, combatNow, resolutionStartedAt]);

  const activeBattleFx = useMemo(() => {
    if (!activeBattle || !resolutionStartedAt) return null;
    const elapsed = combatNow - resolutionStartedAt - activeBattle.startOffsetMs;
    const tick = Math.max(0, Math.floor(elapsed / 1000));
    const victoryElapsed = elapsed - activeBattle.durationMs;
    return { elapsed, tick, victoryElapsed };
  }, [activeBattle, combatNow, resolutionStartedAt]);

  const handleWheel = (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.08 : 0.08;
    setScale((prev) => Math.min(1.6, Math.max(0.6, prev + delta)));
  };

  const handlePointerDown = (event) => {
    if (event.target.closest && event.target.closest(".hex")) return;
    dragging.current = true;
    lastPos.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event) => {
    if (!dragging.current) return;
    const dx = event.clientX - lastPos.current.x;
    const dy = event.clientY - lastPos.current.y;
    setOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    lastPos.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      className="board"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="board-canvas" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
        <svg className="board-links" viewBox="-1600 -1200 3200 2400">
          {laneEdges.map((edge) => {
            const from = positions[edge.fromId];
            const to = positions[edge.toId];
            if (!from || !to) return null;
            return (
              <line
                key={`lane-${edge.fromId}-${edge.toId}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="lane-line"
              />
            );
          })}
          {movePaths.map((path) => (
            <g key={path.key}>
              <path
                d={path.d}
                className={path.playerId ? "move-path-base revealed" : "move-path-base"}
                style={
                  path.playerId && players?.[path.playerId]?.color
                    ? { stroke: hexToRgba(players[path.playerId].color, 0.55) || players[path.playerId].color }
                    : undefined
                }
              />
              <path
                d={path.d}
                className={path.playerId ? "move-path-pulse revealed" : "move-path-pulse"}
                style={
                  path.playerId && players?.[path.playerId]?.color
                    ? { stroke: hexToRgba(players[path.playerId].color, 0.95) || players[path.playerId].color }
                    : undefined
                }
              />
              {phase === "planning" ? (
                <text x={path.labelX} y={path.labelY} className="move-count-text">
                  {path.count}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {resolutionStartedAt && resolutionEndsAt
          ? particles.map((particle) => {
              const travelMs = Math.max(900, RESOLUTION_TRAVEL_MS);
              const duration = Math.max(700, travelMs - 140);
              const delay = (particle.index % 4) * 30;
              const t = Math.max(0, Math.min(1, (nowMs - resolutionStartedAt - delay) / duration));
              if (t <= 0 || t >= 1) return null;
              const x = particle.from.x + (particle.to.x - particle.from.x) * t;
              const y = particle.from.y + (particle.to.y - particle.from.y) * t;
              return (
                <div
                  key={`p-${particle.index}`}
                  className="move-particle"
                  style={{ left: `${x}px`, top: `${y}px`, background: particle.color }}
                />
              );
            })
          : null}
        {systems.map((system) => {
          const position = positions[system.id];
          const battle = phase === "resolving" ? battleByTargetId.get(system.id) : null;
          const elapsed = resolutionStartedAt ? combatNow - resolutionStartedAt : 0;
          const battleElapsed = battle ? elapsed - battle.startOffsetMs : 0;
          const battleOngoing = battle ? battleElapsed >= 0 && battleElapsed < battle.durationMs : false;
          const battleDone = battle ? battleElapsed >= battle.durationMs : false;
          const battleSkirmishMs = battle ? (battle.attackerSkirmishRounds?.length || 0) * 1000 : 0;

          const displayedOwnerId = battleOngoing
            ? battle.defenderColorId
            : battleDone
              ? battle.winnerId
              : system.ownerId;
          const owner = displayedOwnerId ? players?.[displayedOwnerId] : null;
          const accent = owner?.color || "#8c9bbe";
          const accentGlow = hexToRgba(accent, 0.25) || "rgba(140, 155, 190, 0.2)";
          const placement = orders?.placements?.[system.id] || 0;

          let displayedFleets = system.fleets || 0;
          if (phase === "planning" && viewerId && system.ownerId === viewerId) {
            displayedFleets += placement;
          }

          if (battle) {
            if (battleOngoing) {
              if (battleElapsed >= battleSkirmishMs && battle.rounds?.length) {
                const index = Math.min(battle.rounds.length - 1, Math.floor((battleElapsed - battleSkirmishMs) / 1000));
                displayedFleets = battle.rounds[index]?.defender ?? battle.defenderStartFleets ?? displayedFleets;
              } else {
                displayedFleets = battle.defenderStartFleets ?? displayedFleets;
              }
            } else if (battleDone) {
              displayedFleets = battle.winnerFleets ?? displayedFleets;
            }
          } else if (phase === "resolving" && resolutionStartedAt) {
            const outgoing = outgoingByFromId.get(system.id) || 0;
            if (outgoing > 0) displayedFleets = Math.max(0, displayedFleets - outgoing);
          }
          const classes = ["hex", system.ownerId ? "owned" : "neutral"];
          const isNeighbor = neighborIds.has(system.id);
          const isOrigin = moveOriginId === system.id;
          if (selectedId === system.id) classes.push("selected");
          if (isNeighbor) classes.push("neighbor");
          if (isOrigin) classes.push("origin");
          if (battleOngoing) classes.push("combat");
          return (
            <div
              key={system.id}
              className={classes.join(" ")}
              style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                "--accent-color": accent,
                "--accent-glow": accentGlow,
                "--core-color": owner?.color || "#2b344a",
              }}
              onClick={() => onSystemClick(system)}
              onMouseDown={(event) => {
                if (event.target.closest && event.target.closest(".hex-value")) {
                  event.stopPropagation();
                }
              }}
              role="button"
            >
              <div className="hex-border" />
              <div className="hex-core" />
              <div className="hex-value">{displayedFleets}</div>
              <div className={`hex-tier tier-${system.tier ?? 0}`}>
                <span />
                <span />
              </div>
              {placement > 0 ? <div className="hex-placement">+{placement}</div> : null}
              {system.defenseNetTurns > 0 ? <div className="hex-shield">DN</div> : null}
            </div>
          );
        })}
        {false && phase === "planning"
          ? orders.moves.map((move, index) => {
              const from = positions[move.fromId];
              const to = positions[move.toId];
              if (!from || !to) return null;
              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const px = -uy;
              const py = ux;
              const mx = from.x + dx * 0.5;
              const my = from.y + dy * 0.5;
              const spread = 26;
              const lift = 18;
              const x1 = mx - ux * spread;
              const y1 = my - uy * spread;
              const x2 = mx + px * spread;
              const y2 = my + py * spread;
              const x3 = mx + ux * spread;
              const y3 = my + uy * spread;
              const lx = mx - px * lift;
              const ly = my - py * lift;
              return (
                <div key={`movectl-${index}`} className="move-controls">
                  <div className="move-count" style={{ left: `${lx}px`, top: `${ly}px` }}>
                    {move.count}
                  </div>
                  <button
                    type="button"
                    className="move-btn"
                    style={{ left: `${x1}px`, top: `${y1}px` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveAdjust(index, -1);
                    }}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="move-btn cancel"
                    style={{ left: `${x2}px`, top: `${y2}px` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveCancel(index);
                    }}
                  >
                    ×
                  </button>
                  <button
                    type="button"
                    className="move-btn"
                    style={{ left: `${x3}px`, top: `${y3}px` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMoveAdjust(index, 1);
                    }}
                  >
                    +
                  </button>
                </div>
              );
            })
          : null}
        {phase === "resolving" && activeBattle && activeBattleState ? (
          <div
            className="combat-overlay"
            style={{ left: `${positions[activeBattle.targetId]?.x || 0}px`, top: `${positions[activeBattle.targetId]?.y || 0}px` }}
          >
            <div className="combat-fx" aria-hidden="true">
              <div key={`burst-${activeBattle.targetId}-${activeBattleFx?.tick || 0}`} className="combat-burst" />
              <div key={`sparks-${activeBattle.targetId}-${activeBattleFx?.tick || 0}`} className="combat-sparks">
                {Array.from({ length: 14 }).map((_, index) => (
                  <span
                    key={`spark-${index}`}
                    className="combat-spark"
                    style={{
                      "--spark-angle": `${(index * 360) / 14}deg`,
                      "--spark-travel": `${52 + (index % 4) * 10}px`,
                      "--spark-delay": `${(index % 5) * 0.02}s`,
                    }}
                  />
                ))}
              </div>
              {activeBattleFx && activeBattleFx.victoryElapsed >= 0 && activeBattleFx.victoryElapsed < 1200 ? (
                <div className="combat-victory">★</div>
              ) : null}
            </div>
            <div className="combat-ring" />
            <div className="combat-hud">
              {activeBattleState.mode === "combat" ? (
                <>
                  <div>ATK {activeBattleState.attacker}</div>
                  <div>DEF {activeBattleState.defender}</div>
                </>
              ) : (
                <>
                  <div>Skirmish</div>
                  <div className="combat-skim">
                    {(activeBattleState.attackers || [])
                      .slice()
                      .sort((a, b) => b.fleets - a.fleets)
                      .slice(0, 3)
                      .map((entry) => (
                        <span key={entry.playerId || "neutral"} className="combat-chip">
                          <span
                            className="combat-dot"
                            style={{ background: players?.[entry.playerId]?.color || "rgba(255,255,255,0.5)" }}
                          />
                          {entry.fleets}
                        </span>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function App() {
  const [socket, setSocket] = useState(null);
  const [state, setState] = useState(DEMO_MODE ? demoState : null);
  const [playerId, setPlayerId] = useState(DEMO_MODE ? demoPlayerId : null);
  const [gameId, setGameId] = useState(DEMO_MODE ? demoState.id : null);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState(
    DEMO_MODE ? demoState.players[demoPlayerId].orders : emptyOrders()
  );
  const [selectedId, setSelectedId] = useState(null);
  const [moveOriginId, setMoveOriginId] = useState(null);
  const [powerupDraft, setPowerupDraft] = useState("");
  const [timer, setTimer] = useState(0);
  const [availableGames, setAvailableGames] = useState([]);
  const lastSeenTurnRef = useRef({ turn: null, phase: null });

  const me = playerId && state?.players ? state.players[playerId] : null;
  const systems = state?.systems || [];
  const links = state?.links || {};
  const selected = systems.find((system) => system.id === selectedId) || systems[0];
  const totalPlaced = Object.values(orders.placements || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const fleetsRemaining = Math.max(0, (me?.fleetsToPlace || 0) - totalPlaced);
  const originSystem = systems.find((system) => system.id === moveOriginId);
  const queuedFromOrigin = orders.moves.reduce(
    (sum, move) => (move.fromId === moveOriginId ? sum + Number(move.count || 0) : sum),
    0
  );
  const originPlacement = moveOriginId ? Number(orders.placements?.[moveOriginId] || 0) : 0;
  const originTotalFleets = (originSystem?.fleets || 0) + (originSystem?.ownerId === playerId ? originPlacement : 0);
  const originAvailable = Math.max(0, originTotalFleets - queuedFromOrigin);

  useEffect(() => {
    if (DEMO_MODE) return;
    const nextSocket = io(SERVER_URL, { transports: ["websocket"] });
    setSocket(nextSocket);
    return () => nextSocket.disconnect();
  }, []);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    if (gameId || playerId) return;
    const fromUrl = new URLSearchParams(window.location.search).get("game");
    if (fromUrl) {
      socket.emit("watchGame", { gameId: fromUrl }, (response) => {
        if (response?.error) setError(response.error);
      });
      setGameId(fromUrl);
      return;
    }
    const stored = window.localStorage.getItem("stellcon.session");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (!parsed?.gameId || !parsed?.playerId) return;
      socket.emit("rejoinGame", { gameId: parsed.gameId, playerId: parsed.playerId }, (response) => {
        if (response?.error) {
          window.localStorage.removeItem("stellcon.session");
          return;
        }
        setGameId(response.gameId);
        setPlayerId(response.playerId);
        setOrders(emptyOrders());
      });
    } catch {
      window.localStorage.removeItem("stellcon.session");
    }
  }, [socket, gameId, playerId]);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    socket.on("gameState", (gameState) => {
      setState(gameState);
      if (playerId && gameState?.turn != null) {
        const last = lastSeenTurnRef.current;
        const phaseChanged = last.phase !== gameState.phase;
        const turnChanged = last.turn !== gameState.turn;

        if ((turnChanged || phaseChanged) && gameState.phase === "planning") {
          const serverOrders = gameState.players?.[playerId]?.orders;
          setOrders(serverOrders || emptyOrders());
          setMoveOriginId(null);
        }

        lastSeenTurnRef.current = { turn: gameState.turn, phase: gameState.phase };
      }
      if (!selectedId && gameState?.systems?.length) {
        setSelectedId(gameState.systems[0].id);
      }
    });
    socket.on("gamesList", (games) => {
      setAvailableGames(games || []);
    });
    socket.on("allianceRequest", ({ fromId }) => {
      setError(`Alliance request from ${fromId}. Check diplomacy panel.`);
    });
    return () => {
      socket.off("gameState");
      socket.off("gamesList");
      socket.off("allianceRequest");
    };
  }, [socket, playerId, selectedId]);

  useEffect(() => {
    if (!socket || DEMO_MODE) return;
    if (gameId) return;
    socket.emit("listGames", null, (response) => {
      setAvailableGames(response?.games || []);
    });
  }, [socket, gameId]);

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
      socket.emit("updateOrders", { orders });
    }, 150);
    return () => clearTimeout(timeout);
  }, [orders, socket, playerId]);

  useEffect(() => {
    if (!moveOriginId) return;
    const origin = systems.find((system) => system.id === moveOriginId);
    if (!origin || origin.ownerId !== playerId) {
      setMoveOriginId(null);
    }
  }, [moveOriginId, playerId, systems]);

  const handleCreate = ({ name, config }) => {
    if (!socket) return;
    setError("");
    socket.emit("createGame", { name, config }, (response) => {
      if (response?.error) {
        setError(response.error);
        return;
      }
      setPlayerId(response.playerId);
      setGameId(response.gameId);
      setOrders(emptyOrders());
      window.localStorage.setItem(
        "stellcon.session",
        JSON.stringify({ gameId: response.gameId, playerId: response.playerId })
      );
      const params = new URLSearchParams(window.location.search);
      params.set("game", response.gameId);
      window.history.replaceState(null, "", `?${params.toString()}`);
    });
  };

  const handleJoin = ({ name, gameId: target }) => {
    if (!socket) return;
    setError("");
    socket.emit("joinGame", { name, gameId: target }, (response) => {
      if (response?.error) {
        setError(response.error);
        return;
      }
      setPlayerId(response.playerId);
      setGameId(response.gameId);
      setOrders(emptyOrders());
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
    socket.emit("watchGame", { gameId: target }, (response) => {
      if (response?.error) {
        setError(response.error);
        return;
      }
      setPlayerId(null);
      setGameId(target);
      setOrders(emptyOrders());
      const params = new URLSearchParams(window.location.search);
      params.set("game", target);
      window.history.replaceState(null, "", `?${params.toString()}`);
    });
  };

  const handlePlacement = (systemId, delta) => {
    setOrders((current) => {
      const next = { ...current, placements: { ...current.placements } };
      const currentValue = Number(next.placements[systemId] || 0);
      const updated = clamp(currentValue + delta, 0, currentValue + fleetsRemaining);
      if (updated === 0) {
        delete next.placements[systemId];
      } else {
        next.placements[systemId] = updated;
      }
      return next;
    });
  };

  const handleSystemClick = (system) => {
    setSelectedId(system.id);
    if (!system) return;

    const canMoveWithinOwned = (fromId, toId) => {
      if (!fromId || !toId) return false;
      if (fromId === toId) return true;
      const systemMap = new Map(systems.map((entry) => [entry.id, entry]));
      const origin = systemMap.get(fromId);
      if (!origin || origin.ownerId !== playerId) return false;
      const visited = new Set([fromId]);
      const queue = [fromId];
      while (queue.length) {
        const current = queue.shift();
        for (const nextId of links?.[current] || []) {
          if (visited.has(nextId)) continue;
          const next = systemMap.get(nextId);
          if (!next) continue;
          if (next.ownerId !== playerId) continue;
          if (nextId === toId) return true;
          visited.add(nextId);
          queue.push(nextId);
        }
      }
      return false;
    };

    const isOriginClick = system.ownerId === playerId && (!moveOriginId || moveOriginId === system.id);
    if (isOriginClick) {
      setMoveOriginId(system.id);
      return;
    }

    if (!moveOriginId || moveOriginId === system.id) return;

    const wormholeActive = (me?.wormholeTurns || 0) > 0;
    const isFriendlyTransfer = system.ownerId === playerId;
    const isNeighbor = links?.[moveOriginId]?.includes(system.id);
    const canReach = isFriendlyTransfer ? wormholeActive || canMoveWithinOwned(moveOriginId, system.id) : wormholeActive || isNeighbor;
    if (!canReach) return;

    setOrders((current) => {
      const moves = [...current.moves];
      const origin = systems.find((entry) => entry.id === moveOriginId);
      if (!origin || origin.ownerId !== playerId) return current;

      const placement = Number(current.placements?.[moveOriginId] || 0);
      const originFleets = (origin.fleets || 0) + placement;
      const queued = moves.reduce((sum, move) => (move.fromId === moveOriginId ? sum + Number(move.count || 0) : sum), 0);
      const existingIndex = moves.findIndex((move) => move.fromId === moveOriginId && move.toId === system.id);
      const available = Math.max(0, originFleets - queued);

      if (existingIndex !== -1) {
        if (available <= 0) return current;
        const existing = moves[existingIndex];
        moves[existingIndex] = { ...existing, count: Number(existing.count || 0) + 1 };
        return { ...current, moves };
      }

      if (available <= 0) return current;
      const initial = Math.max(1, Math.floor(available / 2));
      moves.push({ fromId: moveOriginId, toId: system.id, count: initial });
      return { ...current, moves };
    });
  };

  const handleClearOrigin = () => {
    setMoveOriginId(null);
  };

  const handleRemoveMove = (index) => {
    setOrders((current) => ({
      ...current,
      moves: current.moves.filter((_, idx) => idx !== index),
    }));
  };

  const handleAdjustMove = (index, delta) => {
    setOrders((current) => {
      const moves = [...current.moves];
      const move = moves[index];
      if (!move) return current;
      const origin = systems.find((entry) => entry.id === move.fromId);
      if (!origin || origin.ownerId !== playerId) return current;
      const placement = Number(current.placements?.[move.fromId] || 0);
      const originFleets = (origin.fleets || 0) + placement;
      const queued = moves.reduce((sum, entry, idx) => {
        if (entry.fromId !== move.fromId) return sum;
        if (idx === index) return sum;
        return sum + Number(entry.count || 0);
      }, 0);
      const maxForThis = Math.max(0, originFleets - queued);
      const next = clamp(Number(move.count || 0) + delta, 0, maxForThis);
      if (next <= 0) {
        moves.splice(index, 1);
        return { ...current, moves };
      }
      moves[index] = { ...move, count: next };
      return { ...current, moves };
    });
  };

  const handleQueuePowerup = () => {
    if (!powerupDraft || !selected?.id) return;
    if (!me?.powerups?.[powerupDraft]?.unlocked) return;
    if ((me?.powerups?.[powerupDraft]?.charges || 0) <= 0) return;
    setOrders((current) => ({
      ...current,
      powerups: [...current.powerups, { type: powerupDraft, targetId: selected.id }],
    }));
    setPowerupDraft("");
  };

  const handleUnlockPowerup = (key) => {
    setOrders((current) => ({
      ...current,
      research: [...(current.research || []), { type: "unlock", powerupKey: key }],
    }));
  };

  const handleCraftPowerup = (key) => {
    setOrders((current) => ({
      ...current,
      research: [...(current.research || []), { type: "craft", powerupKey: key }],
    }));
  };

  const handleLockIn = () => {
    socket?.emit("lockIn", null, (response) => {
      if (response?.error) setError(response.error);
    });
  };

  const handleAlliance = (targetId) => {
    socket?.emit("requestAlliance", { targetId });
  };

  const handleAcceptAlliance = (targetId) => {
    socket?.emit("acceptAlliance", { fromId: targetId });
  };

  const handleLeaveGame = () => {
    window.localStorage.removeItem("stellcon.session");
    const params = new URLSearchParams(window.location.search);
    params.delete("game");
    window.history.replaceState(null, "", params.toString() ? `?${params.toString()}` : window.location.pathname);
    setGameId(null);
    setPlayerId(null);
    setState(null);
    setOrders(emptyOrders());
    setSelectedId(null);
    setMoveOriginId(null);
    setError("");
  };

  if (!gameId) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <Lobby onCreate={handleCreate} onJoin={handleJoin} isBusy={!socket} />
          <div className="panel-subtitle">Public Games</div>
          <GamesList
            games={availableGames}
            onWatch={(target) => handleWatch(target)}
            onJoin={(target) => handleJoin({ name: "", gameId: target })}
          />
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className="loading">Awaiting sector sync...</div>;
  }

  const players = Object.values(state.players || {}).map((player) => ({
    ...player,
    systemCount: systems.filter((system) => system.ownerId === player.id).length,
  }));
  const rankedPlayers = [...players].sort((a, b) => b.systemCount - a.systemCount);
  const isComplete = state.phase === "complete";

  return (
    <div className="app">
      <header className="top-bar">
        <div>
          <div className="title">StellCon</div>
          <div className="subtitle">Simultaneous turns - Hidden orders - Combat after lock</div>
        </div>
        <div className="top-actions">
          <div className="turn-info">
            Turn {state.turn} of {state.config.maxTurns} - {state.phase}
          </div>
          <div className="timer">{state.phase === "planning" ? `${timer}s` : "Resolving..."}</div>
          <button type="button" onClick={handleLockIn} disabled={state.phase !== "planning" || me?.locked}>
            {me?.locked ? "Locked" : "Lock In"}
          </button>
          <button type="button" onClick={handleLeaveGame} className="secondary">
            Leave
          </button>
        </div>
      </header>

      {isComplete ? (
        <div className="endgame">
          <div className="endgame-card">
            <div className="panel-title">Final Rankings</div>
            <div className="endgame-list">
              {rankedPlayers.map((player, index) => (
                <div key={player.id} className="endgame-row">
                  <span>
                    {index + 1}. {player.name}
                  </span>
                  <span>{player.systemCount} systems</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="alert">{error}</div> : null}

      <main className="hud">
        <aside className="panel left">
          <div className="panel-title">Commanders</div>
          <div className="game-code">Game Code: {gameId}</div>
          <div className="player-list">
            {players.map((player) => (
              <PlayerCard key={player.id} player={player} highlight={player.id === playerId} />
            ))}
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
            selectedId={selectedId}
            moveOriginId={moveOriginId}
            onSystemClick={handleSystemClick}
            onMoveAdjust={handleAdjustMove}
            onMoveCancel={handleRemoveMove}
          />
        </section>

        <aside className="panel right">
          <div className="panel-title">System Focus</div>
          {selected ? (
            <div className="system-card">
              <div>
                <div className="system-name">{selected.id}</div>
                <div className="system-owner">
                  Owner: {selected.ownerId ? state.players[selected.ownerId]?.name : "Unclaimed"}
                </div>
                <div className="system-powerups">
                  {selected.defenseNetTurns > 0 ? <span>Defense Net</span> : null}
                  {selected.terraformed ? <span>Terraform</span> : null}
                </div>
              </div>
              <div className="system-fleets">{selected.fleets}</div>
            </div>
          ) : null}
          {selected ? (
            <div className="resource-stack">
              {RESOURCE_TYPES.map((key) => (
                <div className="resource-row" key={key}>
                  <span>{resourceLabels[key]}</span>
                  <strong>{selected.resources?.[key] ?? 0}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="panel-subtitle">Placement</div>
          <div className="placement-row">
            <div>Fleets remaining</div>
            <strong>{fleetsRemaining}</strong>
          </div>
          {selected && selected.ownerId === playerId ? (
            <div className="placement-controls">
              <button type="button" onClick={() => handlePlacement(selected.id, 1)} disabled={fleetsRemaining <= 0}>
                +1
              </button>
              <button type="button" onClick={() => handlePlacement(selected.id, -1)}>
                -1
              </button>
            </div>
          ) : (
            <div className="muted">Select a friendly system to place fleets.</div>
          )}

          <div className="panel-subtitle">Movement Orders</div>
          <div className="move-form">
            <div className="muted">
              Click a friendly system, then click a glowing neighbor.
              First click sends half (rounded down, min 1). Re-click adds +1.
              Edit queued moves in the list below.
            </div>
            <div className="move-origin">
              <div>Origin</div>
              <div className="move-origin-row">
                <span>{moveOriginId ? moveOriginId : "Select a friendly system"}</span>
                {moveOriginId ? (
                  <button type="button" onClick={handleClearOrigin}>
                    Clear
                  </button>
                ) : null}
              </div>
              {originSystem ? (
                <div className="muted">
                  Available: {originAvailable} (queued {queuedFromOrigin})
                </div>
              ) : null}
            </div>
          </div>
          <div className="order-list">
            {orders.moves.map((move, index) => (
              <div className="order-item" key={`${move.fromId}-${move.toId}-${index}`}>
                <span>
                  {move.fromId} to {move.toId} - {move.count}
                </span>
                <div className="order-controls">
                  <button type="button" onClick={() => handleAdjustMove(index, -1)}>
                    -
                  </button>
                  <button type="button" onClick={() => handleAdjustMove(index, 1)}>
                    +
                  </button>
                  <button type="button" onClick={() => handleRemoveMove(index)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="panel-subtitle">Powerups</div>
          <div className="powerup-grid">
            {Object.values(POWERUPS).map((powerup) => {
              const status = me?.powerups?.[powerup.key] || { unlocked: false, charges: 0 };
              const canUse = status.unlocked && status.charges > 0;
              const canUnlock = !status.unlocked && (me?.research?.[powerup.resource] || 0) >= powerup.unlockCost;
              const canCraft = status.unlocked && (me?.research?.[powerup.resource] || 0) >= powerup.cost;
              return (
                <div key={powerup.key} className={`powerup-row ${status.unlocked ? "" : "locked"}`}>
                  <button
                    type="button"
                    className={powerupDraft === powerup.key ? "active" : ""}
                    disabled={!canUse || state.phase !== "planning"}
                    onClick={() => setPowerupDraft(powerup.key)}
                    title={
                      status.unlocked
                        ? `Charges: ${status.charges}`
                        : `Unlock for ${powerup.unlockCost} ${resourceLabels[powerup.resource]}`
                    }
                  >
                    <span>{powerup.label}</span>
                    <span className="cost">
                      {status.unlocked ? `${status.charges} charges` : "Locked"}
                    </span>
                  </button>
                  <div className="powerup-actions">
                    {!status.unlocked ? (
                      <button
                        type="button"
                        disabled={!canUnlock || state.phase !== "planning"}
                        onClick={() => handleUnlockPowerup(powerup.key)}
                      >
                        Unlock
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!canCraft || state.phase !== "planning"}
                        onClick={() => handleCraftPowerup(powerup.key)}
                      >
                        Craft
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" className="queue" onClick={handleQueuePowerup}>
            Queue Powerup on Selected
          </button>

          <div className="panel-subtitle">Diplomacy</div>
          <div className="diplomacy">
            {players
              .filter((player) => player.id !== playerId)
              .map((player) => (
                <div className="diplomacy-row" key={player.id}>
                  <span>{player.name}</span>
                  <div>
                    <button type="button" onClick={() => handleAlliance(player.id)}>
                      Request
                    </button>
                    <button type="button" onClick={() => handleAcceptAlliance(player.id)}>
                      Accept
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </aside>
      </main>

      <footer className="bottom-bar">
        <div className="research">
          <div>Research Stores</div>
          <div className="research-grid">
            {RESOURCE_TYPES.map((key) => (
              <div key={key} className="research-row">
                <span>{resourceLabels[key]}</span>
                <strong>{me?.research?.[key] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="status">
          <div>Hidden orders remain until combat phase.</div>
          <div>Wormhole turns: {me?.wormholeTurns ?? 0}</div>
        </div>
      </footer>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default App;
