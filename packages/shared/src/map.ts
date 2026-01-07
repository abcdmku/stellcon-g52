import { CORE_RESOURCE_TYPES, RESOURCE_TYPES } from "./constants.js";
import { mulberry32, seedToInt, pickRandom, axialDistance } from "./utils.js";
import type { ResourceMap, SystemState } from "./types.js";

type Coord = { q: number; r: number };
type Links = Record<string, string[]>;
type SystemMap = Record<string, SystemState>;
type Rand = () => number;

const NEIGHBOR_OFFSETS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function rectCoords(width: number, height: number): Coord[] {
  const coords: Coord[] = [];
  const qShift = Math.floor(width / 2);
  const rShift = Math.floor(height / 2);

  for (let col = 0; col < width; col += 1) {
    for (let row = 0; row < height; row += 1) {
      const baseQ = col;
      const baseR = row - Math.floor(col / 2);
      const q = baseQ - qShift;
      const r = baseR - rShift;
      coords.push({ q, r });
    }
  }

  return coords;
}

function systemId(q, r) {
  return `s${q}_${r}`;
}

function coordKey(q: number, r: number) {
  return `${q},${r}`;
}

function rollTotalResources(
  rand: Rand,
  keys: readonly (keyof ResourceMap)[],
  { minTotal, maxTotal }: { minTotal: number; maxTotal: number }
): ResourceMap {
  const shuffled = [...keys];
  for (let i = keys.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const total = minTotal + Math.floor(rand() * (maxTotal - minTotal + 1));
  let remaining = total;

  const resources = {} as ResourceMap;
  for (const key of RESOURCE_TYPES) resources[key] = 0;

  for (let i = 0; i < shuffled.length; i += 1) {
    const key = shuffled[i];
    const value = i === shuffled.length - 1 ? remaining : Math.floor(rand() * (remaining + 1));
    resources[key] = value;
    remaining -= value;
  }

  return resources;
}

export function rollResourcesForTier(tier: number, rand: Rand): ResourceMap {
  const clampedTier = Math.max(0, Math.min(3, Math.floor(tier)));
  const ceveronByTier = [0, 1, 2, 3];
  const ranges = [
    { minTotal: 1, maxTotal: 3 }, // tier 0
    { minTotal: 3, maxTotal: 5 }, // tier 1
    { minTotal: 5, maxTotal: 8 }, // tier 2
    { minTotal: 8, maxTotal: 12 }, // tier 3 (homeworlds only)
  ];

  if (clampedTier === 3) {
    const resources = {} as ResourceMap;
    for (const key of RESOURCE_TYPES) resources[key] = 0;
    resources.ceveron = ceveronByTier[clampedTier];

    const { minTotal, maxTotal } = ranges[clampedTier];
    const total = Math.max(
      CORE_RESOURCE_TYPES.length,
      minTotal + Math.floor(rand() * (maxTotal - minTotal + 1))
    );

    for (const key of CORE_RESOURCE_TYPES) resources[key] = 1;
    let remaining = total - CORE_RESOURCE_TYPES.length;
    while (remaining > 0) {
      const key = CORE_RESOURCE_TYPES[Math.floor(rand() * CORE_RESOURCE_TYPES.length)];
      resources[key] += 1;
      remaining -= 1;
    }
    return resources;
  }

  const resources = rollTotalResources(rand, CORE_RESOURCE_TYPES, ranges[clampedTier]);
  resources.ceveron = ceveronByTier[clampedTier];
  return resources;
}

function isInteriorCoord(coord: Coord, valid: Set<string>) {
  return NEIGHBOR_OFFSETS.every((offset) => valid.has(coordKey(coord.q + offset.q, coord.r + offset.r)));
}

function pickHomeCoords(allCoords: Coord[], count: number, rand: Rand): Coord[] {
  const valid = new Set<string>(allCoords.map((coord) => coordKey(coord.q, coord.r)));
  const pool = allCoords.filter((coord) => isInteriorCoord(coord, valid));
  if (pool.length === 0) return [];

  const selected: Coord[] = [];
  selected.push(pickRandom(pool, rand));

  while (selected.length < count && selected.length < pool.length) {
    let best: Coord | null = null;
    let bestScore = -1;
    for (const coord of pool) {
      if (selected.some((chosen) => chosen.q === coord.q && chosen.r === coord.r)) continue;
      const score = Math.min(...selected.map((chosen) => axialDistance(coord, chosen)));
      if (score > bestScore) {
        bestScore = score;
        best = coord;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  return selected;
}

function generateRandomCoords({
  allCoords,
  targetCount,
  rand,
  seedCoords = [],
}: {
  allCoords: Coord[];
  targetCount: number;
  rand: Rand;
  seedCoords?: Coord[];
}): Coord[] {
  const picked = new Map<string, Coord>();
  const valid = new Set<string>(allCoords.map((coord) => coordKey(coord.q, coord.r)));

  for (const coord of seedCoords) {
    const key = coordKey(coord.q, coord.r);
    if (!valid.has(key)) continue;
    picked.set(key, coord);
  }

  if (picked.size === 0) {
    const start = allCoords[Math.floor(rand() * allCoords.length)];
    if (!start) return [];
    picked.set(coordKey(start.q, start.r), start);
  }

  const spawnChance = 0.18;
  const walkExtraChance = 0.26;

  while (picked.size < targetCount) {
    const roll = rand();
    if (roll < spawnChance) {
      const candidate = allCoords[Math.floor(rand() * allCoords.length)];
      picked.set(coordKey(candidate.q, candidate.r), candidate);
      continue;
    }

    const anchors = [...picked.values()];
    const anchor = anchors[Math.floor(rand() * anchors.length)];
    const offset = NEIGHBOR_OFFSETS[Math.floor(rand() * NEIGHBOR_OFFSETS.length)];
    const candidate = { q: anchor.q + offset.q, r: anchor.r + offset.r };
    if (!valid.has(coordKey(candidate.q, candidate.r))) continue;
    picked.set(coordKey(candidate.q, candidate.r), candidate);

    if (rand() < walkExtraChance) {
      const extraOffset = NEIGHBOR_OFFSETS[Math.floor(rand() * NEIGHBOR_OFFSETS.length)];
      const extra = { q: candidate.q + extraOffset.q, r: candidate.r + extraOffset.r };
      if (valid.has(coordKey(extra.q, extra.r))) {
        picked.set(coordKey(extra.q, extra.r), extra);
      }
    }
  }

  return [...picked.values()];
}

function connectedComponents(systemMap: SystemMap, links: Links) {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const systemId of Object.keys(systemMap)) {
    if (visited.has(systemId)) continue;
    const queue = [systemId];
    visited.add(systemId);
    const component: string[] = [];

    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const next of links[current] || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    components.push(component);
  }

  return components;
}

function addLane(links, fromId, toId) {
  links[fromId] ||= [];
  links[toId] ||= [];
  if (!links[fromId].includes(toId)) links[fromId].push(toId);
  if (!links[toId].includes(fromId)) links[toId].push(fromId);
}

function removeSoloSystems(systems: SystemState[], links: Links): { systems: SystemState[]; links: Links } {
  const keep = new Set<string>();
  for (const [id, neighbors] of Object.entries(links)) {
    if ((neighbors || []).length > 0) keep.add(id);
  }

  if (keep.size === systems.length) return { systems, links };

  const nextSystems = systems.filter((system) => keep.has(system.id));
  const nextLinks: Links = {};
  for (const [id, neighbors] of Object.entries(links)) {
    if (!keep.has(id)) continue;
    nextLinks[id] = (neighbors || []).filter((neighborId) => keep.has(neighborId));
  }

  return { systems: nextSystems, links: nextLinks };
}

function bestLaneBetween(systemMap: SystemMap, fromIds: string[], toIds: string[]) {
  let best: { fromId: string; toId: string; dist: number } | null = null;
  for (const fromId of fromIds) {
    const from = systemMap[fromId];
    if (!from) continue;
    for (const toId of toIds) {
      const to = systemMap[toId];
      if (!to) continue;
      const dist = axialDistance(from, to);
      if (!best || dist < best.dist) best = { fromId, toId, dist };
    }
  }
  return best;
}

export function generateGalaxy({
  seed = "stellcon",
  width = 18,
  height = 12,
  density = 0.55,
  homeworldCount = 0,
}: {
  seed?: string;
  width?: number;
  height?: number;
  density?: number;
  homeworldCount?: number;
} = {}): { systems: SystemState[]; links: Links } {
  const rand = mulberry32(seedToInt(seed));
  const allCoords = rectCoords(width, height);
  const targetCount = Math.max(24, Math.min(allCoords.length, Math.floor(allCoords.length * density)));

  const homeCoords = homeworldCount > 0 ? pickHomeCoords(allCoords, homeworldCount, rand) : [];
  const homeCoordKeys = new Set<string>(homeCoords.map((coord) => coordKey(coord.q, coord.r)));
  const homePerimeterCoords = homeCoords.flatMap((home) => NEIGHBOR_OFFSETS.map((offset) => ({ q: home.q + offset.q, r: home.r + offset.r })));
  const homePerimeterCoordKeys = new Set<string>(homePerimeterCoords.map((coord) => coordKey(coord.q, coord.r)));

  const coords = generateRandomCoords({
    allCoords,
    targetCount,
    rand,
    seedCoords: [...homeCoords, ...homePerimeterCoords],
  });

  let systems: SystemState[] = coords.map(({ q, r }) => {
    const key = coordKey(q, r);
    const isHome = homeCoordKeys.has(key);

    let tier = 0;
    if (isHome) {
      tier = 3;
    } else if (homePerimeterCoordKeys.has(key)) {
      tier = 0;
    } else {
      const roll = rand();
      tier = roll > 0.97 ? 2 : roll > 0.85 ? 1 : 0;
    }

    const resources = rollResourcesForTier(tier, rand);

    const fleetRanges = [
      { min: 0, max: 2 }, // tier 0
      { min: 1, max: 3 }, // tier 1
      { min: 2, max: 5 }, // tier 2
      { min: 0, max: 0 }, // tier 3 (homeworld fleets are set when the game starts)
    ];
    const fleetRange = fleetRanges[Math.max(0, Math.min(fleetRanges.length - 1, tier))];
    const fleets = fleetRange.min + Math.floor(rand() * (fleetRange.max - fleetRange.min + 1));

    return {
      id: systemId(q, r),
      q,
      r,
      tier,
      resources,
      ownerId: null,
      fleets,
      defenseNetTurns: 0,
      terraformed: false,
    };
  });

  let systemMap = systems.reduce((acc, system) => {
    acc[system.id] = system;
    return acc;
  }, {} as SystemMap);

  let links = systems.reduce((acc, system) => {
    const neighbors = NEIGHBOR_OFFSETS.map((offset) => systemId(system.q + offset.q, system.r + offset.r))
      .filter((neighborId) => systemMap[neighborId]);
    acc[system.id] = neighbors;
    return acc;
  }, {} as Links);

  ({ systems, links } = removeSoloSystems(systems, links));
  systemMap = systems.reduce((acc, system) => {
    acc[system.id] = system;
    return acc;
  }, {} as SystemMap);

  const components = connectedComponents(systemMap, links);
  if (components.length > 1) {
    const parent = Array.from({ length: components.length }, (_, index) => index);
    const findRoot = (index) => {
      let current = index;
      while (parent[current] !== current) current = parent[current];
      let cursor = index;
      while (parent[cursor] !== cursor) {
        const next = parent[cursor];
        parent[cursor] = current;
        cursor = next;
      }
      return current;
    };
    const unionRoots = (a, b) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra === rb) return ra;
      parent[rb] = ra;
      return ra;
    };

    const connectorIdsByComponent = components.map((component) => {
      const boundary = component.filter((id) => (links[id] || []).length < NEIGHBOR_OFFSETS.length);
      return boundary.length > 0 ? boundary : component;
    });

    const connectComponents = (fromIndex: number, toIndex: number) => {
      const fromRoot = findRoot(fromIndex);
      const toRoot = findRoot(toIndex);
      if (fromRoot === toRoot) return false;

      const best = bestLaneBetween(systemMap, connectorIdsByComponent[fromIndex], connectorIdsByComponent[toIndex]);
      if (!best) return false;
      addLane(links, best.fromId, best.toId);
      unionRoots(fromRoot, toRoot);
      return true;
    };

    type ComponentEdge = { fromIndex: number; toIndex: number; dist: number };

    const edges: ComponentEdge[] = [];
    for (let fromIndex = 0; fromIndex < components.length; fromIndex += 1) {
      for (let toIndex = fromIndex + 1; toIndex < components.length; toIndex += 1) {
        const best = bestLaneBetween(systemMap, connectorIdsByComponent[fromIndex], connectorIdsByComponent[toIndex]);
        if (!best) continue;
        edges.push({ fromIndex, toIndex, dist: best.dist });
      }
    }

    edges.sort((a, b) => a.dist - b.dist);

    let unions = 0;
    for (const edge of edges) {
      if (connectComponents(edge.fromIndex, edge.toIndex)) {
        unions += 1;
        if (unions >= components.length - 1) break;
      }
    }
  }

  return { systems, links };
}

export function pickHomeworlds(systems: SystemState[], count: number, rand: Rand): SystemState[] {
  const selected: SystemState[] = [];
  const pool = [...systems];
  if (pool.length === 0) return selected;

  selected.push(pickRandom(pool, rand));

  while (selected.length < count) {
    let best = null;
    let bestScore = -1;
    for (const system of pool) {
      if (selected.includes(system)) continue;
      const score = Math.min(...selected.map((chosen) => axialDistance(system, chosen)));
      if (score > bestScore) {
        bestScore = score;
        best = system;
      }
    }
    if (!best) break;
    selected.push(best);
  }

  return selected;
}
