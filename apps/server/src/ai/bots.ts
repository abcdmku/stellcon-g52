import {
  CORE_RESOURCE_TYPES,
  POWERUPS,
  computeIncome,
  isAllied,
  mulberry32,
  seedToInt,
} from "@stellcon/shared";
import type { BotDifficulty, GameState, Orders, PowerupOrder, ResourceMap, ResourceType, SystemState } from "@stellcon/shared";

type PlayerEconomy = {
  totals: ResourceMap;
  production: number;
};

function blankOrders(): Orders {
  return { placements: {}, moves: [], powerups: [], research: [] };
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function productionFromTotals(totals: ResourceMap) {
  return Math.min(...CORE_RESOURCE_TYPES.map((key) => totals[key] || 0));
}

function getActiveWormholes(game: GameState) {
  const wormholes = Array.isArray(game.wormholes) ? game.wormholes : [];
  return wormholes.filter((w) => (w.turnsRemaining || 0) > 0);
}

function hasActiveWormhole(game: GameState, a: string, b: string) {
  return getActiveWormholes(game).some(
    (w) => (w.fromId === a && w.toId === b) || (w.fromId === b && w.toId === a)
  );
}

function isAttackableTarget(game: GameState, playerId: string, target: SystemState) {
  if (target.ownerId === playerId) return false;
  if (target.ownerId && isAllied(game, playerId, target.ownerId)) return false;
  if (target.ownerId && target.defenseNetTurns > 0) return false;
  return true;
}

function resourceWeightsFor(playerTotals: ResourceMap, difficulty: BotDifficulty): Record<ResourceType, number> {
  const min = Math.min(...CORE_RESOURCE_TYPES.map((key) => playerTotals[key] || 0));
  const weights = {} as Record<ResourceType, number>;
  const bottleneckWeight = difficulty === "hard" ? 3 : difficulty === "medium" ? 2 : 1.25;
  for (const key of CORE_RESOURCE_TYPES) {
    weights[key] = (playerTotals[key] || 0) === min ? bottleneckWeight : 1;
  }
  return weights;
}

function weightedResourceScore(resources: ResourceMap, weights: Record<ResourceType, number>) {
  let score = 0;
  for (const key of CORE_RESOURCE_TYPES) {
    score += (resources[key] || 0) * (weights[key] || 1);
  }
  return score;
}

function estimatedWinProb(attacker: number, defender: number) {
  const a = Math.max(0, attacker);
  const d = Math.max(0, defender);
  if (a <= 0 && d <= 0) return 0.5;
  if (d <= 0) return 1;
  if (a <= 0) return 0;
  const z = (a - d) / Math.sqrt(a + d + 1);
  return 1 / (1 + Math.exp(-z));
}

function fleetsNeededForProbability(defender: number, desiredProb: number) {
  const d = Math.max(0, defender);
  if (d === 0) return 1;
  const targetProb = Math.max(0.05, Math.min(0.95, desiredProb));
  for (let a = Math.max(1, d); a < d + 60; a += 1) {
    if (estimatedWinProb(a, d) >= targetProb) return a;
  }
  return d + 60;
}

function computeEconomies(game: GameState) {
  const economy = new Map<string, PlayerEconomy>();
  for (const playerId of Object.keys(game.players)) {
    const income = computeIncome(game, playerId);
    economy.set(playerId, { totals: income.totals, production: income.fleets });
  }
  return economy;
}

function computeThreat(game: GameState, playerId: string, system: SystemState, systemById: Map<string, SystemState>) {
  let threat = 0;
  for (const neighborId of game.links[system.id] || []) {
    const neighbor = systemById.get(neighborId);
    if (!neighbor) continue;
    if (!neighbor.ownerId) continue;
    if (neighbor.ownerId === playerId) continue;
    if (isAllied(game, playerId, neighbor.ownerId)) continue;
    threat += Math.max(0, neighbor.fleets || 0);
  }
  return threat;
}

function ownedComponents(game: GameState, playerId: string, systemById: Map<string, SystemState>) {
  const owned = new Set<string>(game.systems.filter((s) => s.ownerId === playerId).map((s) => s.id));
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const id of owned) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    const component: string[] = [];
    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      component.push(current);
      for (const nextId of game.links[current] || []) {
        if (!owned.has(nextId)) continue;
        if (visited.has(nextId)) continue;
        if (!systemById.get(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    components.push(component);
  }

  return components;
}

function pickTerraformTarget(game: GameState, playerId: string) {
  let best: SystemState | null = null;
  let bestScore = Infinity;
  for (const system of game.systems) {
    if (system.ownerId !== playerId) continue;
    if (system.terraformed) continue;
    const tier = system.tier ?? 0;
    if (tier > 1) continue;
    const total = CORE_RESOURCE_TYPES.reduce((sum, key) => sum + (system.resources?.[key] || 0), 0);
    if (total < bestScore) {
      bestScore = total;
      best = system;
    }
  }
  return best;
}

function pickDefenseTarget(
  game: GameState,
  playerId: string,
  systemById: Map<string, SystemState>,
  productionLossIfLost: Map<string, number>
) {
  let best: { system: SystemState; score: number } | null = null;
  for (const system of game.systems) {
    if (system.ownerId !== playerId) continue;
    if ((system.defenseNetTurns || 0) > 0) continue;
    const threat = computeThreat(game, playerId, system, systemById);
    const critical = productionLossIfLost.get(system.id) || 0;
    const score = threat * 1.2 + critical * 6 + (system.id === game.players[playerId]?.homeSystemId ? 6 : 0);
    if (!best || score > best.score) best = { system, score };
  }
  if (best && best.score >= 6) return best.system;
  return null;
}

function botRand(game: GameState, playerId: string, difficulty: BotDifficulty) {
  return mulberry32(seedToInt(`${game.seed}:bot:${difficulty}:${playerId}:${game.turn}`));
}

function planEasy(game: GameState, playerId: string): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();
  const rand = botRand(game, playerId, "easy");
  const owned = game.systems.filter((s) => s.ownerId === playerId);
  if (!owned.length) return blankOrders();

  const placements: Record<string, number> = {};
  let remaining = Math.max(0, player.fleetsToPlace || 0);
  while (remaining > 0) {
    const pick = owned[Math.floor(rand() * owned.length)];
    placements[pick.id] = (placements[pick.id] || 0) + 1;
    remaining -= 1;
  }

  const moves: Orders["moves"] = [];
  for (const from of owned) {
    const projected = (from.fleets || 0) + (placements[from.id] || 0);
    if (projected <= 2) continue;
    if (rand() > 0.35) continue;
    const candidates = (game.links[from.id] || [])
      .map((id) => game.systems.find((s) => s.id === id))
      .filter(Boolean) as SystemState[];
    const targets = candidates.filter((s) => isAttackableTarget(game, playerId, s));
    if (!targets.length) continue;
    const target = targets[Math.floor(rand() * targets.length)];
    const send = clampInt(projected * (0.3 + rand() * 0.5), 1, projected - 1);
    moves.push({ fromId: from.id, toId: target.id, count: send });
  }

  return { placements, moves, powerups: [], research: [] };
}

function planMedium(game: GameState, playerId: string): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();
  const rand = botRand(game, playerId, "medium");

  const systemById = new Map(game.systems.map((s) => [s.id, s]));
  const owned = game.systems.filter((s) => s.ownerId === playerId);
  if (!owned.length) return blankOrders();

  const economy = computeIncome(game, playerId);
  const weights = resourceWeightsFor(economy.totals, "medium");

  const frontier = owned.filter((from) =>
    (game.links[from.id] || []).some((neighborId) => {
      const neighbor = systemById.get(neighborId);
      return neighbor ? isAttackableTarget(game, playerId, neighbor) : false;
    })
  );

  const placements: Record<string, number> = {};
  let remaining = Math.max(0, player.fleetsToPlace || 0);
  const placementTargets = frontier.length ? frontier : owned;
  while (remaining > 0) {
    const pick = placementTargets[Math.floor(rand() * placementTargets.length)];
    placements[pick.id] = (placements[pick.id] || 0) + 1;
    remaining -= 1;
  }

  const powerups: PowerupOrder[] = [];
  if ((player.research?.terrain || 0) >= POWERUPS.terraform.cost) {
    const target = pickTerraformTarget(game, playerId);
    if (target && rand() < 0.35) powerups.push({ type: "terraform", targetId: target.id });
  }

  if ((player.research?.crystal || 0) >= POWERUPS.defenseNet.cost && rand() < 0.35) {
    const defenseTarget = owned.find((s) => (s.defenseNetTurns || 0) <= 0) || null;
    if (defenseTarget) powerups.push({ type: "defenseNet", targetId: defenseTarget.id });
  }

  const moves: Orders["moves"] = [];
  for (const from of frontier) {
    const projected = (from.fleets || 0) + (placements[from.id] || 0);
    if (projected <= 2) continue;
    const targets = (game.links[from.id] || [])
      .map((id) => systemById.get(id))
      .filter((s): s is SystemState => Boolean(s))
      .filter((s) => isAttackableTarget(game, playerId, s));
    if (!targets.length) continue;

    let best: { target: SystemState; score: number } | null = null;
    for (const target of targets) {
      const defender = Math.max(0, target.fleets || 0);
      const need = fleetsNeededForProbability(defender, target.ownerId ? 0.62 : 0.66);
      const canSend = Math.max(0, projected - 1);
      if (canSend <= 0) continue;
      const send = Math.min(canSend, need);
      const winProb = estimatedWinProb(send, defender);
      const value = weightedResourceScore(target.resources, weights);
      const score = value * winProb - defender * 0.35;
      if (!best || score > best.score) best = { target, score };
    }

    if (!best || best.score < 1) continue;
    const defender = Math.max(0, best.target.fleets || 0);
    const need = fleetsNeededForProbability(defender, best.target.ownerId ? 0.62 : 0.66);
    const send = clampInt(Math.min(projected - 1, need), 1, projected - 1);
    if (send <= 0) continue;
    moves.push({ fromId: from.id, toId: best.target.id, count: send });
  }

  return { placements, moves, powerups, research: [] };
}

