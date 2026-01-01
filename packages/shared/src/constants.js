export const RESOURCE_TYPES = ["fusion", "terrain", "metal", "crystal"];

export const RESOURCE_COLORS = {
  fusion: "#d05cff",
  terrain: "#4edb7d",
  metal: "#f3c457",
  crystal: "#56c9ff",
};

export const POWERUPS = {
  stellarBomb: { key: "stellarBomb", label: "Stellar Bomb", unlockCost: 30, cost: 20, resource: "metal", duration: 0 },
  terraform: { key: "terraform", label: "Terraform", unlockCost: 30, cost: 20, resource: "terrain", duration: 0 },
  defenseNet: { key: "defenseNet", label: "Defense Net", unlockCost: 30, cost: 20, resource: "crystal", duration: 3 },
  wormhole: { key: "wormhole", label: "Wormhole", unlockCost: 30, cost: 20, resource: "fusion", duration: 3 },
};

export const PLAYER_COLORS = ["#e7656f", "#44d07f", "#7cc6ff", "#b487ff", "#f28b5b", "#f4d35e"];

export const MAP_SIZES = {
  small: { width: 12, height: 8 },
  medium: { width: 18, height: 12 },
  large: { width: 24, height: 16 },
  massive: { width: 36, height: 24 },
};

export const DEFAULT_CONFIG = {
  maxTurns: 20,
  mapSize: "medium",
  maxPlayers: 2,
  turnSeconds: 90,
  isPrivate: false,
};

export const PHASES = {
  planning: "planning",
  resolving: "resolving",
  complete: "complete",
};

export const HOMEWORLD_FLEETS = 10;

export const RESOLUTION_TRAVEL_MS = 1200;
