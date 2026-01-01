import { DEFAULT_CONFIG, MAP_SIZES, PHASES, generateGalaxy } from "@stellcon/shared";

function axialDistance(a, b) {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  const ds = Math.abs((a.q + a.r) - (b.q + b.r));
  return Math.max(dq, dr, ds);
}

function pickExtremeSystem(systems, direction) {
  if (systems.length === 0) return null;
  if (direction === "minQ") {
    return systems.reduce((best, system) => (system.q < best.q ? system : best), systems[0]);
  }
  if (direction === "maxQ") {
    return systems.reduce((best, system) => (system.q > best.q ? system : best), systems[0]);
  }
  return systems[0];
}

function pickClosestSystem(systems, target, excludedIds = new Set()) {
  let best = null;
  for (const system of systems) {
    if (excludedIds.has(system.id)) continue;
    const dist = axialDistance(system, target);
    if (!best || dist < best.dist) best = { system, dist };
  }
  return best?.system || null;
}

const size = MAP_SIZES.large;
const { systems: generatedSystems, links } = generateGalaxy({
  seed: "stellcon-demo",
  width: size.width,
  height: size.height,
  density: 0.55,
});

const p1Home = pickExtremeSystem(generatedSystems, "minQ");
const p2Home = pickExtremeSystem(generatedSystems, "maxQ");
const excluded = new Set([p1Home?.id, p2Home?.id].filter(Boolean));
const p1Core = p1Home ? pickClosestSystem(generatedSystems, { q: p1Home.q + 2, r: p1Home.r - 1 }, excluded) : null;
if (p1Core) excluded.add(p1Core.id);
const p2Outpost = p2Home
  ? pickClosestSystem(generatedSystems, { q: p2Home.q - 3, r: p2Home.r + 1 }, excluded)
  : null;

const systems = generatedSystems.map((system) => {
  if (system.id === p1Home?.id) {
    return { ...system, ownerId: "p1", fleets: 8 };
  }
  if (system.id === p1Core?.id) {
    return { ...system, ownerId: "p1", fleets: 40 };
  }
  if (system.id === p2Home?.id) {
    return { ...system, ownerId: "p2", fleets: 0 };
  }
  if (system.id === p2Outpost?.id) {
    return { ...system, ownerId: "p2", fleets: 10 };
  }
  return system;
});

export const demoState = {
  id: "DEMO",
  config: { ...DEFAULT_CONFIG, maxTurns: 20, maxPlayers: 2, mapSize: "large" },
  turn: 7,
  phase: PHASES.planning,
  turnEndsAt: Date.now() + 56000,
  systems,
  links,
  players: {
    p1: {
      id: "p1",
      name: "Vanguard",
      color: "#e7656f",
      income: { fusion: 98, terrain: 92, metal: 96, crystal: 87 },
      research: { fusion: 18, terrain: 14, metal: 20, crystal: 10 },
      fleetsToPlace: 6,
      wormholeTurns: 0,
      alliances: {},
      locked: false,
      orders: { placements: {}, moves: [], powerups: [] },
    },
    p2: {
      id: "p2",
      name: "Zephyr Union",
      color: "#44d07f",
      income: { fusion: 66, terrain: 64, metal: 60, crystal: 56 },
      research: { fusion: 10, terrain: 8, metal: 6, crystal: 12 },
      fleetsToPlace: 5,
      wormholeTurns: 0,
      alliances: {},
      locked: false,
      orders: { placements: {}, moves: [], powerups: [] },
    },
  },
};

export const demoPlayerId = "p1";
