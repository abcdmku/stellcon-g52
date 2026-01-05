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
function generateRandomCoords({ allCoords, targetCount, rand, }) {
    const picked = new Map();
    const valid = new Set(allCoords.map((coord) => coordKey(coord.q, coord.r)));
    const start = allCoords[Math.floor(rand() * allCoords.length)];
    if (!start)
        return [];
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
        if (!valid.has(coordKey(candidate.q, candidate.r)))
            continue;
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
        if (visited.has(systemId))
            continue;
        const queue = [systemId];
        visited.add(systemId);
        const component = [];
        while (queue.length) {
            const current = queue.shift();
            component.push(current);
            for (const next of links[current] || []) {
                if (visited.has(next))
                    continue;
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
    if (!links[fromId].includes(toId))
        links[fromId].push(toId);
    if (!links[toId].includes(fromId))
        links[toId].push(fromId);
}
function removeSoloSystems(systems, links) {
    const keep = new Set();
    for (const [id, neighbors] of Object.entries(links)) {
        if ((neighbors || []).length > 0)
            keep.add(id);
    }
    if (keep.size === systems.length)
        return { systems, links };
    const nextSystems = systems.filter((system) => keep.has(system.id));
    const nextLinks = {};
    for (const [id, neighbors] of Object.entries(links)) {
        if (!keep.has(id))
            continue;
        nextLinks[id] = (neighbors || []).filter((neighborId) => keep.has(neighborId));
    }
    return { systems: nextSystems, links: nextLinks };
}
function bestLaneBetween(systemMap, fromIds, toIds) {
    let best = null;
    for (const fromId of fromIds) {
        const from = systemMap[fromId];
        if (!from)
            continue;
        for (const toId of toIds) {
            const to = systemMap[toId];
            if (!to)
                continue;
            const dist = axialDistance(from, to);
            if (!best || dist < best.dist)
                best = { fromId, toId, dist };
        }
    }
    return best;
}
export function generateGalaxy({ seed = "stellcon", width = 18, height = 12, density = 0.55, } = {}) {
    const rand = mulberry32(seedToInt(seed));
    const allCoords = rectCoords(width, height);
    const targetCount = Math.max(24, Math.min(allCoords.length, Math.floor(allCoords.length * density)));
    const coords = generateRandomCoords({ allCoords, targetCount, rand });
    let systems = coords.map(({ q, r }) => {
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
    let systemMap = systems.reduce((acc, system) => {
        acc[system.id] = system;
        return acc;
    }, {});
    let links = systems.reduce((acc, system) => {
        const neighbors = NEIGHBOR_OFFSETS.map((offset) => systemId(system.q + offset.q, system.r + offset.r))
            .filter((neighborId) => systemMap[neighborId]);
        acc[system.id] = neighbors;
        return acc;
    }, {});
    ({ systems, links } = removeSoloSystems(systems, links));
    systemMap = systems.reduce((acc, system) => {
        acc[system.id] = system;
        return acc;
    }, {});
    const components = connectedComponents(systemMap, links);
    if (components.length > 1) {
        const sizes = components.map((component) => component.length);
        let mainIndex = 0;
        for (let index = 1; index < components.length; index += 1) {
            if (sizes[index] > sizes[mainIndex])
                mainIndex = index;
        }
        const parent = Array.from({ length: components.length }, (_, index) => index);
        const findRoot = (index) => {
            let current = index;
            while (parent[current] !== current)
                current = parent[current];
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
            if (ra === rb)
                return ra;
            parent[rb] = ra;
            return ra;
        };
        const connectOnceByRootPair = new Set();
        const connectComponents = (fromIndex, toIndex) => {
            const fromRoot = findRoot(fromIndex);
            const toRoot = findRoot(toIndex);
            if (fromRoot === toRoot)
                return false;
            const pairKey = [fromRoot, toRoot].sort((a, b) => a - b).join("-");
            if (connectOnceByRootPair.has(pairKey))
                return false;
            const best = bestLaneBetween(systemMap, components[fromIndex], components[toIndex]);
            if (!best)
                return false;
            addLane(links, best.fromId, best.toId);
            connectOnceByRootPair.add(pairKey);
            unionRoots(fromRoot, toRoot);
            return true;
        };
        const LARGE_ISLAND_SIZE = 8;
        // 1) Ensure large islands connect directly to the main landmass.
        for (let index = 0; index < components.length; index += 1) {
            if (index === mainIndex)
                continue;
            if (sizes[index] < LARGE_ISLAND_SIZE)
                continue;
            connectComponents(index, mainIndex);
        }
        // 2) Connect remaining islands without creating duplicate island-to-island lanes.
        while (true) {
            const mainRoot = findRoot(mainIndex);
            const remaining = [];
            const connected = [];
            for (let index = 0; index < components.length; index += 1) {
                if (sizes[index] < 2)
                    continue;
                if (findRoot(index) === mainRoot)
                    connected.push(index);
                else
                    remaining.push(index);
            }
            if (remaining.length === 0)
                break;
            let best = null;
            for (const fromIndex of remaining) {
                for (const toIndex of connected) {
                    const candidate = bestLaneBetween(systemMap, components[fromIndex], components[toIndex]);
                    if (!candidate)
                        continue;
                    if (!best || candidate.dist < best.dist)
                        best = { ...candidate, fromIndex, toIndex };
                }
            }
            if (!best)
                break;
            connectComponents(best.fromIndex, best.toIndex);
        }
    }
    return { systems, links };
}
export function pickHomeworlds(systems, count, rand) {
    const selected = [];
    const pool = [...systems];
    if (pool.length === 0)
        return selected;
    selected.push(pickRandom(pool, rand));
    while (selected.length < count) {
        let best = null;
        let bestScore = -1;
        for (const system of pool) {
            if (selected.includes(system))
                continue;
            const score = Math.min(...selected.map((chosen) => axialDistance(system, chosen)));
            if (score > bestScore) {
                bestScore = score;
                best = system;
            }
        }
        if (!best)
            break;
        selected.push(best);
    }
    return selected;
}
//# sourceMappingURL=map.js.map