function planHard(game: GameState, playerId: string): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();
  const rand = botRand(game, playerId, "hard");

  const systemById = new Map(game.systems.map((s) => [s.id, s]));
  const ownedSystems = game.systems.filter((s) => s.ownerId === playerId);
  if (!ownedSystems.length) return blankOrders();

  const economies = computeEconomies(game);
  const selfEco = economies.get(playerId);
  if (!selfEco) return blankOrders();

  const weights = resourceWeightsFor(selfEco.totals, "hard");
  const remainingTurns = Math.max(1, (game.config?.maxTurns || 20) - (game.turn || 1) + 1);

  const productionLossIfLost = new Map<string, number>();
  for (const system of ownedSystems) {
    const nextTotals = { ...selfEco.totals };
    for (const key of CORE_RESOURCE_TYPES) {
      nextTotals[key] = Math.max(0, (nextTotals[key] || 0) - (system.resources?.[key] || 0));
    }
    const nextProduction = productionFromTotals(nextTotals);
    productionLossIfLost.set(system.id, Math.max(0, selfEco.production - nextProduction));
  }

  const keepBySystem = new Map<string, number>();
  for (const system of ownedSystems) {
    const threat = computeThreat(game, playerId, system, systemById);
    const critical = productionLossIfLost.get(system.id) || 0;
    let keep = 1;
    keep += clampInt(threat * 0.25, 0, 6);
    keep += clampInt(critical * 2, 0, 6);
    if (system.id === player.homeSystemId) keep += 2;
    keepBySystem.set(system.id, keep);
  }

  const components = ownedComponents(game, playerId, systemById);

  const frontierTargetsByFrom = new Map<string, SystemState[]>();
  for (const from of ownedSystems) {
    const targets = (game.links[from.id] || [])
      .map((id) => systemById.get(id))
      .filter((s): s is SystemState => Boolean(s))
      .filter((s) => isAttackableTarget(game, playerId, s));
    frontierTargetsByFrom.set(from.id, targets);
  }

  const scoreCapture = (target: SystemState) => {
    const base = weightedResourceScore(target.resources, weights);
    const nextTotals = { ...selfEco.totals };
    for (const key of CORE_RESOURCE_TYPES) nextTotals[key] = (nextTotals[key] || 0) + (target.resources?.[key] || 0);
    const prodGain = Math.max(0, productionFromTotals(nextTotals) - selfEco.production);

    let enemyProdLoss = 0;
    const enemyId = target.ownerId;
    if (enemyId && enemyId !== playerId && !isAllied(game, playerId, enemyId)) {
      const enemyEco = economies.get(enemyId);
      if (enemyEco) {
        const nextEnemyTotals = { ...enemyEco.totals };
        for (const key of CORE_RESOURCE_TYPES) {
          nextEnemyTotals[key] = Math.max(0, (nextEnemyTotals[key] || 0) - (target.resources?.[key] || 0));
        }
        const nextEnemyProd = productionFromTotals(nextEnemyTotals);
        enemyProdLoss = Math.max(0, enemyEco.production - nextEnemyProd);
      }
    }

    const strategic = prodGain * 18 * remainingTurns + enemyProdLoss * 22 * remainingTurns;
    const tier = target.tier ?? 0;
    const tierBonus = tier >= 2 ? 3 : tier === 1 ? 1.5 : 0;
    return base * 1.1 + strategic + tierBonus;
  };

  const stagingByComponent = new Map<number, string>();
  components.forEach((component, index) => {
    let best: { id: string; score: number } | null = null;
    for (const id of component) {
      const system = systemById.get(id);
      if (!system) continue;
      const targets = frontierTargetsByFrom.get(id) || [];
      const bestTargetScore = targets.length ? Math.max(...targets.map(scoreCapture)) : 0;
      const threat = computeThreat(game, playerId, system, systemById);
      const score = bestTargetScore + (system.fleets || 0) * 0.6 - threat * 0.15 + (id === player.homeSystemId ? 4 : 0);
      if (!best || score > best.score) best = { id, score };
    }
    if (best) stagingByComponent.set(index, best.id);
  });

  const transfers: Orders["moves"] = [];
  const incomingTo = new Map<string, number>();

  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex];
    const stagingId = stagingByComponent.get(componentIndex);
    if (!stagingId) continue;
    for (const fromId of component) {
      if (fromId === stagingId) continue;
      const from = systemById.get(fromId);
      if (!from) continue;
      const keep = keepBySystem.get(fromId) || 1;
      const available = Math.max(0, (from.fleets || 0) - keep);
      if (available <= 0) continue;
      transfers.push({ fromId, toId: stagingId, count: available });
      incomingTo.set(stagingId, (incomingTo.get(stagingId) || 0) + available);
    }
  }

  const placements: Record<string, number> = {};
  const placementWeights = new Map<string, number>();
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const stagingId = stagingByComponent.get(componentIndex);
    if (!stagingId) continue;
    const system = systemById.get(stagingId);
    if (!system) continue;
    const targets = frontierTargetsByFrom.get(stagingId) || [];
    const bestTargetScore = targets.length ? Math.max(...targets.map(scoreCapture)) : 0;
    placementWeights.set(stagingId, 3 + bestTargetScore / 40);
  }

  for (const system of ownedSystems) {
    const critical = productionLossIfLost.get(system.id) || 0;
    const threat = computeThreat(game, playerId, system, systemById);
    const weight = (placementWeights.get(system.id) || 0) + critical * 0.6 + threat * 0.05;
    if (weight > 0) placementWeights.set(system.id, weight);
  }

  let remaining = Math.max(0, player.fleetsToPlace || 0);
  const weightedSystems = [...placementWeights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!weightedSystems.length) {
    placements[player.homeSystemId || ownedSystems[0].id] = remaining;
    remaining = 0;
  } else {
    const totalWeight = weightedSystems.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [id, weight] of weightedSystems) {
      if (remaining <= 0) break;
      const share = Math.max(0, Math.floor((remaining * weight) / totalWeight));
      if (share <= 0) continue;
      placements[id] = (placements[id] || 0) + share;
      remaining -= share;
    }
    let cursor = 0;
    while (remaining > 0 && weightedSystems.length) {
      const id = weightedSystems[cursor % weightedSystems.length][0];
      placements[id] = (placements[id] || 0) + 1;
      remaining -= 1;
      cursor += 1;
    }
  }

  const projectedFleets = new Map<string, number>();
  for (const system of ownedSystems) {
    projectedFleets.set(system.id, (system.fleets || 0) + (placements[system.id] || 0));
  }
  for (const [stagingId, amount] of incomingTo.entries()) {
    projectedFleets.set(stagingId, (projectedFleets.get(stagingId) || 0) + amount);
  }

  const powerups: PowerupOrder[] = [];

  // Terraform to avoid wasting capped terrain research on low-value systems.
  if ((player.research?.terrain || 0) >= POWERUPS.terraform.cost && (player.research?.terrain || 0) >= 20) {
    const terraformTarget = pickTerraformTarget(game, playerId);
    if (terraformTarget) powerups.push({ type: "terraform", targetId: terraformTarget.id });
  }

  // Defense net on high-threat / high-economy-loss systems.
  if ((player.research?.crystal || 0) >= POWERUPS.defenseNet.cost && (player.research?.crystal || 0) >= 20) {
    const defenseTarget = pickDefenseTarget(game, playerId, systemById, productionLossIfLost);
    if (defenseTarget) powerups.push({ type: "defenseNet", targetId: defenseTarget.id });
  }

  const canSpendFusion = (player.research?.fusion || 0) >= POWERUPS.wormhole.cost && (player.research?.fusion || 0) >= 20;
  const canSpendMetal = (player.research?.metal || 0) >= POWERUPS.stellarBomb.cost && (player.research?.metal || 0) >= 20;
  let bombPlanned = false;

  const attacks: Orders["moves"] = [];

  // Optional: create a wormhole for a high-impact strike when fusion is capped.
  let plannedWormhole: { fromId: string; toId: string } | null = null;
  if (canSpendFusion && rand() < 0.6) {
    const strongest = [...projectedFleets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (strongest) {
      const from = systemById.get(strongest);
      if (from && from.ownerId === playerId) {
        let best: { target: SystemState; score: number } | null = null;
        for (const target of game.systems) {
          if (!isAttackableTarget(game, playerId, target)) continue;
          if (game.links[from.id]?.includes(target.id)) continue;
          if (hasActiveWormhole(game, from.id, target.id)) continue;
          const score = scoreCapture(target) - (target.fleets || 0) * 0.6;
          if (!best || score > best.score) best = { target, score };
        }
        if (best && best.score > 35) {
          plannedWormhole = { fromId: from.id, toId: best.target.id };
          powerups.push({ type: "wormhole", fromId: plannedWormhole.fromId, toId: plannedWormhole.toId });
        }
      }
    }
  }

  const canBombTarget = (fromId: string, target: SystemState) => {
    if (!canSpendMetal) return false;
    if (bombPlanned) return false;
    if (!target.ownerId) return false;
    if ((target.defenseNetTurns || 0) > 0) return false;
    if (isAllied(game, playerId, target.ownerId)) return false;
    const adjacent = (game.links[fromId] || []).includes(target.id);
    const wormhole =
      hasActiveWormhole(game, fromId, target.id) ||
      (plannedWormhole && ((plannedWormhole.fromId === fromId && plannedWormhole.toId === target.id) || (plannedWormhole.toId === fromId && plannedWormhole.fromId === target.id)));
    return adjacent || wormhole;
  };

  const scoreAttackFrom = (fromId: string, target: SystemState, projectedFromFleets: number, keep: number) => {
    const defender = Math.max(0, target.fleets || 0);
    const canSend = Math.max(0, projectedFromFleets - keep);
    if (canSend <= 0) return null;

    const willBomb = canBombTarget(fromId, target) && defender >= 6;
    const effectiveDef = willBomb ? Math.floor(defender / 2) : defender;
    const desiredProb = target.ownerId ? 0.64 : 0.68;
    const needed = fleetsNeededForProbability(effectiveDef, desiredProb);
    const send = Math.min(canSend, needed);
    const winProb = estimatedWinProb(send, effectiveDef);
    const value = scoreCapture(target);
    const score = value * winProb - send * 0.25 - defender * 0.2;
    return { send, winProb, value, score, willBomb };
  };

  const planAttackFrom = (fromId: string) => {
    const from = systemById.get(fromId);
    if (!from || from.ownerId !== playerId) return;
    const projected = projectedFleets.get(fromId) || 0;
    const keep = keepBySystem.get(fromId) || 1;
    const targets: SystemState[] = [];

    for (const neighborId of game.links[fromId] || []) {
      const target = systemById.get(neighborId);
      if (target && isAttackableTarget(game, playerId, target)) targets.push(target);
    }
    for (const wormhole of getActiveWormholes(game)) {
      const other =
        wormhole.fromId === fromId ? wormhole.toId : wormhole.toId === fromId ? wormhole.fromId : null;
      if (!other) continue;
      const target = systemById.get(other);
      if (target && isAttackableTarget(game, playerId, target)) targets.push(target);
    }
    if (plannedWormhole && plannedWormhole.fromId === fromId) {
      const target = systemById.get(plannedWormhole.toId);
      if (target && isAttackableTarget(game, playerId, target)) targets.push(target);
    }

    const uniqueTargets = [...new Map(targets.map((t) => [t.id, t])).values()];

    let best: { target: SystemState; score: number; send: number; willBomb: boolean } | null = null;
    for (const target of uniqueTargets) {
      const result = scoreAttackFrom(fromId, target, projected, keep);
      if (!result) continue;
      if (result.send <= 0) continue;
      if (result.winProb < 0.52) continue;
      if (!best || result.score > best.score) {
        best = { target, score: result.score, send: result.send, willBomb: result.willBomb };
      }
    }
    if (!best || best.score < 6) return;

    if (best.willBomb) {
      powerups.push({ type: "stellarBomb", targetId: best.target.id });
      bombPlanned = true;
    }

    attacks.push({ fromId, toId: best.target.id, count: best.send });
  };

  // Prioritize attacks from staging systems, then opportunistic frontier attacks.
  const stagingIds = [...new Set(stagingByComponent.values())].sort(
    (a, b) => (projectedFleets.get(b) || 0) - (projectedFleets.get(a) || 0)
  );
  for (const stagingId of stagingIds) {
    planAttackFrom(stagingId);
  }

  if (attacks.length === 0) {
    const frontierOwned = ownedSystems
      .filter((s) => (frontierTargetsByFrom.get(s.id) || []).length > 0)
      .sort((a, b) => (projectedFleets.get(b.id) || 0) - (projectedFleets.get(a.id) || 0));
    for (const system of frontierOwned.slice(0, 3)) {
      planAttackFrom(system.id);
      if (attacks.length) break;
    }
  }

  // Order is critical: transfers first so staging fleets exist before attacks execute.
  const moves = [...transfers, ...attacks];
  return { placements, moves, powerups, research: [] };
}

export function planBotOrders(game: GameState, playerId: string, difficulty: BotDifficulty): Orders {
  if (!game || !playerId) return blankOrders();
  if (game.phase !== "planning") return blankOrders();
  if (difficulty === "easy") return planEasy(game, playerId);
  if (difficulty === "medium") return planMedium(game, playerId);
  return planHard(game, playerId);
}
