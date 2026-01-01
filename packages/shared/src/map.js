import { RESOURCE_TYPES } from "./constants.js";
import { mulberry32, seedToInt, pickRandom, axialDistance } from "./utils.js";

const NEIGHBOR_OFFSETS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function rectCoords(width, height) {
  const coords = [];
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

function coordKey(q, r) {
  return `${q},${r}`;
}

function generateRandomCoords({ allCoords, targetCount, rand }) {
  const picked = new Map();
  const valid = new Set(allCoords.map((coord) => coordKey(coord.q, coord.r)));
  const start = allCoords[Math.floor(rand() * allCoords.length)];
  picked.set(coordKey(start.q, start.r), start);

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

function connectedComponents(systemMap, links) {
  const visited = new Set();
  const components = [];

  for (const systemId of Object.keys(systemMap)) {
    if (visited.has(systemId)) continue;
    const queue = [systemId];
    visited.add(systemId);
    const component = [];

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

export function generateGalaxy({ seed = "stellcon", width = 18, height = 12, density = 0.55 } = {}) {
  const rand = mulberry32(seedToInt(seed));
  const allCoords = rectCoords(width, height);
  const targetCount = Math.max(24, Math.min(allCoords.length, Math.floor(allCoords.length * density)));
  const coords = generateRandomCoords({ allCoords, targetCount, rand });

  const systems = coords.map(({ q, r }) => {
    const roll = rand();
    const tier = roll > 0.95 ? 2 : roll > 0.83 ? 1 : 0;
    const ranges = [
      { min: 1, max: 4 },
      { min: 4, max: 8 },
      { min: 8, max: 12 },
    ];
    const range = ranges[tier];
    const resources = RESOURCE_TYPES.reduce((acc, key) => {
      acc[key] = range.min + Math.floor(rand() * (range.max - range.min + 1));
      return acc;
    }, {});
    const fleetRanges = [
      { min: 0, max: 3 },
      { min: 2, max: 5 },
      { min: 4, max: 8 },
    ];
    const fleetRange = fleetRanges[tier];
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

  const systemMap = systems.reduce((acc, system) => {
    acc[system.id] = system;
    return acc;
  }, {});

  const links = systems.reduce((acc, system) => {
    const neighbors = NEIGHBOR_OFFSETS.map((offset) => systemId(system.q + offset.q, system.r + offset.r))
      .filter((neighborId) => systemMap[neighborId]);
    acc[system.id] = neighbors;
    return acc;
  }, {});

  const components = connectedComponents(systemMap, links);
  if (components.length > 1) {
    for (const component of components) {
      if (component.length < 3) continue;
      let best = null;
      for (const fromId of component) {
        const from = systemMap[fromId];
        for (const [candidateId, candidate] of Object.entries(systemMap)) {
          if (component.includes(candidateId)) continue;
          const dist = axialDistance(from, candidate);
          if (!best || dist < best.dist) {
            best = { fromId, toId: candidateId, dist };
          }
        }
      }
      if (best) addLane(links, best.fromId, best.toId);
    }
  }

  return { systems, links };
}

export function pickHomeworlds(systems, count, rand) {
  const selected = [];
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
