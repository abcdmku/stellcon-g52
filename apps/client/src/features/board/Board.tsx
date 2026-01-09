import type { CSSProperties, MouseEvent } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clamp, RESOLUTION_TRAVEL_MS, RESOURCE_COLORS, RESOURCE_TYPES } from "@stellcon/shared";
import type { GameState, Orders, PowerupKey, SystemState, WormholeLink } from "@stellcon/shared";
import { PowerupIcon } from "../../shared/components/PowerupIcon";
import { hexToRgba } from "../../shared/lib/color";
import { axialDistanceCoords, axialToPixel, trimLineToHexEdges } from "../../shared/lib/hex";
import StellarBombExplosion from "./StellarBombExplosion";

const HEX_SIZE = 56;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const FIT_MAX_SCALE = 1.15;
const MOVE_LINE_START_PAD = 2;
const MOVE_LINE_END_PAD = 18;
const MOVE_LINE_START_TOWARD_EDGE = 0.5;
const MOVE_BADGE_SCALE = 0.78;
const MOVE_BADGE_POINTS = "-16,-11 16,0 -16,11 -10,0";
const MOVE_VERTICAL_RATIO = 0.35;
const RESOURCE_MAX = 5;
const DRAG_THRESHOLD_PX = 10;

type Rgb = { r: number; g: number; b: number };

function hexToRgb(hexColor: string): Rgb | null {
  const value = (hexColor || "").trim();
  if (!value.startsWith("#")) return null;
  const hex = value.slice(1);
  if (hex.length !== 6) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp(t, 0, 1);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

function rgbToHsl(rgb: Rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;

  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }

  h *= 60;
  if (h < 0) h += 360;

  return { h, s: s * 100, l: l * 100 };
}

