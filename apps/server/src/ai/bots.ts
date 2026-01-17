import {
  interpolateHardStyle,
  normalizeHardBotStyle,
  planBotOrders as basePlanBotOrders,
  planHard,
  type HardBotStyle,
  type HardStyleMatrixPoint,
} from "@stellcon/bots";
import type { BotDifficulty, GameState, MapSize, Orders } from "@stellcon/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function emptyOrders(): Orders {
  return { placements: {}, moves: [], powerups: [], research: [] };
}

function asMapSize(value: unknown): MapSize {
  return value === "small" || value === "medium" || value === "large" || value === "massive" ? value : "medium";
}

function extractHardStyle(value: unknown): Partial<HardBotStyle> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const hasAny =
    typeof record.aggression === "number" ||
    typeof record.expansion === "number" ||
    typeof record.focus === "number" ||
    typeof record.tactics === "number";
  if (hasAny) return record as Partial<HardBotStyle>;

  const best = record.best;
  if (best && typeof best === "object") {
    const style = (best as Record<string, unknown>).style;
    if (style) return extractHardStyle(style);
  }

  return null;
}

function resolveFixedHardStyleFromEnv(): HardBotStyle | null {
  const inline = process.env.STELLCON_HARD_BOT_STYLE_JSON;
  if (inline) {
    try {
      const parsed = JSON.parse(inline) as unknown;
      const extracted = extractHardStyle(parsed);
      return extracted ? normalizeHardBotStyle(extracted) : null;
    } catch {
      return null;
    }
  }

  const filePath = process.env.STELLCON_HARD_BOT_STYLE_FILE;
  if (!filePath) return null;
  try {
    const absolute = resolve(process.cwd(), filePath);
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    const extracted = extractHardStyle(parsed);
    return extracted ? normalizeHardBotStyle(extracted) : null;
  } catch {
    return null;
  }
}

type HardStyleMatrix = {
  points: HardStyleMatrixPoint[];
  byKey: Map<string, HardBotStyle>;
};

function extractHardStyleMatrixPoints(value: unknown): HardStyleMatrixPoint[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;

  if (record.schema === "stellcon-hard-style-matrix-v1" && Array.isArray(record.entries)) {
    const points: HardStyleMatrixPoint[] = [];
    for (const entry of record.entries) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const mapSize = asMapSize(e.mapSize);
      const maxTurns = Number(e.maxTurns);
      const players = Number(e.players);
      if (!Number.isFinite(maxTurns) || !Number.isFinite(players)) continue;
      const style = extractHardStyle(e.style) ?? null;
      if (!style) continue;
      points.push({
        mapSize,
        maxTurns: Math.floor(maxTurns),
        players: Math.floor(players),
        style: normalizeHardBotStyle(style),
      });
    }
    return points;
  }

  const mapSize = asMapSize(record.mapSize);
  const maxTurns = Number(record.maxTurns);
  const players = Number(record.players);
  const style = extractHardStyle(record) ?? null;
  if (style && Number.isFinite(maxTurns) && Number.isFinite(players)) {
    return [
      {
        mapSize,
        maxTurns: Math.floor(maxTurns),
        players: Math.floor(players),
        style: normalizeHardBotStyle(style),
      },
    ];
  }

  const bestStyle = extractHardStyle(record);
  const bestPlayers = Number(record.players);
  if (bestStyle && Number.isFinite(maxTurns) && Number.isFinite(bestPlayers)) {
    return [
      {
        mapSize,
        maxTurns: Math.floor(maxTurns),
        players: Math.floor(bestPlayers),
        style: normalizeHardBotStyle(bestStyle),
      },
    ];
  }

  return [];
}

function loadMatrixFromEnv(): HardStyleMatrix | null {
  const matrixPath = process.env.STELLCON_HARD_BOT_STYLE_MATRIX_FILE;
  if (!matrixPath) return null;
  try {
    const absolute = resolve(process.cwd(), matrixPath);
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
    const points = extractHardStyleMatrixPoints(parsed);
    if (!points.length) return null;
    return { points, byKey: new Map() };
  } catch {
    return null;
  }
}

let cachedFixedHardStyle: HardBotStyle | null | undefined;
let cachedHardStyleMatrix: HardStyleMatrix | null | undefined;

function getFixedHardStyle(): HardBotStyle | null {
  if (cachedFixedHardStyle !== undefined) return cachedFixedHardStyle;
  cachedFixedHardStyle = resolveFixedHardStyleFromEnv();
  return cachedFixedHardStyle;
}

function getHardBotStyleForGame(game: GameState): HardBotStyle | null {
  const fixed = getFixedHardStyle();
  if (fixed) return fixed;

  if (cachedHardStyleMatrix === undefined) {
    cachedHardStyleMatrix = loadMatrixFromEnv();
  }
  const matrix = cachedHardStyleMatrix;
  if (!matrix) return null;

  const mapSize = asMapSize(game.config?.mapSize);
  const maxTurns = Math.max(1, Math.floor(Number(game.config?.maxTurns ?? 20)));
  const players = Math.max(2, Math.floor(Object.keys(game.players || {}).length || 2));
  const key = `${mapSize}:${players}:${maxTurns}`;

  const cached = matrix.byKey.get(key);
  if (cached) return cached;

  const style = interpolateHardStyle(matrix.points, { mapSize, maxTurns, players }) ?? null;
  if (style) matrix.byKey.set(key, style);
  return style;
}

export function planBotOrders(game: GameState, playerId: string, difficulty: BotDifficulty): Orders {
  if (!game || !playerId) return emptyOrders();
  if (game.phase !== "planning") return emptyOrders();
  if (difficulty === "hard") {
    const style = getHardBotStyleForGame(game);
    if (style) return planHard(game, playerId, style);
  }
  return basePlanBotOrders(game, playerId, difficulty);
}
