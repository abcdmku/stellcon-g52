import { CORE_RESOURCE_TYPES, DEFAULT_CONFIG, HOMEWORLD_FLEETS, MAP_SIZES, PHASES, PLAYER_COLORS, POWERUPS, RESOURCE_TYPES, RESOLUTION_TRAVEL_MS, } from "./constants.js";
import { generateGalaxy, pickHomeworlds, rollResourcesForTier } from "./map.js";
import { clamp, mulberry32, rollDie, seedToInt } from "./utils.js";
function blankOrders() {
    return { placements: {}, moves: [], powerups: [], research: [] };
}
function now() {
    return Date.now();
}
function ceveronForTier(tier) {
    const clampedTier = Math.max(0, Math.min(3, Math.floor(tier ?? 0)));
    return clampedTier;
}
export function normalizeCeveron(game) {
    for (const system of game.systems) {
        system.resources ||= initResources(0);
        system.resources.ceveron = ceveronForTier(system.tier ?? 0);
    }
    if (game.phase === PHASES.planning) {
        for (const player of Object.values(game.players)) {
            const income = computeIncome(game, player.id);
            player.income = income.totals;
        }
    }
}
export function createGame({ id, config = {}, seed = "stellcon" } = {}) {
    const gameId = typeof id === "string" && id.length > 0
        ? id
        : (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
    const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
    const size = MAP_SIZES[merged.mapSize] || MAP_SIZES.medium;
    const { systems, links } = generateGalaxy({ seed, width: size.width, height: size.height });
    return {
        id: gameId,
        seed,
        config: merged,
        createdAt: now(),
        turn: 1,
        phase: PHASES.planning,
        turnEndsAt: null,
        systems,
        links,
        players: {},
        log: [],
        winnerId: null,
    };
}
const NEIGHBOR_OFFSETS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function systemId(q, r) {
    return `s${q}_${r}`;
}
function addLink(links, fromId, toId) {
    links[fromId] ||= [];
    links[toId] ||= [];
    if (!links[fromId].includes(toId))
        links[fromId].push(toId);
    if (!links[toId].includes(fromId))
        links[toId].push(fromId);
}
function rollFleetsForTier(tier, rand) {
    const clampedTier = Math.max(0, Math.min(3, Math.floor(tier)));
    const ranges = [
        { min: 0, max: 2 }, // tier 0
        { min: 1, max: 3 }, // tier 1
        { min: 2, max: 5 }, // tier 2
        { min: 0, max: 0 }, // tier 3 (homeworld fleets are set separately)
    ];
    const range = ranges[clampedTier];
    return range.min + Math.floor(rand() * (range.max - range.min + 1));
}
function ensureSystem(game, { q, r, tier, rand }) {
    const id = systemId(q, r);
    const existing = game.systems.find((system) => system.id === id);
    if (existing)
        return existing;
    const system = {
        id,
        q,
        r,
        tier,
        resources: rollResourcesForTier(tier, rand),
        ownerId: null,
        fleets: rollFleetsForTier(tier, rand),
        defenseNetTurns: 0,
        terraformed: false,
    };
    game.systems.push(system);
    game.links[id] ||= [];
    for (const offset of NEIGHBOR_OFFSETS) {
        const neighborId = systemId(q + offset.q, r + offset.r);
        if (game.links[neighborId])
            addLink(game.links, id, neighborId);
    }
    return system;
}
function pickPlayerColor(game, requested) {
    const allowedLower = PLAYER_COLORS.map((value) => value.toLowerCase());
    const used = new Set(Object.values(game.players).map((player) => String(player.color || "").toLowerCase()));
    const desired = String(requested || "").toLowerCase();
    if (desired) {
        const desiredIndex = allowedLower.indexOf(desired);
        if (desiredIndex < 0)
            throw new Error("Invalid color");
        if (used.has(desired))
            throw new Error("Color already taken");
        return PLAYER_COLORS[desiredIndex];
    }
    const next = allowedLower.find((value) => !used.has(value));
    if (next)
        return PLAYER_COLORS[allowedLower.indexOf(next)];
    return PLAYER_COLORS[Object.keys(game.players).length % PLAYER_COLORS.length];
}
export function addPlayer(game, { id, name, color: requestedColor } = {}) {
    if (Object.keys(game.players).length >= game.config.maxPlayers) {
        throw new Error("Game is full");
    }
    const playerId = typeof id === "string" && id.length > 0
        ? id
        : (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
    const color = pickPlayerColor(game, requestedColor);
    const powerups = Object.fromEntries(Object.keys(POWERUPS).map((key) => [key, { unlocked: false, charges: 0 }]));
    game.players[playerId] = {
        id: playerId,
        name: String(name || ""),
        color,
        homeSystemId: null,
        income: initResources(0),
        research: initResources(0),
        powerups,
        fleetsToPlace: 0,
        wormholeTurns: 0,
        alliances: {},
        connected: true,
        locked: false,
        orders: blankOrders(),
    };
    return game.players[playerId];
}
export function assignHomeworlds(game) {
    const rand = mulberry32(seedToInt(game.seed));
    const players = Object.values(game.players);
    const tier3Candidates = game.systems.filter((system) => (system.tier ?? 0) >= 3);
    const tier2Candidates = game.systems.filter((system) => (system.tier ?? 0) >= 2);
    const pool = tier3Candidates.length >= players.length ? tier3Candidates : tier2Candidates.length >= players.length ? tier2Candidates : game.systems;
    const homes = pickHomeworlds(pool, players.length, rand);
    players.forEach((player, index) => {
        const system = homes[index];
        if (!system)
            return;
        system.tier = 3;
        system.resources = rollResourcesForTier(3, rand);
        system.ownerId = player.id;
        system.fleets = HOMEWORLD_FLEETS;
        player.homeSystemId = system.id;
        for (const offset of NEIGHBOR_OFFSETS) {
            ensureSystem(game, {
                q: system.q + offset.q,
                r: system.r + offset.r,
                tier: 0,
                rand,
            });
        }
    });
}
export function startGame(game) {
    const players = Object.values(game.players);
    const size = MAP_SIZES[game.config.mapSize] || MAP_SIZES.medium;
    const { systems, links } = generateGalaxy({ seed: game.seed, width: size.width, height: size.height, homeworldCount: players.length });
    game.systems = systems;
    game.links = links;
    assignHomeworlds(game);
    startPlanningPhase(game);
}
export function initResources(value) {
    const resources = {};
    for (const key of RESOURCE_TYPES)
        resources[key] = value;
    return resources;
}
export function computeIncome(game, playerId) {
    const totals = initResources(0);
    let fleets = 0;
    for (const system of game.systems) {
        if (system.ownerId !== playerId)
            continue;
        for (const key of RESOURCE_TYPES) {
            totals[key] += system.resources[key];
        }
        fleets += Math.min(...CORE_RESOURCE_TYPES.map((key) => system.resources[key] || 0));
    }
    const min = Math.min(...CORE_RESOURCE_TYPES.map((key) => totals[key]));
    const surplus = initResources(0);
    for (const key of CORE_RESOURCE_TYPES)
        surplus[key] = Math.max(0, totals[key] - min);
    surplus.ceveron = totals.ceveron;
    return { totals, fleets, surplus };
}
export function startPlanningPhase(game) {
    game.phase = PHASES.planning;
    game.turnEndsAt = now() + game.config.turnSeconds * 1000;
    for (const player of Object.values(game.players)) {
        const income = computeIncome(game, player.id);
        player.income = income.totals;
        player.fleetsToPlace = income.fleets;
        for (const key of RESOURCE_TYPES) {
            player.research[key] = Math.min(20, (player.research[key] || 0) + income.surplus[key]);
        }
        player.orders = blankOrders();
        player.locked = false;
    }
}
export function submitOrders(game, playerId, orders) {
    const player = game.players[playerId];
    if (!player)
        return;
    if (game.phase !== PHASES.planning)
        return;
    if (player.locked)
        return;
    const placements = orders && typeof orders.placements === "object" && orders.placements !== null && !Array.isArray(orders.placements)
        ? orders.placements
        : {};
    const moves = Array.isArray(orders?.moves) ? orders.moves : [];
    const powerups = Array.isArray(orders?.powerups) ? orders.powerups : [];
    const research = Array.isArray(orders?.research) ? orders.research : [];
    player.orders = {
        placements,
        moves,
        powerups,
        research,
    };
}
export function lockIn(game, playerId) {
    const player = game.players[playerId];
    if (!player)
        return false;
    if (game.phase !== PHASES.planning)
        return false;
    player.locked = true;
    return Object.values(game.players).every((p) => p.locked);
}
function buildRevealedMoves(game) {
    const revealed = [];
    for (const player of Object.values(game.players)) {
        for (const move of player.orders.moves || []) {
            revealed.push({
                playerId: player.id,
                fromId: move.fromId,
                toId: move.toId,
                count: Number(move.count) || 0,
            });
        }
    }
    return revealed;
}
export function beginResolution(game) {
    if (game.phase !== PHASES.planning)
        return;
    game.phase = PHASES.resolving;
    game.turnEndsAt = null;
    game.revealedMoves = buildRevealedMoves(game);
    game.resolutionStartedAt = now();
    const rand = mulberry32(seedToInt(`${game.seed}-${game.turn}`));
    applyPlacements(game);
    applyResearchActions(game);
    applyPowerups(game, rand);
    planResolution(game, rand);
}
export function finalizeResolution(game) {
    const currentPhase = game.phase;
    if (currentPhase !== PHASES.resolving)
        return;
    if (game.resolutionPlan?.systemUpdates) {
        applySystemUpdates(game, game.resolutionPlan.systemUpdates);
    }
    else {
        const rand = mulberry32(seedToInt(`${game.seed}-${game.turn}`));
        resolveMovements(game, rand);
    }
    tickDurations(game);
    checkVictory(game);
    delete game.revealedMoves;
    delete game.resolutionStartedAt;
    delete game.resolutionEndsAt;
    delete game.resolutionBattles;
    delete game.resolutionPlan;
    if (game.phase !== PHASES.complete) {
        game.turn += 1;
        startPlanningPhase(game);
    }
}
function cloneSystems(systems) {
    return systems.map((system) => ({
        ...system,
        resources: { ...system.resources },
    }));
}
function applySystemUpdates(game, updates) {
    const map = new Map(game.systems.map((system) => [system.id, system]));
    for (const update of updates) {
        const system = map.get(update.id);
        if (!system)
            continue;
        system.ownerId = update.ownerId;
        system.fleets = update.fleets;
        system.defenseNetTurns = update.defenseNetTurns;
    }
}
function coinFlipSurvivors(count, rand) {
    let survivors = 0;
    for (let i = 0; i < count; i += 1) {
        if (rand() >= 0.5)
            survivors += 1;
    }
    return survivors;
}
function resolveCoinFlipCombat(attackerStart, defenderStart, rand) {
    let attacker = attackerStart;
    let defender = defenderStart;
    const rounds = [];
    while (attacker > 0 && defender > 0) {
        const attackerNext = coinFlipSurvivors(attacker, rand);
        const defenderNext = coinFlipSurvivors(defender, rand);
        let attackerLoss = attacker - attackerNext;
        let defenderLoss = defender - defenderNext;
        attacker = attackerNext;
        defender = defenderNext;
        if (attackerLoss === 0 && defenderLoss === 0 && attacker + defender > 0) {
            const total = attacker + defender;
            const pick = rand() * total;
            if (pick < attacker && attacker > 0)
                attacker -= 1;
            else if (defender > 0)
                defender -= 1;
        }
        rounds.push({ attacker, defender });
    }
    return { rounds, attackerRemaining: attacker, defenderRemaining: defender };
}
function resolveMultiAttacker(attackerEntries, rand) {
    const attackers = attackerEntries.map((entry) => ({ ...entry }));
    const rounds = [];
    while (attackers.filter((a) => a.fleets > 0).length > 1) {
        let anyLoss = false;
        for (const attacker of attackers) {
            const next = coinFlipSurvivors(attacker.fleets, rand);
            if (next !== attacker.fleets)
                anyLoss = true;
            attacker.fleets = next;
        }
        if (!anyLoss) {
            const alive = attackers.filter((a) => a.fleets > 0);
            if (alive.length) {
                const pickIndex = Math.floor(rand() * alive.length);
                alive[pickIndex].fleets = Math.max(0, alive[pickIndex].fleets - 1);
            }
        }
        rounds.push(attackers.map((a) => ({ playerId: a.playerId, fleets: a.fleets })));
        for (let i = attackers.length - 1; i >= 0; i -= 1) {
            if (attackers[i].fleets <= 0)
                attackers.splice(i, 1);
        }
    }
    const winner = attackers[0] || { playerId: null, fleets: 0 };
    return { rounds, winner };
}
function planResolution(game, rand) {
    const systems = cloneSystems(game.systems);
    const systemMap = new Map(systems.map((system) => [system.id, system]));
    const playerMap = new Map(Object.values(game.players).map((player) => [player.id, { ...player }]));
    const incoming = new Map();
    const updates = [];
    const battles = [];
    const canMoveWithinOwned = (fromId, toId, playerId) => {
        if (fromId === toId)
            return true;
        const visited = new Set([fromId]);
        const queue = [fromId];
        while (queue.length) {
            const current = queue.shift();
            if (!current)
                continue;
            const neighbors = game.links[current] || [];
            for (const nextId of neighbors) {
                if (visited.has(nextId))
                    continue;
                const next = systemMap.get(nextId);
                if (!next)
                    continue;
                if (next.ownerId !== playerId)
                    continue;
                if (nextId === toId)
                    return true;
                visited.add(nextId);
                queue.push(nextId);
            }
        }
        return false;
    };
    for (const player of Object.values(game.players)) {
        const moves = player.orders.moves || [];
        for (const move of moves) {
            const from = systemMap.get(move.fromId);
            const to = systemMap.get(move.toId);
            if (!from || !to)
                continue;
            if (from.ownerId !== player.id)
                continue;
            if (to.ownerId && isAllied(game, player.id, to.ownerId) && to.ownerId !== player.id)
                continue;
            const isFriendlyTransfer = to.ownerId === player.id;
            const isNeighbor = game.links[from.id]?.includes(to.id);
            const canOwnedPath = isFriendlyTransfer && canMoveWithinOwned(from.id, to.id, player.id);
            if (!isNeighbor && player.wormholeTurns <= 0 && !canOwnedPath)
                continue;
            if (to.ownerId && to.ownerId !== player.id && to.defenseNetTurns > 0)
                continue;
            const amount = clamp(Number(move.count) || 0, 0, from.fleets);
            if (amount <= 0)
                continue;
            from.fleets -= amount;
            if (from.fleets === 0 && from.ownerId) {
                from.ownerId = null;
                from.defenseNetTurns = 0;
                const simPlayer = playerMap.get(player.id);
                if (simPlayer && simPlayer.wormholeTurns > 0)
                    simPlayer.wormholeTurns = 0;
            }
            if (to.ownerId === player.id) {
                to.fleets += amount;
                continue;
            }
            if (!incoming.has(to.id))
                incoming.set(to.id, {});
            const bucket = incoming.get(to.id);
            bucket[player.id] = (bucket[player.id] || 0) + amount;
        }
    }
    for (const [targetId, attackersById] of incoming.entries()) {
        const target = systemMap.get(targetId);
        if (!target)
            continue;
        if (target.defenseNetTurns > 0)
            continue;
        const attackerEntries = Object.entries(attackersById)
            .map(([playerId, fleets]) => ({ playerId, fleets }))
            .filter((entry) => entry.fleets > 0);
        let attackerWinner = attackerEntries[0] || { playerId: null, fleets: 0 };
        let attackerSkirmishRounds = [];
        if (attackerEntries.length > 1) {
            const multi = resolveMultiAttacker(attackerEntries, rand);
            attackerWinner = multi.winner;
            attackerSkirmishRounds = multi.rounds;
        }
        const defenderOwnerId = target.ownerId;
        const defenderFleets = target.fleets;
        const defenderId = defenderOwnerId || null;
        const defenderColorId = defenderOwnerId || null;
        const combat = resolveCoinFlipCombat(attackerWinner.fleets, defenderFleets, rand);
        const combatRounds = combat.rounds.map((round) => ({ attacker: round.attacker, defender: round.defender }));
        const attackerRemaining = combat.attackerRemaining;
        const defenderRemaining = combat.defenderRemaining;
        let winnerId = null;
        let winnerFleets = 0;
        if (attackerRemaining > 0 && defenderRemaining === 0) {
            winnerId = attackerWinner.playerId;
            winnerFleets = attackerRemaining;
        }
        else if (defenderRemaining > 0 && attackerRemaining === 0) {
            winnerId = defenderOwnerId;
            winnerFleets = defenderRemaining;
        }
        if (!defenderOwnerId && defenderFleets === 0) {
            winnerId = attackerWinner.playerId;
            winnerFleets = attackerWinner.fleets;
        }
        if (!winnerId) {
            target.ownerId = null;
            target.fleets = 0;
        }
        else {
            target.ownerId = winnerId;
            target.fleets = winnerFleets;
        }
        battles.push({
            targetId,
            defenderId,
            defenderColorId,
            attackerId: attackerWinner.playerId,
            attackerStartFleets: attackerWinner.fleets,
            attackerSkirmishRounds,
            rounds: combatRounds,
            winnerId: target.ownerId,
            winnerFleets: target.fleets,
            defenderStartFleets: defenderFleets,
        });
    }
    for (const system of systems) {
        updates.push({
            id: system.id,
            ownerId: system.ownerId,
            fleets: system.fleets,
            defenseNetTurns: system.defenseNetTurns,
        });
    }
    const startOffsetMs = Math.max(0, RESOLUTION_TRAVEL_MS);
    let maxDurationMs = 1000;
    const plannedBattles = battles.map((battle) => {
        const skirmishMs = (battle.attackerSkirmishRounds?.length || 0) * 1000;
        const combatMs = (battle.rounds?.length || 0) * 1000;
        const durationMs = Math.max(1000, skirmishMs + combatMs);
        if (durationMs > maxDurationMs)
            maxDurationMs = durationMs;
        return { ...battle, startOffsetMs, durationMs };
    });
    game.resolutionBattles = plannedBattles;
    game.resolutionEndsAt = game.resolutionStartedAt + Math.max(1200, startOffsetMs + maxDurationMs);
    game.resolutionPlan = { systemUpdates: updates };
}
function applyResearchActions(game) {
    // Powerups are now used directly via resource thresholds (no unlock/craft queue).
}
export function resolveTurn(game) {
    beginResolution(game);
    finalizeResolution(game);
}
function applyPlacements(game) {
    for (const player of Object.values(game.players)) {
        let remaining = player.fleetsToPlace;
        for (const [systemId, amount] of Object.entries(player.orders.placements)) {
            if (remaining <= 0)
                break;
            const system = game.systems.find((entry) => entry.id === systemId);
            if (!system || system.ownerId !== player.id)
                continue;
            const count = clamp(Number(amount) || 0, 0, remaining);
            system.fleets += count;
            remaining -= count;
        }
        player.fleetsToPlace = 0;
    }
}
function applyPowerups(game, rand) {
    const players = Object.values(game.players);
    const actionsByPlayer = new Map(players.map((player) => [player.id, player.orders.powerups || []]));
    const canAttackFromOwned = (player, target) => {
        if (!player || !target)
            return false;
        if ((player.wormholeTurns || 0) > 0)
            return true;
        for (const system of game.systems) {
            if (system.ownerId !== player.id)
                continue;
            if ((game.links[system.id] || []).includes(target.id))
                return true;
        }
        return false;
    };
    const canSpend = (player, powerup) => {
        if (!player || !powerup)
            return false;
        return (player.research?.[powerup.resource] || 0) >= powerup.cost;
    };
    const spend = (player, powerup) => {
        if (!canSpend(player, powerup))
            return false;
        player.research[powerup.resource] -= powerup.cost;
        return true;
    };
    const getTarget = (action) => game.systems.find((system) => system.id === action.targetId);
    const applySupportPowerups = (player, action) => {
        const powerup = POWERUPS[action.type];
        if (!powerup)
            return;
        if (!canSpend(player, powerup))
            return;
        const target = getTarget(action);
        if (!target)
            return;
        if (action.type === "terraform") {
            const tier = target.tier ?? 0;
            if (target.ownerId === player.id && !target.terraformed && tier <= 1) {
                const nextTier = Math.min(2, tier + 1);
                target.resources = rollResourcesForTier(nextTier, rand);
                target.tier = nextTier;
                target.terraformed = true;
                spend(player, powerup);
            }
            return;
        }
        if (action.type === "defenseNet") {
            if (target.ownerId === player.id) {
                target.defenseNetTurns = powerup.duration;
                spend(player, powerup);
            }
            return;
        }
        if (action.type === "wormhole") {
            if (target.ownerId === player.id) {
                player.wormholeTurns = powerup.duration;
                spend(player, powerup);
            }
        }
    };
    const applyAttackPowerups = (player, action) => {
        const powerup = POWERUPS[action.type];
        if (!powerup)
            return;
        if (!canSpend(player, powerup))
            return;
        const target = getTarget(action);
        if (!target)
            return;
        if (action.type === "stellarBomb") {
            if (target.ownerId === player.id)
                return;
            if (target.ownerId && isAllied(game, player.id, target.ownerId))
                return;
            if (!canAttackFromOwned(player, target))
                return;
            if (target.defenseNetTurns > 0)
                return;
            target.fleets = Math.max(0, Math.floor((target.fleets || 0) / 2));
            spend(player, powerup);
        }
    };
    for (const player of players) {
        for (const action of actionsByPlayer.get(player.id) || []) {
            if (action.type === "stellarBomb")
                continue;
            applySupportPowerups(player, action);
        }
    }
    for (const player of players) {
        for (const action of actionsByPlayer.get(player.id) || []) {
            if (action.type !== "stellarBomb")
                continue;
            applyAttackPowerups(player, action);
        }
    }
}
function resolveMovements(game, rand) {
    const systemById = new Map(game.systems.map((system) => [system.id, system]));
    const canMoveWithinOwned = (fromId, toId, playerId) => {
        if (fromId === toId)
            return true;
        const visited = new Set([fromId]);
        const queue = [fromId];
        while (queue.length) {
            const current = queue.shift();
            const neighbors = game.links[current] || [];
            for (const nextId of neighbors) {
                if (visited.has(nextId))
                    continue;
                const next = systemById.get(nextId);
                if (!next)
                    continue;
                if (next.ownerId !== playerId)
                    continue;
                if (nextId === toId)
                    return true;
                visited.add(nextId);
                queue.push(nextId);
            }
        }
        return false;
    };
    const incoming = new Map();
    for (const player of Object.values(game.players)) {
        const moves = player.orders.moves || [];
        for (const move of moves) {
            const from = systemById.get(move.fromId);
            const to = systemById.get(move.toId);
            if (!from || !to)
                continue;
            if (from.ownerId !== player.id)
                continue;
            if (to.ownerId && isAllied(game, player.id, to.ownerId) && to.ownerId !== player.id)
                continue;
            const isFriendlyTransfer = to.ownerId === player.id;
            const isNeighbor = game.links[from.id]?.includes(to.id);
            const canOwnedPath = isFriendlyTransfer && canMoveWithinOwned(from.id, to.id, player.id);
            if (!isNeighbor && player.wormholeTurns <= 0 && !canOwnedPath)
                continue;
            if (to.ownerId && to.ownerId !== player.id && to.defenseNetTurns > 0)
                continue;
            const amount = clamp(Number(move.count) || 0, 0, from.fleets);
            if (amount <= 0)
                continue;
            from.fleets -= amount;
            if (to.ownerId === player.id) {
                to.fleets += amount;
                continue;
            }
            if (!incoming.has(to.id)) {
                incoming.set(to.id, {});
            }
            const targetIncoming = incoming.get(to.id);
            targetIncoming[player.id] = (targetIncoming[player.id] || 0) + amount;
        }
    }
    for (const [targetId, attackers] of incoming.entries()) {
        const target = game.systems.find((system) => system.id === targetId);
        if (!target)
            continue;
        if (target.defenseNetTurns > 0) {
            continue;
        }
        const candidates = [];
        for (const [playerId, count] of Object.entries(attackers)) {
            candidates.push({ playerId, fleets: count, isDefender: false });
        }
        if (target.ownerId) {
            candidates.push({ playerId: target.ownerId, fleets: target.fleets, isDefender: true });
        }
        else if (target.fleets > 0) {
            candidates.push({ playerId: null, fleets: target.fleets, isDefender: true });
        }
        if (candidates.length === 1 && !candidates[0].isDefender) {
            const winner = candidates[0];
            target.ownerId = winner.playerId;
            target.fleets = winner.fleets;
            continue;
        }
        let best = null;
        for (const candidate of candidates) {
            const score = candidate.fleets + rollDie(10, rand);
            if (!best || score > best.score || (score === best.score && candidate.isDefender)) {
                best = { ...candidate, score };
            }
        }
        if (!best)
            continue;
        if (best.isDefender) {
            target.fleets = best.fleets;
        }
        else {
            target.ownerId = best.playerId;
            target.fleets = best.fleets;
        }
    }
}
function tickDurations(game) {
    for (const system of game.systems) {
        if (system.defenseNetTurns > 0) {
            system.defenseNetTurns = Math.max(0, system.defenseNetTurns - 1);
        }
    }
    for (const player of Object.values(game.players)) {
        if (player.wormholeTurns > 0) {
            player.wormholeTurns -= 1;
        }
        for (const [allyId, turns] of Object.entries(player.alliances)) {
            if (turns <= 1) {
                delete player.alliances[allyId];
            }
            else {
                player.alliances[allyId] = turns - 1;
            }
        }
    }
}
function checkVictory(game) {
    if (game.turn >= game.config.maxTurns) {
        game.phase = PHASES.complete;
        game.winnerId = determineLeader(game);
        return;
    }
    const owners = new Set(game.systems.filter((system) => system.ownerId).map((system) => system.ownerId));
    if (owners.size === 1) {
        game.phase = PHASES.complete;
        game.winnerId = [...owners][0] || null;
    }
}
function determineLeader(game) {
    const scores = new Map();
    for (const system of game.systems) {
        if (!system.ownerId)
            continue;
        scores.set(system.ownerId, (scores.get(system.ownerId) || 0) + 1);
    }
    let best = null;
    for (const [playerId, count] of scores.entries()) {
        if (!best || count > best.count) {
            best = { playerId, count };
        }
    }
    return best ? best.playerId : null;
}
export function setAlliance(game, fromId, toId) {
    const from = game.players[fromId];
    const to = game.players[toId];
    if (!from || !to)
        return;
    from.alliances[toId] = 3;
    to.alliances[fromId] = 3;
}
export function isAllied(game, playerId, otherId) {
    if (!playerId || !otherId || playerId === otherId)
        return false;
    const player = game.players[playerId];
    return Boolean(player?.alliances[otherId]);
}
export function redactGameState(game, viewerId) {
    const reveal = game.phase === PHASES.resolving ? game.revealedMoves : undefined;
    const players = Object.fromEntries(Object.entries(game.players).map(([id, player]) => {
        const orders = game.phase === PHASES.resolving || id === viewerId ? player.orders : blankOrders();
        return [
            id,
            {
                ...player,
                orders,
            },
        ];
    }));
    return {
        id: game.id,
        seed: game.seed,
        config: game.config,
        createdAt: game.createdAt,
        turn: game.turn,
        phase: game.phase,
        turnEndsAt: game.turnEndsAt,
        systems: game.systems,
        links: game.links,
        players,
        log: game.log,
        winnerId: game.winnerId,
        revealedMoves: reveal,
        resolutionStartedAt: game.resolutionStartedAt,
        resolutionEndsAt: game.resolutionEndsAt,
        resolutionBattles: game.resolutionBattles,
    };
}
//# sourceMappingURL=game.js.map