function hslCss(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function deriveCoreGradient(rgb: Rgb) {
  const { h, s, l } = rgbToHsl(rgb);
  // Keep ownership readable without looking neon; highlights should do the "pop".
  const sat = clamp(s * 0.9, 30, 68);
  const topL = clamp(l * 0.48, 14, 32);
  const bottomL = Math.max(7, Math.min(clamp(l * 0.25, 7, 20), topL - 10));
  return {
    top: hslCss(h, sat, topL),
    bottom: hslCss(h, sat * 0.92, bottomL),
  };
}

function computeMoveCurveControlPoint(dx: number, len: number, mx: number, my: number, arch: number) {
  if (len <= 0.001) return { cx: mx, cy: my };
  const verticalish = Math.abs(dx) / len < MOVE_VERTICAL_RATIO;
  if (verticalish) return { cx: mx, cy: my };
  return { cx: mx, cy: my - arch };
}
const resourceLabels = {
  fusion: "Fusion",
  terrain: "Terrain",
  metal: "Metal",
  crystal: "Crystal",
};

const resourceAngles = {
  fusion: -52.5,
  terrain: -17.5,
  metal: 17.5,
  crystal: 52.5,
} as const;

type BoardProps = {
  systems: GameState["systems"];
  links: GameState["links"];
  players: GameState["players"];
  orders: Orders;
  revealedMoves?: GameState["revealedMoves"];
  resolutionStartedAt?: GameState["resolutionStartedAt"];
  resolutionEndsAt?: GameState["resolutionEndsAt"];
  resolutionBattles?: GameState["resolutionBattles"];
  phase: GameState["phase"];
  viewerId: string | null;
  wormholes: WormholeLink[];
  wormholeDraftFromId: string | null;
  powerupFx: Array<{ type: Exclude<PowerupKey, "wormhole">; targetId: string; startedAt: number }>;
  powerupDraft: PowerupKey | "";
  powerupTargetIds: Set<string>;
  powerupHighlightColor: string;
  placementMode: boolean;
  fleetsRemaining: number;
  selectedId: string | null;
  moveOriginId: string | null;
  onSystemClick: (system: SystemState, event: MouseEvent) => void;
  onBackgroundClick?: () => void;
  onMoveAdjust: (index: number, delta: number) => void;
  onMoveCancel: (index: number) => void;
};

const Board = memo(function Board({
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
  wormholes,
  wormholeDraftFromId,
  powerupFx,
  powerupDraft,
  powerupTargetIds,
  powerupHighlightColor,
  placementMode,
  fleetsRemaining,
  selectedId,
  moveOriginId,
  onSystemClick,
  onBackgroundClick,
  onMoveAdjust,
  onMoveCancel,
}: BoardProps) {
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);
  const rgbCacheRef = useRef(new Map<string, Rgb | null>());
  const getRgb = useCallback((hex: string) => {
    const cache = rgbCacheRef.current;
    const cached = cache.get(hex);
    if (cached !== undefined) return cached;
    const parsed = hexToRgb(hex);
    cache.set(hex, parsed);
    return parsed;
  }, []);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const boardRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraTouched = useRef(false);
  const cameraFitKey = useRef(null);
  const dragging = useRef(false);
  const pointerDown = useRef(false);
  const pointerCaptured = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const didDrag = useRef(false);
  const suppressNextClick = useRef(false);
  const offsetRef = useRef(offset);
  const scaleRef = useRef(scale);
  const panRaf = useRef(0);
  const pointerIdRef = useRef(null);
  const redrawTimeoutRef = useRef<number | null>(null);
  const rasterBustRef = useRef(false);
  const hoverRafRef = useRef<number>(0);
  const pendingHoverRef = useRef<{ x: number; y: number } | null>(null);

  const bustHexRasterization = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rasterBustRef.current = !rasterBustRef.current;
    canvas.style.setProperty("--hex-raster-z", rasterBustRef.current ? "0.01px" : "0px");
  }, []);

  const applyCanvasTransform = useCallback((forceRedraw = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const currentScale = scaleRef.current || 1;
    const currentOffset = offsetRef.current || { x: 0, y: 0 };
    if (forceRedraw) {
      canvas.style.transform = "none";
      canvas.getBoundingClientRect();
    }
    canvas.style.transform = `translate(${currentOffset.x}px, ${currentOffset.y}px) scale(${currentScale})`;
  }, []);

  useLayoutEffect(() => {
    offsetRef.current = offset;
    applyCanvasTransform();
  }, [applyCanvasTransform, offset]);

  useLayoutEffect(() => {
    scaleRef.current = scale;
    applyCanvasTransform();
    bustHexRasterization();
  }, [applyCanvasTransform, bustHexRasterization, scale]);

  useEffect(() => {
    return () => {
      if (redrawTimeoutRef.current) {
        window.clearTimeout(redrawTimeoutRef.current);
        redrawTimeoutRef.current = null;
      }
      if (panRaf.current) {
        cancelAnimationFrame(panRaf.current);
        panRaf.current = 0;
      }
      if (hoverRafRef.current) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = 0;
      }
    };
  }, []);
  const mapBoundsKey = useMemo(() => {
    if (!systems?.length) return "empty";
    let minQ = Number.POSITIVE_INFINITY;
    let maxQ = Number.NEGATIVE_INFINITY;
    let minR = Number.POSITIVE_INFINITY;
    let maxR = Number.NEGATIVE_INFINITY;
    for (const system of systems) {
      minQ = Math.min(minQ, system.q);
      maxQ = Math.max(maxQ, system.q);
      minR = Math.min(minR, system.r);
      maxR = Math.max(maxR, system.r);
    }
    return `${systems.length}:${minQ},${maxQ}:${minR},${maxR}`;
  }, [systems]);
  const neighborIds = useMemo(() => {
    if (!moveOriginId || !viewerId) return new Set();
    const systemMap = new Map(systems.map((system) => [system.id, system]));
    const origin = systemMap.get(moveOriginId);
    if (!origin || origin.ownerId !== viewerId) return new Set();

    const reachable = new Set();
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

    for (const nextId of links?.[moveOriginId] || []) reachable.add(nextId);
    for (const wormhole of wormholes || []) {
      if ((wormhole.turnsRemaining || 0) <= 0) continue;
      if (wormhole.fromId === moveOriginId) reachable.add(wormhole.toId);
      if (wormhole.toId === moveOriginId) reachable.add(wormhole.fromId);
    }
    return reachable;
  }, [links, moveOriginId, systems, viewerId, wormholes]);

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

  const queuedPowerupsBySystemId = useMemo(() => {
    const map = new Map<string, PowerupKey[]>();
    for (const action of orders?.powerups || []) {
      if (!action) continue;
      if (action.type === "wormhole") {
        map.set(action.fromId, [...(map.get(action.fromId) || []), "wormhole"]);
        map.set(action.toId, [...(map.get(action.toId) || []), "wormhole"]);
        continue;
      }
      if ("targetId" in action) {
        map.set(action.targetId, [...(map.get(action.targetId) || []), action.type]);
      }
    }
    if (powerupDraft === "wormhole" && wormholeDraftFromId) {
      map.set(wormholeDraftFromId, [...(map.get(wormholeDraftFromId) || []), "wormhole"]);
    }
    for (const [systemId, badges] of map.entries()) {
      map.set(systemId, [...new Set(badges)]);
    }
    return map;
  }, [orders?.powerups, powerupDraft, wormholeDraftFromId]);

  const wormholeEdges = useMemo(() => {
    const bestByKey = new Map<string, WormholeLink>();
    for (const wormhole of wormholes || []) {
      if (!wormhole?.fromId || !wormhole?.toId) continue;
      const a = wormhole.fromId < wormhole.toId ? wormhole.fromId : wormhole.toId;
      const b = wormhole.fromId < wormhole.toId ? wormhole.toId : wormhole.fromId;
      const key = `${a}|${b}`;
      const existing = bestByKey.get(key);
      if (!existing || (wormhole.turnsRemaining || 0) > (existing.turnsRemaining || 0)) {
        bestByKey.set(key, wormhole);
      }
    }
    return [...bestByKey.values()];
  }, [wormholes]);

  const powerupFxBySystemId = useMemo(() => {
    const map = new Map<string, Array<{ type: Exclude<PowerupKey, "wormhole">; startedAt: number }>>();
    for (const fx of powerupFx || []) {
      if (!fx?.targetId) continue;
      map.set(fx.targetId, [...(map.get(fx.targetId) || []), { type: fx.type, startedAt: fx.startedAt }]);
    }
    return map;
  }, [powerupFx]);

  const stellarBombFx = useMemo(() => (powerupFx || []).filter((entry) => entry.type === "stellarBomb"), [powerupFx]);

  const systemsForBounds = useMemo(() => systems, [mapBoundsKey]);
  const mapPixelBounds = useMemo(() => {
    if (!systemsForBounds?.length) return null;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const system of systemsForBounds) {
      const { x, y } = axialToPixel(system.q, system.r, HEX_SIZE);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    return { minX, maxX, minY, maxY };
  }, [systemsForBounds]);

  const fitCameraToMap = useCallback(() => {
    const boardEl = boardRef.current;
    if (!boardEl || !mapPixelBounds) return;

    const isNewMap = cameraFitKey.current !== mapBoundsKey;
    if (!isNewMap && cameraTouched.current) return;

    const rect = boardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const { minX, maxX, minY, maxY } = mapPixelBounds;

    const padX = HEX_SIZE;
    const padY = (HEX_SIZE * Math.sqrt(3)) / 2;
    const contentWidth = Math.max(1, maxX - minX + padX * 2);
    const contentHeight = Math.max(1, maxY - minY + padY * 2);

    const margin = 40;
    const rootStyles = getComputedStyle(document.documentElement);
    const overlayGap = Number.parseFloat(rootStyles.getPropertyValue("--board-safe-gap")) || 16;
    let safeLeft = margin;
    let safeTop = margin;
    let safeRight = rect.width - margin;
    let safeBottom = rect.height - margin;

    const leftHud = document.querySelector(".overlay-section.left");
    const rightHud = document.querySelector(".overlay-section.right");
    const topHud = document.querySelector(".overlay-top");
    const bottomHud = document.querySelector(".overlay-bottom");

    const applyHudSafeArea = (hudRect: DOMRect, side: "left" | "right") => {
      if (hudRect.bottom <= rect.top || hudRect.top >= rect.bottom) return;

      const spansMostWidth = hudRect.width >= rect.width * 0.7;
      if (!spansMostWidth) {
        if (side === "left") {
          safeLeft = Math.max(safeLeft, hudRect.right - rect.left + overlayGap);
        } else {
          safeRight = Math.min(safeRight, hudRect.left - rect.left - overlayGap);
        }
        return;
      }

      const nearTop = hudRect.top <= rect.top + margin * 2;
      const nearBottom = hudRect.bottom >= rect.bottom - margin * 2;
      if (nearTop) {
        safeTop = Math.max(safeTop, hudRect.bottom - rect.top + overlayGap);
      } else if (nearBottom) {
        safeBottom = Math.min(safeBottom, hudRect.top - rect.top - overlayGap);
      }
    };

    if (leftHud) applyHudSafeArea(leftHud.getBoundingClientRect(), "left");
    if (rightHud) applyHudSafeArea(rightHud.getBoundingClientRect(), "right");
    if (topHud) {
      const r = topHud.getBoundingClientRect();
      safeTop = Math.max(safeTop, r.bottom - rect.top + overlayGap);
    }
    if (bottomHud) {
      const r = bottomHud.getBoundingClientRect();
      safeBottom = Math.min(safeBottom, r.top - rect.top - overlayGap);
    }

    const availableWidth = Math.max(1, safeRight - safeLeft);
    const availableHeight = Math.max(1, safeBottom - safeTop);

    const nextScale = clamp(
      Math.min(availableWidth / contentWidth, availableHeight / contentHeight),
      MIN_SCALE,
      FIT_MAX_SCALE
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const boardCenterX = rect.width / 2;
    const boardCenterY = rect.height / 2;
    const safeCenterX = safeLeft + availableWidth / 2;
    const safeCenterY = safeTop + availableHeight / 2;
    const deltaX = safeCenterX - boardCenterX;
    const deltaY = safeCenterY - boardCenterY;

    const nextOffset = { x: deltaX - centerX * nextScale, y: deltaY - centerY * nextScale };

    setScale((prev) => (Object.is(prev, nextScale) ? prev : nextScale));
    setOffset((prev) => (prev.x === nextOffset.x && prev.y === nextOffset.y ? prev : nextOffset));

    cameraTouched.current = false;
    cameraFitKey.current = mapBoundsKey;
  }, [mapBoundsKey, mapPixelBounds]);

  useEffect(() => {
    fitCameraToMap();
  }, [fitCameraToMap]);

  useEffect(() => {
    const handleResize = () => fitCameraToMap();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitCameraToMap]);

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
    const plannedMoves = orders?.moves || [];
    const showRevealedMoves = phase === "resolving" && revealedMoves && revealedMoves.length > 0;
    if (!showRevealedMoves) {
      return plannedMoves
        .map((move, index) => ({
          key: `me-${index}-${move.fromId}-${move.toId}`,
          index,
          playerId: null,
          fromId: move.fromId,
          toId: move.toId,
          count: Number(move.count) || 0,
          from: positions[move.fromId],
          to: positions[move.toId],
        }))
        .filter((entry) => entry.from && entry.to);
    }

    const passthrough = [];
    const attackGroups = new Map();

    for (const [moveIndex, move] of revealedMoves.entries()) {
      const from = positions[move.fromId];
      const to = positions[move.toId];
      if (!from || !to) continue;
      const playerId = move.playerId || null;
      if (!playerId) continue;
      const count = Number(move.count) || 0;
      if (count <= 0) continue;

      const targetOwnerId = systemById[move.toId]?.ownerId || null;
      const isAttack = targetOwnerId !== playerId;
      if (!isAttack) {
        passthrough.push({
          key: `${playerId}-${move.fromId}-${move.toId}-${count}-${moveIndex}`,
          index: null,
          playerId,
          fromId: move.fromId,
          toId: move.toId,
          count,
          from,
          to,
        });
        continue;
      }

      const key = `${playerId}:${move.toId}`;
      if (!attackGroups.has(key)) {
        attackGroups.set(key, {
          playerId,
          toId: move.toId,
          totalFleets: 0,
          weight: 0,
          sumX: 0,
          sumY: 0,
        });
      }
      const group = attackGroups.get(key);
      group.totalFleets += count;
      group.weight += count;
      group.sumX += from.x * count;
      group.sumY += from.y * count;
    }

    const aggregated = [];
    for (const group of attackGroups.values()) {
      const to = positions[group.toId];
      if (!to || group.totalFleets <= 0 || group.weight <= 0) continue;
      const from = { x: group.sumX / group.weight, y: group.sumY / group.weight };
      const fromId = `agg:${group.playerId}:${group.toId}`;
      aggregated.push({
        key: `${group.playerId}-${fromId}-${group.toId}-${group.totalFleets}`,
        index: null,
        playerId: group.playerId,
        fromId,
        toId: group.toId,
        count: group.totalFleets,
        from,
        to,
      });
    }

    return [...passthrough, ...aggregated];
  }, [orders, phase, positions, revealedMoves, systemById]);

  const movePaths = useMemo(() => {
    const groups = new Map();
    for (const entry of moveLines) {
      const fromKey = `${entry.playerId || "me"}:${entry.fromId}`;
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
      for (const entry of sorted) {
        const trimmed = trimLineToHexEdges(entry.from, entry.to, {
          size: HEX_SIZE,
          padStart: MOVE_LINE_START_PAD,
          padEnd: MOVE_LINE_END_PAD,
        });
        const isAggregateFrom = entry.fromId?.startsWith?.("agg:");
        const fromX = isAggregateFrom
          ? entry.from.x
          : entry.from.x + (trimmed.x1 - entry.from.x) * MOVE_LINE_START_TOWARD_EDGE;
        const fromY = isAggregateFrom
          ? entry.from.y
          : entry.from.y + (trimmed.y1 - entry.from.y) * MOVE_LINE_START_TOWARD_EDGE;
        const toX = trimmed.x2;
        const toY = trimmed.y2;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const len = Math.hypot(dx, dy) || 1;
        const mx = fromX + dx * 0.5;
        const my = fromY + dy * 0.5;
        const arch = Math.min(110, Math.max(40, len * 0.28));
        const { cx, cy } = computeMoveCurveControlPoint(dx, len, mx, my, arch);
        const badgeX = 0.25 * fromX + 0.5 * cx + 0.25 * toX;
        const badgeY = 0.25 * fromY + 0.5 * cy + 0.25 * toY;
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const d = `M ${fromX} ${fromY} Q ${cx} ${cy} ${toX} ${toY}`;
        result.push({ ...entry, d, labelX: badgeX, labelY: badgeY, angleDeg, cx, cy });
      }
    }

    return result;
  }, [moveLines]);

  const plannedMoves = useMemo(() => {
    if (phase !== "planning") return [];
    return (orders?.moves || [])
      .map((move, index) => ({
        index,
        fromId: move.fromId,
        toId: move.toId,
        count: Number(move.count) || 0,
        from: positions[move.fromId],
        to: positions[move.toId],
      }))
      .filter((entry) => entry.from && entry.to);
  }, [orders, phase, positions]);

  const plannedMovePaths = useMemo(() => {
    const groups = new Map();
    for (const entry of plannedMoves) {
      if (!groups.has(entry.fromId)) groups.set(entry.fromId, []);
      groups.get(entry.fromId).push(entry);
    }
    const result = [];
    for (const entries of groups.values()) {
      const sorted = entries
        .slice()
        .sort(
          (a, b) =>
            Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x) - Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x)
        );
      for (const entry of sorted) {
        const trimmed = trimLineToHexEdges(entry.from, entry.to, {
          size: HEX_SIZE,
          padStart: MOVE_LINE_START_PAD,
          padEnd: MOVE_LINE_END_PAD,
        });
        const from = {
          x: entry.from.x + (trimmed.x1 - entry.from.x) * MOVE_LINE_START_TOWARD_EDGE,
          y: entry.from.y + (trimmed.y1 - entry.from.y) * MOVE_LINE_START_TOWARD_EDGE,
        };
        const to = { x: trimmed.x2, y: trimmed.y2 };
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const mx = from.x + dx * 0.5;
        const my = from.y + dy * 0.5;
        const arch = Math.min(110, Math.max(40, len * 0.28));
        const { cx, cy } = computeMoveCurveControlPoint(dx, len, mx, my, arch);
        const labelX = 0.25 * from.x + 0.5 * cx + 0.25 * to.x;
        const labelY = 0.25 * from.y + 0.5 * cy + 0.25 * to.y;
        const d = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
        result.push({ ...entry, from, to, cx, cy, d, labelX, labelY, dx, dy, len });
      }
    }
    return result;
  }, [plannedMoves]);

  const [hoveredMoveIndex, setHoveredMoveIndex] = useState(null);
  const plannedPathsRef = useRef(plannedMovePaths);
  useEffect(() => {
    plannedPathsRef.current = plannedMovePaths;
  }, [plannedMovePaths]);

  const particleTiming = useMemo(() => {
    if (!resolutionStartedAt || !resolutionEndsAt) return null;
    const travelMs = Math.max(900, RESOLUTION_TRAVEL_MS);
    const durationMs = Math.max(700, travelMs - 140);
    const elapsedMs = Math.max(0, Date.now() - resolutionStartedAt);
    return { durationMs, elapsedMs };
  }, [resolutionEndsAt, resolutionStartedAt]);

  const particles = useMemo(() => {
    if (!resolutionStartedAt || !resolutionEndsAt) return [];
    if (!revealedMoves || revealedMoves.length === 0) return [];

    // Limit total particles to prevent DOM overload
    const MAX_PARTICLES = 40;

    const transfers = [];
    const attackGroups = new Map();
    for (const [moveIndex, move] of revealedMoves.entries()) {
      const from = positions[move.fromId];
      const to = positions[move.toId];
      if (!from || !to) continue;
      const playerId = move.playerId || null;
      if (!playerId) continue;
      const count = Number(move.count) || 0;
      if (count <= 0) continue;

      const targetOwnerId = systemById[move.toId]?.ownerId || null;
      const isAttack = targetOwnerId !== playerId;
      if (!isAttack) {
        const color = players?.[playerId]?.color || "#ffffff";
        const size = Math.min(18, 8 + Math.sqrt(count) * 1.6);
        transfers.push({ key: `t-${playerId}-${move.fromId}-${move.toId}-${moveIndex}`, from, to, color, size, count });
        continue;
      }

      const key = `${playerId}:${move.toId}`;
      if (!attackGroups.has(key)) {
        attackGroups.set(key, {
          playerId,
          toId: move.toId,
          totalFleets: 0,
          weight: 0,
          sumX: 0,
          sumY: 0,
        });
      }
      const group = attackGroups.get(key);
      group.totalFleets += count;
      group.weight += count;
      group.sumX += from.x * count;
      group.sumY += from.y * count;
    }

    const result = [];
    let index = 0;

    // Sort transfers by fleet count (descending) to prioritize larger moves
    transfers.sort((a, b) => b.count - a.count);

    for (const entry of transfers) {
      if (result.length >= MAX_PARTICLES) break;
      result.push({ index, ...entry });
      index += 1;
    }
    for (const group of attackGroups.values()) {
      if (result.length >= MAX_PARTICLES) break;
      const to = positions[group.toId];
      if (!to || group.totalFleets <= 0 || group.weight <= 0) continue;
      const from = { x: group.sumX / group.weight, y: group.sumY / group.weight };
      const color = players?.[group.playerId]?.color || "#ffffff";
      const size = Math.min(22, 8 + Math.sqrt(group.totalFleets) * 2);
      result.push({ key: `a-${group.playerId}-${group.toId}`, index, from, to, color, size });
      index += 1;
    }
    return result;
  }, [players, positions, resolutionEndsAt, resolutionStartedAt, revealedMoves, systemById]);

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
    if (phase !== "resolving" || !resolutionStartedAt || !resolutionBattles?.length) return;
    // Update combat state every 500ms (battles animate at 1000ms per round)
    const interval = setInterval(() => {
      setCombatNow(Date.now());
    }, 500);
    return () => clearInterval(interval);
  }, [phase, resolutionBattles, resolutionStartedAt]);

  const battleByTargetId = useMemo(() => {
    const map = new Map();
    for (const battle of resolutionBattles || []) {
      map.set(battle.targetId, battle);
    }
    return map;
  }, [resolutionBattles]);

  const battleStateByTargetId = useMemo(() => {
    if (phase !== "resolving") return new Map();
    if (!resolutionStartedAt || !resolutionBattles?.length) return new Map();
    const elapsed = combatNow - resolutionStartedAt;
    const map = new Map();
    for (const battle of resolutionBattles) {
      const battleElapsed = elapsed - battle.startOffsetMs;
      if (battleElapsed < 0 || battleElapsed >= battle.durationMs) continue;

      const skirmishRounds = battle.attackerSkirmishRounds || [];
      const combatRounds = battle.rounds || [];
      const skirmishMs = skirmishRounds.length * 1000;

      if (battleElapsed < skirmishMs && skirmishRounds.length) {
        const index = Math.min(skirmishRounds.length - 1, Math.floor(battleElapsed / 1000));
        const snapshot = skirmishRounds[index];
        const leader = snapshot.reduce((best, entry) => (!best || entry.fleets > best.fleets ? entry : best), null);
        map.set(battle.targetId, { mode: "skirmish", attackers: snapshot, attackerLeader: leader });
        continue;
      }

      if (combatRounds.length) {
        const index = Math.min(combatRounds.length - 1, Math.floor((battleElapsed - skirmishMs) / 1000));
        const snapshot = combatRounds[index];
        map.set(battle.targetId, { mode: "combat", attacker: snapshot.attacker, defender: snapshot.defender });
        continue;
      }
    }
    return map;
  }, [combatNow, phase, resolutionBattles, resolutionStartedAt]);

  const battleFxByTargetId = useMemo(() => {
    if (phase !== "resolving") return new Map();
    if (!resolutionStartedAt || !resolutionBattles?.length) return new Map();
    const elapsed = combatNow - resolutionStartedAt;
    const map = new Map();
    for (const battle of resolutionBattles) {
      const battleElapsed = elapsed - battle.startOffsetMs;
      if (battleElapsed < 0) continue;
      const tick = Math.max(0, Math.floor(battleElapsed / 1000));
      const victoryElapsed = battleElapsed - battle.durationMs;
      map.set(battle.targetId, { battleElapsed, tick, victoryElapsed });
    }
    return map;
  }, [combatNow, phase, resolutionBattles, resolutionStartedAt]);

  const activeBattle = null;
  const activeBattleState = null;
  const activeBattleFx = null;

  const handleWheel = (event) => {
    event.preventDefault();
    cameraTouched.current = true;

    const boardEl = boardRef.current;
    if (!boardEl) return;

    const currentScale = scaleRef.current || 1;
    const currentOffset = offsetRef.current || { x: 0, y: 0 };
    const rect = boardEl.getBoundingClientRect();
    const anchorX = event.clientX - (rect.left + rect.width / 2);
    const anchorY = event.clientY - (rect.top + rect.height / 2);

    // Smoother zoom with smaller increments
    const delta = event.deltaY > 0 ? -0.06 : 0.06;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, currentScale + delta));
    if (nextScale === currentScale) return;

    const worldX = (anchorX - currentOffset.x) / currentScale;
    const worldY = (anchorY - currentOffset.y) / currentScale;
    const nextOffset = { x: anchorX - worldX * nextScale, y: anchorY - worldY * nextScale };

    // Update refs immediately for smooth visual feedback
    scaleRef.current = nextScale;
    offsetRef.current = nextOffset;

    // Apply transform immediately via RAF for smooth animation
    if (!panRaf.current) {
      panRaf.current = requestAnimationFrame(() => {
        panRaf.current = 0;
        applyCanvasTransform();
      });
    }

    // Debounce React state updates to reduce re-renders during zooming
    if (redrawTimeoutRef.current) window.clearTimeout(redrawTimeoutRef.current);
    redrawTimeoutRef.current = window.setTimeout(() => {
      redrawTimeoutRef.current = null;
      setScale(scaleRef.current);
      setOffset(offsetRef.current);
      bustHexRasterization();
    }, 32); // ~2 frames at 60fps
  };

  const handlePointerDown = (event) => {
    if (event.target.closest) {
      if (event.target.closest("button")) return;
    }
    cameraTouched.current = true;
    pointerDown.current = true;
    dragging.current = false;
    didDrag.current = false;
    suppressNextClick.current = false;
    pointerIdRef.current = event.pointerId;
    pointerCaptured.current = false;
    lastPos.current = { x: event.clientX, y: event.clientY };
    dragStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event) => {
    if (pointerDown.current) {
      const totalDx = event.clientX - dragStart.current.x;
      const totalDy = event.clientY - dragStart.current.y;
      if (!didDrag.current && !dragging.current) {
        if (Math.hypot(totalDx, totalDy) <= DRAG_THRESHOLD_PX) return;
        didDrag.current = true;
        dragging.current = true;
        suppressNextClick.current = true;
        if (event.currentTarget.setPointerCapture && typeof event.pointerId === "number") {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerCaptured.current = true;
        }
        lastPos.current = { x: event.clientX, y: event.clientY };
        return;
      }

      const dx = event.clientX - lastPos.current.x;
      const dy = event.clientY - lastPos.current.y;
      offsetRef.current = { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy };
      if (!panRaf.current) {
        panRaf.current = requestAnimationFrame(() => {
          panRaf.current = 0;
          applyCanvasTransform();
        });
      }
      lastPos.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (phase !== "planning") return;
    if (event.target?.closest?.(".planned-move-controls")) return;

    // Throttle hover detection using requestAnimationFrame
    // Use refs for current camera position to avoid stale closure values
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const currentOffset = offsetRef.current;
    const currentScale = scaleRef.current;
    const x = (event.clientX - centerX - currentOffset.x) / currentScale;
    const y = (event.clientY - centerY - currentOffset.y) / currentScale;

    pendingHoverRef.current = { x, y };

    if (hoverRafRef.current) return; // Already scheduled

    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = 0;
      const pending = pendingHoverRef.current;
      if (!pending) return;

      let best = { index: null, dist2: Number.POSITIVE_INFINITY };
      for (const path of plannedPathsRef.current || []) {
        const p0 = path.from;
        const p1 = { x: path.cx, y: path.cy };
        const p2 = path.to;
        // Reduced from 5 samples to 3 for better performance
        const sampleTs = [0.25, 0.5, 0.75];
        for (const t of sampleTs) {
          const a = 1 - t;
          const px = a * a * p0.x + 2 * a * t * p1.x + t * t * p2.x;
          const py = a * a * p0.y + 2 * a * t * p1.y + t * t * p2.y;
          const dx = px - pending.x;
          const dy = py - pending.y;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < best.dist2) best = { index: path.index, dist2 };
        }
      }

      const threshold2 = 18 * 18;
      setHoveredMoveIndex(best.dist2 <= threshold2 ? best.index : null);
    });
  };

  const handlePointerUp = (event) => {
    pointerDown.current = false;
    dragging.current = false;
    if (didDrag.current) suppressNextClick.current = true;
    const isPlannedMoveControl = Boolean(event?.target?.closest && event.target.closest(".planned-move-controls"));
    if (panRaf.current) {
      cancelAnimationFrame(panRaf.current);
      panRaf.current = 0;
    }
    if (offsetRef.current.x !== offset.x || offsetRef.current.y !== offset.y) {
      setOffset(offsetRef.current);
    }
    const pointerId = pointerIdRef.current;
    pointerIdRef.current = null;
    if (pointerCaptured.current && event.currentTarget.releasePointerCapture && typeof pointerId === "number") {
      try {
        event.currentTarget.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
    }
    pointerCaptured.current = false;
    if (!isPlannedMoveControl) setHoveredMoveIndex(null);
  };

  const handleBoardClick = (event: React.MouseEvent) => {
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    // Only trigger background click if the click target is the board itself or the canvas
    const target = event.target as HTMLElement;
    if (target.classList.contains("board") || target.classList.contains("board-canvas") || target.classList.contains("board-links")) {
      onBackgroundClick?.();
    }
  };

  return (
    <div
      className="board"
      ref={boardRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleBoardClick}
    >
      <div className="board-canvas" ref={canvasRef}>
        <svg className="board-links" viewBox="-3000 -2200 6000 4400">
          {laneEdges.map((edge) => {
            const from = positions[edge.fromId];
            const to = positions[edge.toId];
            if (!from || !to) return null;
            const coords = trimLineToHexEdges(from, to, { size: HEX_SIZE, pad: 6 });
            return (
              <line
                key={`lane-${edge.fromId}-${edge.toId}`}
                x1={coords.x1}
                y1={coords.y1}
                x2={coords.x2}
                y2={coords.y2}
                className="lane-line"
              />
            );
          })}
          {wormholeEdges.map((wormhole) => {
            const from = positions[wormhole.fromId];
            const to = positions[wormhole.toId];
            if (!from || !to) return null;
            const dashed = (wormhole.turnsRemaining || 0) === 1;
            const coords = trimLineToHexEdges(from, to, { size: HEX_SIZE, pad: 10 });
            return (
              <g key={`wormhole-${wormhole.fromId}-${wormhole.toId}`}>
                <line
                  x1={coords.x1}
                  y1={coords.y1}
                  x2={coords.x2}
                  y2={coords.y2}
                  className={dashed ? "wormhole-line dashed" : "wormhole-line"}
                />
                <line
                  x1={coords.x1}
                  y1={coords.y1}
                  x2={coords.x2}
                  y2={coords.y2}
                  className={dashed ? "wormhole-line-pulse dashed" : "wormhole-line-pulse"}
                />
              </g>
            );
          })}
          {movePaths.map((path) => {
            const battleFx = phase === "resolving" ? battleFxByTargetId.get(path.toId) : null;
            if (battleFx && battleFx.victoryElapsed > 250) return null;
            return (
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
                  <g
                    className="move-badge"
                    transform={`translate(${path.labelX} ${path.labelY}) rotate(${path.angleDeg || 0})`}
                  >
                    <g transform={`scale(${MOVE_BADGE_SCALE})`}>
                      <polygon className="move-badge-shape" points={MOVE_BADGE_POINTS} />
                      <g transform={`rotate(${-(path.angleDeg || 0)})`}>
                        <text
                          className="move-badge-text"
                          x="0"
                          y="0"
                          data-digits={String(path.count).length}
                        >
                          {path.count}
                        </text>
                      </g>
                    </g>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
        {phase === "planning" && hoveredMoveIndex != null ? (() => {
          const path = plannedMovePaths.find((entry) => entry.index === hoveredMoveIndex);
          if (!path) return null;
          const cx = path.labelX;
          const cy = path.labelY + 12;
          return (
            <div
              className="planned-move-controls"
              style={{ left: `${cx}px`, top: `${cy}px` }}
            >
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveAdjust(path.index, -1); }}>−</button>
              <button type="button" className="cancel" onClick={(e) => { e.stopPropagation(); onMoveCancel(path.index); }}>×</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveAdjust(path.index, 1); }}>+</button>
            </div>
          );
        })() : null}
        {particleTiming
          ? particles.map((particle) => {
              const delayMs = (particle.index % 4) * 30;
              const animationDelayMs = delayMs - particleTiming.elapsedMs;
              return (
                <div
                  key={`${particle.key || `p-${particle.index}`}-${resolutionStartedAt || 0}`}
                  className="move-particle"
                  style={{
                    "--from-x": particle.from.x,
                    "--from-y": particle.from.y,
                    "--to-x": particle.to.x,
                    "--to-y": particle.to.y,
                    "--travel-duration": `${particleTiming.durationMs}ms`,
                    "--travel-delay": `${animationDelayMs}ms`,
                    background: particle.color,
                    width: `${particle.size || 10}px`,
                    height: `${particle.size || 10}px`,
                  }}
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
          const isPowerupTarget = Boolean(powerupDraft) && Boolean(powerupTargetIds?.has?.(system.id));
          const isWormholeFrom = Boolean(wormholeDraftFromId) && wormholeDraftFromId === system.id;
          if (selectedId === system.id) classes.push("selected");
          if (isNeighbor) classes.push("neighbor");
          if (isOrigin) classes.push("origin");
          if (battleOngoing) classes.push("combat");
          if (isPowerupTarget) classes.push("powerup-target");
          if (isWormholeFrom) classes.push("wormhole-from");
          if (system.defenseNetTurns > 0) classes.push("defense-net-active");
          if (system.terraformed) classes.push("terraformed");
          if (placementMode && phase === "planning" && fleetsRemaining > 0 && viewerId && system.ownerId === viewerId) {
            classes.push("placeable");
          }
          const queuedBadges = queuedPowerupsBySystemId.get(system.id) || [];
          const fx = (powerupFxBySystemId.get(system.id) || []).filter((entry) => entry.type !== "stellarBomb");
          const shouldTintCore = Boolean(owner?.color) || system.terraformed;
          const baseRgb = owner?.color ? getRgb(owner.color) : { r: 42, g: 50, b: 66 };
          const terrainRgb = system.terraformed ? getRgb(RESOURCE_COLORS.terrain) : null;
          let core = null;
          if (shouldTintCore && baseRgb) {
            let next = baseRgb;
            if (terrainRgb) next = mixRgb(next, terrainRgb, 0.18);
            core = deriveCoreGradient(next);
          }

          const style = {
            left: `${position.x}px`,
            top: `${position.y}px`,
            "--accent-color": accent,
            "--powerup-color": powerupHighlightColor || "",
          } as CSSProperties;
          if (core) {
            style["--hex-core-a"] = core.top;
            style["--hex-core-b"] = core.bottom;
          }
          return (
            <div
              key={system.id}
              className={classes.join(" ")}
              style={style}
              onClick={(event) => {
                if (suppressNextClick.current) {
                  suppressNextClick.current = false;
                  return;
                }
                onSystemClick(system, event);
              }}
              role="button"
            >
              {fx.length ? (
                <div className="hex-fx" aria-hidden="true">
                  {fx.map((entry) => (
                    <div
                      key={`${system.id}-fx-${entry.type}-${entry.startedAt}`}
                      className={`hex-fx-item fx-${entry.type}`}
                    />
                  ))}
                </div>
              ) : null}
              <div className="hex-border" />
              <div className="hex-core" />
              <div className="hex-value">{displayedFleets}</div>
              <div className="hex-tier-row">
                <div className={`hex-tier tier-${system.tier ?? 0}`} aria-label={`Tier ${system.tier ?? 0}`}>
                  {Array.from({ length: system.tier ?? 0 }).map((_, index) => (
                    <span key={`tier-${system.id}-${index}`} />
                  ))}
                </div>
                {queuedBadges.length ? (
                  <div className="hex-powerup-badges" aria-label="Queued powerups">
                    {queuedBadges.map((type) => (
                      <div key={`${system.id}-queued-${type}`} className={`hex-powerup-badge badge-${type}`}>
                        <PowerupIcon type={type} size={12} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="hex-resources" aria-label="Resources">
                {RESOURCE_TYPES.map((key) => {
                  const value = system.resources?.[key] ?? 0;
                  const fill = clamp(value / RESOURCE_MAX, 0, 1);
                  const level = value <= 0 ? "None" : `${Math.min(value, RESOURCE_MAX)}/${RESOURCE_MAX}`;
                  return (
                    <div
                      key={key}
                      className={`hex-res res-${key}`}
                      aria-label={`${resourceLabels[key]}: ${level}`}
                      title={`${resourceLabels[key]}: ${level}`}
                      style={{ "--fill": String(fill), "--angle": `${resourceAngles[key]}deg` }}
                    />
                  );
                })}
              </div>
              {placement > 0 ? <div className="hex-placement">+{placement}</div> : null}
              {system.defenseNetTurns > 0 ? <div className="hex-shield">DN</div> : null}
            </div>
          );
        })}
        {stellarBombFx.map((entry) => {
          const pos = positions[entry.targetId];
          if (!pos) return null;
          const key = `stellarBomb-${entry.targetId}-${entry.startedAt}`;
          return (
            <div
              key={key}
              className="stellar-bomb-explosion"
              style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
              aria-hidden="true"
            >
              <div className="stellar-bomb-flash" />
              <StellarBombExplosion id={key} reducedMotion={reducedMotion} />
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
        {phase === "resolving"
          ? (resolutionBattles || []).map((battle) => {
              const state = battleStateByTargetId.get(battle.targetId);
              if (!state) return null;
              const pos = positions[battle.targetId];
              if (!pos) return null;
              const fx = battleFxByTargetId.get(battle.targetId);
              const burstKey = `burst-${battle.targetId}-${fx?.tick || 0}`;
              const sparksKey = `sparks-${battle.targetId}-${fx?.tick || 0}`;

              return (
                <div key={`combat-${battle.targetId}`} className="combat-overlay" style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
                  <div className="combat-fx" aria-hidden="true">
                    <div key={burstKey} className="combat-burst" />
                    <div key={sparksKey} className="combat-sparks">
                      {Array.from({ length: 14 }).map((_, index) => (
                        <span
                          key={`spark-${battle.targetId}-${index}`}
                          className="combat-spark"
                          style={{
                            "--spark-angle": `${(index * 360) / 14}deg`,
                            "--spark-travel": `${52 + (index % 4) * 10}px`,
                            "--spark-delay": `${(index % 5) * 0.02}s`,
                          }}
                        />
                      ))}
                    </div>
                    {fx && fx.victoryElapsed >= 0 && fx.victoryElapsed < 1200 ? <div className="combat-victory">ミ.</div> : null}
                  </div>
                  <div className="combat-ring" />
                  <div className="combat-hud">
                    {state.mode === "combat" ? (
                      (() => {
                        const attackerColor = players?.[battle.attackerId]?.color || "rgba(255,255,255,0.82)";
                        const defenderColor = battle.defenderColorId
                          ? players?.[battle.defenderColorId]?.color || "rgba(255,255,255,0.55)"
                          : "rgba(255,255,255,0.35)";
                        const attackerStart = Number(battle.attackerStartFleets ?? state.attacker) || 0;
                        const defenderStart = Number(battle.defenderStartFleets ?? state.defender) || 0;
                        const scale = Math.max(1, attackerStart, defenderStart);
                        const atkRatio = clamp(Number(state.attacker) / scale, 0, 1);
                        const defRatio = clamp(Number(state.defender) / scale, 0, 1);
                        return (
                          <div className="combat-bars">
                            <div className="combat-bar-row">
                              <span className="combat-bar-label">ATK</span>
                              <span className="combat-bar-track" aria-hidden="true">
                                <span className="combat-bar-fill" style={{ width: `${atkRatio * 100}%`, background: attackerColor }} />
                              </span>
                              <span className="combat-bar-value">{state.attacker}</span>
                            </div>
                            <div className="combat-bar-row">
                              <span className="combat-bar-label">DEF</span>
                              <span className="combat-bar-track" aria-hidden="true">
                                <span className="combat-bar-fill" style={{ width: `${defRatio * 100}%`, background: defenderColor }} />
                              </span>
                              <span className="combat-bar-value">{state.defender}</span>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      (() => {
                        const sorted = (state.attackers || []).slice().sort((a, b) => b.fleets - a.fleets);
                        const max = Math.max(1, ...sorted.map((entry) => Number(entry.fleets) || 0));
                        return (
                          <>
                            <div className="combat-title">Skirmish</div>
                            <div className="combat-bars">
                              {sorted.map((entry, index) => {
                                const playerName = entry.playerId ? players?.[entry.playerId]?.name : "Neutral";
                                const tag =
                                  (playerName ? String(playerName).trim().slice(0, 3) : "") ||
                                  (entry.playerId ? String(entry.playerId).slice(0, 3) : "");
                                const label = tag ? tag.toUpperCase() : "NEU";
                                const color = entry.playerId ? players?.[entry.playerId]?.color : "rgba(180,190,215,0.65)";
                                const ratio = clamp((Number(entry.fleets) || 0) / max, 0, 1);
                                return (
                                  <div key={`skirmish-${battle.targetId}-${entry.playerId ?? "neutral"}-${index}`} className="combat-bar-row">
                                    <span className="combat-bar-label combat-skirmish-label" title={playerName || undefined}>
                                      <span className="combat-dot" style={{ background: color }} aria-hidden="true" />
                                      <span className="combat-skirmish-tag">{label}</span>
                                    </span>
                                    <span className="combat-bar-track" aria-hidden="true">
                                      <span className="combat-bar-fill" style={{ width: `${ratio * 100}%`, background: color }} />
                                    </span>
                                    <span className="combat-bar-value">{entry.fleets}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()
                    )}
                  </div>
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
                (() => {
                  const attackerColor = players?.[activeBattle.attackerId]?.color || "rgba(255,255,255,0.82)";
                  const defenderColor = activeBattle.defenderColorId
                    ? players?.[activeBattle.defenderColorId]?.color || "rgba(255,255,255,0.55)"
                    : "rgba(255,255,255,0.35)";
                  const attackerStart = Number(activeBattle.attackerStartFleets ?? activeBattleState.attacker) || 0;
                  const defenderStart = Number(activeBattle.defenderStartFleets ?? activeBattleState.defender) || 0;
                  const scale = Math.max(1, attackerStart, defenderStart);
                  const atkRatio = clamp(Number(activeBattleState.attacker) / scale, 0, 1);
                  const defRatio = clamp(Number(activeBattleState.defender) / scale, 0, 1);
                  return (
                    <div className="combat-bars">
                      <div className="combat-bar-row">
                        <span className="combat-bar-label">ATK</span>
                        <span className="combat-bar-track" aria-hidden="true">
                          <span className="combat-bar-fill" style={{ width: `${atkRatio * 100}%`, background: attackerColor }} />
                        </span>
                        <span className="combat-bar-value">{activeBattleState.attacker}</span>
                      </div>
                      <div className="combat-bar-row">
                        <span className="combat-bar-label">DEF</span>
                        <span className="combat-bar-track" aria-hidden="true">
                          <span className="combat-bar-fill" style={{ width: `${defRatio * 100}%`, background: defenderColor }} />
                        </span>
                        <span className="combat-bar-value">{activeBattleState.defender}</span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                (() => {
                  const sorted = (activeBattleState.attackers || []).slice().sort((a, b) => b.fleets - a.fleets);
                  const max = Math.max(1, ...sorted.map((entry) => Number(entry.fleets) || 0));
                  return (
                    <>
                      <div className="combat-title">Skirmish</div>
                      <div className="combat-bars">
                        {sorted.slice(0, 4).map((entry) => {
                          const color = players?.[entry.playerId]?.color || "rgba(255,255,255,0.55)";
                          const ratio = clamp((Number(entry.fleets) || 0) / max, 0, 1);
                          return (
                            <div key={entry.playerId || "neutral"} className="combat-bar-row">
                              <span className="combat-dot" style={{ background: color }} aria-hidden="true" />
                              <span className="combat-bar-track" aria-hidden="true">
                                <span className="combat-bar-fill" style={{ width: `${ratio * 100}%`, background: color }} />
                              </span>
                              <span className="combat-bar-value">{entry.fleets}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default Board;

