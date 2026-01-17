import { MAP_SIZES } from "@stellcon/shared";
import type { MapSize } from "@stellcon/shared";
import { normalizeHardBotStyle, type HardBotStyle } from "./hard.js";

export type HardStyleMatrixPoint = {
  mapSize: MapSize;
  maxTurns: number;
  players: number;
  style: HardBotStyle;
};

export type HardStyleTarget = {
  mapSize: MapSize;
  maxTurns: number;
  players: number;
};

function mapArea(mapSize: MapSize) {
  const size = MAP_SIZES[mapSize] || MAP_SIZES.medium;
  return Math.max(1, size.width * size.height);
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function logRatioDistance(a: number, b: number) {
  const aa = Math.max(1, a);
  const bb = Math.max(1, b);
  return Math.abs(Math.log(aa / bb));
}

export function findExactHardStyle(points: HardStyleMatrixPoint[], target: HardStyleTarget): HardBotStyle | null {
  const desiredTurns = clampInt(target.maxTurns, 1, 10_000);
  const desiredPlayers = clampInt(target.players, 2, 32);
  for (const point of points) {
    if (point.mapSize !== target.mapSize) continue;
    if (clampInt(point.maxTurns, 1, 10_000) !== desiredTurns) continue;
    if (clampInt(point.players, 2, 32) !== desiredPlayers) continue;
    return normalizeHardBotStyle(point.style);
  }
  return null;
}

export function interpolateHardStyle(
  points: HardStyleMatrixPoint[],
  target: HardStyleTarget,
  options: { k?: number } = {}
): HardBotStyle | null {
  if (!Array.isArray(points) || points.length === 0) return null;

  const exact = findExactHardStyle(points, target);
  if (exact) return exact;

  const desiredTurns = clampInt(target.maxTurns, 1, 10_000);
  const desiredPlayers = clampInt(target.players, 2, 32);
  const desiredArea = mapArea(target.mapSize);

  const k = clampInt(options.k ?? 8, 1, 64);

  const ranked = points
    .map((point) => {
      const area = mapArea(point.mapSize);
      const turns = clampInt(point.maxTurns, 1, 10_000);
      const players = clampInt(point.players, 2, 32);

      const areaDist = logRatioDistance(area, desiredArea);
      const turnsDist = logRatioDistance(turns, desiredTurns);
      const playersDist = Math.abs(players - desiredPlayers) / 6;
      const distance = Math.sqrt(areaDist * areaDist + turnsDist * turnsDist + playersDist * playersDist);

      return { point, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);

  if (!ranked.length) return null;

  const epsilon = 1e-6;
  let weightTotal = 0;
  let agg = 0;
  let exp = 0;
  let foc = 0;
  let tac = 0;

  for (const { point, distance } of ranked) {
    const w = 1 / Math.max(epsilon, distance);
    weightTotal += w;
    agg += (point.style?.aggression ?? 0) * w;
    exp += (point.style?.expansion ?? 0) * w;
    foc += (point.style?.focus ?? 0) * w;
    tac += (point.style?.tactics ?? 0) * w;
  }

  if (weightTotal <= 0) return null;

  return normalizeHardBotStyle({
    aggression: agg / weightTotal,
    expansion: exp / weightTotal,
    focus: foc / weightTotal,
    tactics: tac / weightTotal,
  });
}

