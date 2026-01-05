import type { GameConfig, MapSize, Phase, PowerupKey, ResourceType } from "./types.js";

export const RESOURCE_TYPES = ["fusion", "terrain", "metal", "crystal"] as const satisfies readonly ResourceType[];

export const RESOURCE_COLORS = {
  fusion: "#d05cff",
  terrain: "#4edb7d",
  metal: "#f3c457",
  crystal: "#56c9ff",
};

export const POWERUPS = {
  stellarBomb: { key: "stellarBomb", label: "Stellar Bomb", unlockCost: 20, cost: 20, resource: "metal", duration: 0 },
  terraform: { key: "terraform", label: "Terraform", unlockCost: 20, cost: 20, resource: "terrain", duration: 0 },
  defenseNet: { key: "defenseNet", label: "Defense Net", unlockCost: 20, cost: 20, resource: "crystal", duration: 3 },
  wormhole: { key: "wormhole", label: "Wormhole", unlockCost: 20, cost: 20, resource: "fusion", duration: 3 },
} as const satisfies Record<
  PowerupKey,
  { key: PowerupKey; label: string; unlockCost: number; cost: number; resource: ResourceType; duration: number }
>;

export const PLAYER_COLORS = [
  "#ff5f6d", // hot red
  "#ff9f43", // amber
  "#ffd93d", // gold
  "#3dffb8", // mint
  "#35d0ff", // cyan
  "#4a7dff", // blue
  "#b06cff", // violet
  "#ff5fe7", // magenta
] as const;

export const MAP_SIZES = {
  small: { width: 12, height: 4 },
  medium: { width: 18, height: 6 },
  large: { width: 24, height: 8 },
  massive: { width: 36, height: 12 },
} as const satisfies Record<MapSize, { width: number; height: number }>;

export const DEFAULT_CONFIG = {
  maxTurns: 20,
  mapSize: "medium",
  maxPlayers: 2,
  turnSeconds: 90,
  isPrivate: false,
} as const satisfies GameConfig;

export const PHASES = {
  planning: "planning",
  resolving: "resolving",
  complete: "complete",
} as const satisfies Record<Phase, Phase>;

export const HOMEWORLD_FLEETS = 10;

export const RESOLUTION_TRAVEL_MS = 1200;
