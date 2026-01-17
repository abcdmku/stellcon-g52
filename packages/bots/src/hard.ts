import { CORE_RESOURCE_TYPES, POWERUPS, isAllied } from "@stellcon/shared";
import type { GameState, Orders, PowerupOrder, ResourceMap, SystemState } from "@stellcon/shared";
import { estimatedWinProb, fleetsNeededForProbability } from "./combat.js";
import { computeEconomies, productionFromTotals, resourceWeightsFor, weightedResourceScore } from "./economy.js";
import { computeThreat, getReachableSystemsForAttack, hasActiveWormhole, isAttackableTarget, ownedComponents } from "./game.js";
import { pickTerraformTarget } from "./powerups.js";
import { botRand } from "./rand.js";
import { blankOrders, clampInt, pickWeighted } from "./shared.js";

export type HardBotStyle = {
  aggression: number;
  expansion: number;
  focus: number;
  tactics: number;
};

export const DEFAULT_HARD_STYLE: HardBotStyle = {
  aggression: 0.7,
  expansion: 0.6,
  focus: 0.7,
  tactics: 0.6,
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp01(t);
}

export function normalizeHardBotStyle(input: Partial<HardBotStyle> | null | undefined): HardBotStyle {
  return {
    aggression: clamp01(typeof input?.aggression === "number" ? input.aggression : DEFAULT_HARD_STYLE.aggression),
    expansion: clamp01(typeof input?.expansion === "number" ? input.expansion : DEFAULT_HARD_STYLE.expansion),
    focus: clamp01(typeof input?.focus === "number" ? input.focus : DEFAULT_HARD_STYLE.focus),
    tactics: clamp01(typeof input?.tactics === "number" ? input.tactics : DEFAULT_HARD_STYLE.tactics),
  };
}

type PadState = {
  id: string;
  keep: number;
  projected: number;
  available: number;
  potential: number;
  targets: SystemState[];
};

type AttackOption = {
  padId: string;
  targetId: string;
  send: number;
  priority: number;
  value: number;
  defender: number;
  ownerId: string | null;
};

function sumResourceTotals(totals: ResourceMap, delta: ResourceMap, sign: 1 | -1) {
  const next = { ...totals };
  for (const key of CORE_RESOURCE_TYPES) {
    next[key] = Math.max(0, (next[key] || 0) + sign * (delta?.[key] || 0));
  }
  return next;
}

export function planHard(game: GameState, playerId: string, style: Partial<HardBotStyle> = DEFAULT_HARD_STYLE): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();

  const systemById = new Map(game.systems.map((s) => [s.id, s]));
  const ownedSystems = game.systems.filter((s) => s.ownerId === playerId);
  if (!ownedSystems.length) return blankOrders();

  const normalizedStyle = normalizeHardBotStyle(style);
  const styleKey = `${normalizedStyle.aggression.toFixed(2)}:${normalizedStyle.expansion.toFixed(2)}:${normalizedStyle.focus.toFixed(2)}:${normalizedStyle.tactics.toFixed(2)}`;
  const rand = botRand(game, playerId, "hard", styleKey);

  const configuredMaxTurns = Math.max(1, Math.floor(Number(game.config?.maxTurns ?? 20)));
  const turnNumber = Math.max(1, Math.floor(Number(game.turn ?? 1)));
  const turnRatio = clamp01((turnNumber - 1) / Math.max(1, configuredMaxTurns - 1));
  const earlyPhase = clamp01(1 - turnRatio);
  const latePhase = clamp01(turnRatio);

  let threatened = 0;
  let threatSum = 0;
  for (const system of ownedSystems) {
    const threat = computeThreat(game, playerId, system, systemById);
    if (threat > 0) threatened += 1;
    threatSum += threat;
  }
  const borderFraction = threatened / Math.max(1, ownedSystems.length);
  const avgThreat = threatSum / Math.max(1, ownedSystems.length);
  const warPressure = clamp01(borderFraction * 1.1 + Math.min(1, avgThreat / 20) * 0.6);

  const aggression = clamp01(normalizedStyle.aggression + warPressure * 0.22 + latePhase * 0.14 - earlyPhase * 0.08);
  const expansion = clamp01(normalizedStyle.expansion + earlyPhase * 0.22 - warPressure * 0.18 - latePhase * 0.08);
  const focus = clamp01(normalizedStyle.focus + warPressure * 0.18 + latePhase * 0.12 - earlyPhase * 0.05);
  const tactics = clamp01(normalizedStyle.tactics + warPressure * 0.12 + latePhase * 0.08);

  const keepThreatFactor = lerp(0.22, 0.1, aggression);
  const keepCriticalFactor = lerp(1.8, 1.1, aggression);
  const homeKeepBonus = clampInt(2 + Math.round((1 - aggression) * 1), 2, 3);
  const padMaxPerComponent = clampInt(1 + Math.floor(expansion * 2), 1, 3);

  const tier1Bonus = lerp(1.2, 3, focus);
  const tier2Bonus = lerp(3, 7, focus);
  const systemCountBonusBase = lerp(8, 16, expansion);
  const systemCountBonusTurnScale = lerp(0.5, 0.9, expansion);
  const neutralBonusBase = lerp(1, 8, expansion);
  const leaderBonusBase = lerp(4, 22, focus);
  const prodGainWeight = lerp(10, 18, focus);
  const enemyLossWeight = lerp(12, 26, focus);

  const wormholeChance = lerp(0.15, 0.85, tactics);
  const wormholeValueThreshold = lerp(55, 25, tactics);
  const bombChance = lerp(0.2, 0.9, tactics);
  const bombDefenderThreshold = clampInt(Math.round(lerp(14, 7, tactics)), 6, 14);

  const neutralDesiredProb = game.turn <= 3 ? lerp(0.74, 0.62, aggression) : lerp(0.8, 0.66, aggression);
  const enemyDesiredProb = lerp(0.68, 0.58, aggression);
  const primaryDesiredProb = game.turn <= 3 ? lerp(0.64, 0.56, aggression) : lerp(0.7, 0.62, aggression);
  const primaryMinProb = game.turn <= 3 ? lerp(0.58, 0.5, aggression) : lerp(0.62, 0.54, aggression);
  const secondaryMaxDefender = clampInt(Math.round(lerp(10, 18, aggression)), 8, 22);

  const economies = computeEconomies(game);
  const selfEco = economies.get(playerId);
  if (!selfEco) return blankOrders();

  const remainingTurns = Math.max(1, (game.config?.maxTurns || 20) - (game.turn || 1) + 1);
  const weights = resourceWeightsFor(selfEco.totals, "hard");
  const currentSurplus = {} as ResourceMap;
  for (const key of CORE_RESOURCE_TYPES) {
    currentSurplus[key] = Math.max(0, (selfEco.totals?.[key] || 0) - (selfEco.production || 0));
  }

  const productionLossIfLost = new Map<string, number>();
  for (const system of ownedSystems) {
    const nextTotals = sumResourceTotals(selfEco.totals, system.resources, -1);
    const nextProduction = productionFromTotals(nextTotals);
    productionLossIfLost.set(system.id, Math.max(0, selfEco.production - nextProduction));
  }

  const keepBySystem = new Map<string, number>();
  for (const system of ownedSystems) {
    const threat = computeThreat(game, playerId, system, systemById);
    const critical = productionLossIfLost.get(system.id) || 0;
    let keep = 1;
    keep += clampInt(threat * keepThreatFactor, 0, 6);
    keep += clampInt(critical * keepCriticalFactor, 0, 7);
    if (system.id === player.homeSystemId) keep += homeKeepBonus;
    if ((system.defenseNetTurns || 0) > 0) keep = Math.max(1, keep - 2);
    keepBySystem.set(system.id, keep);
  }

  let leaderId: string | null = null;
  let bestLeaderProd = -1;
  for (const [id, eco] of economies.entries()) {
    if (id === playerId) continue;
    if (eco.production > bestLeaderProd) {
      bestLeaderProd = eco.production;
      leaderId = id;
    }
  }

  const captureValue = (target: SystemState) => {
    const resourceScore = weightedResourceScore(target.resources, weights);
    const tier = target.tier ?? 0;
    const tierBonus = tier >= 2 ? tier2Bonus : tier === 1 ? tier1Bonus : 0;

    const nextTotals = sumResourceTotals(selfEco.totals, target.resources, 1);
    const nextProduction = productionFromTotals(nextTotals);
    const prodGain = Math.max(0, nextProduction - selfEco.production);

    let enemyProdLoss = 0;
    if (target.ownerId && target.ownerId !== playerId && !isAllied(game, playerId, target.ownerId)) {
      const enemyEco = economies.get(target.ownerId);
      if (enemyEco) {
        const nextEnemyTotals = sumResourceTotals(enemyEco.totals, target.resources, -1);
        const nextEnemyProd = productionFromTotals(nextEnemyTotals);
        enemyProdLoss = Math.max(0, enemyEco.production - nextEnemyProd);
      }
    }

    const systemCountBonus = systemCountBonusBase + Math.min(12, Math.floor(remainingTurns * systemCountBonusTurnScale));
    const neutralBonus = target.ownerId ? 0 : neutralBonusBase;
    const leaderBonus = target.ownerId && target.ownerId === leaderId ? leaderBonusBase : 0;

    const strategic = (prodGain * prodGainWeight + enemyProdLoss * enemyLossWeight) * remainingTurns;

    const unlockValue = (key: (typeof CORE_RESOURCE_TYPES)[number], perTurnSaved: number) => {
      const research = Math.max(0, Math.min(20, Number(player.research?.[key] || 0)));
      const missing = Math.max(0, 20 - research);
      if (missing <= 0) return 0;
      const before = currentSurplus[key] || 0;
      const after = Math.max(0, (nextTotals[key] || 0) - nextProduction);
      if (after <= before) return 0;
      const turnsBefore = before > 0 ? missing / before : missing + 6;
      const turnsAfter = after > 0 ? missing / after : missing + 6;
      const turnsSaved = Math.min(8, Math.max(0, turnsBefore - turnsAfter));
      return turnsSaved * perTurnSaved;
    };

    const earlyBias = clamp01(1 - turnRatio * 1.4);
    const lateBias = clamp01(turnRatio);
    const terrainBias = 0.4 + 1.2 * earlyBias;
    const fusionBias = 0.35 + 1.0 * earlyBias;
    const metalBias = 0.35 + 0.7 * lateBias + 0.5 * warPressure;
    const crystalBias = 0.35 + 0.7 * lateBias + 0.5 * warPressure;

    const unlockBonus =
      unlockValue("terrain", 16 * terrainBias) +
      unlockValue("fusion", 13 * fusionBias) +
      unlockValue("metal", 10 * metalBias) +
      unlockValue("crystal", 10 * crystalBias);

    return resourceScore + tierBonus + systemCountBonus + neutralBonus + leaderBonus + strategic + unlockBonus;
  };

  const components = ownedComponents(game, playerId, systemById);

  const padPotentials = new Map<string, number>();
  const allPads = new Set<string>();

  for (const component of components) {
    const frontier = component
      .map((id) => systemById.get(id))
      .filter((s): s is SystemState => Boolean(s))
      .filter((system) => {
        const targets = getReachableSystemsForAttack(game, systemById, system.id, null).filter((t) =>
          isAttackableTarget(game, playerId, t)
        );
        return targets.length > 0;
      });

    if (!frontier.length) {
      const fallback = component
        .map((id) => systemById.get(id))
        .filter((s): s is SystemState => Boolean(s))
        .sort((a, b) => (b.fleets || 0) - (a.fleets || 0))[0];
      if (fallback) {
        allPads.add(fallback.id);
        padPotentials.set(fallback.id, 1);
      }
      continue;
    }

    const scored = frontier
      .map((system) => {
        const targets = getReachableSystemsForAttack(game, systemById, system.id, null).filter((t) =>
          isAttackableTarget(game, playerId, t)
        );
        const top = targets
          .map((t) => captureValue(t))
          .sort((a, b) => b - a)
          .slice(0, 3);
        const sumTop = top.reduce((sum, v) => sum + v, 0);
        const potential = sumTop + targets.length * 3 + (system.id === player.homeSystemId ? 6 : 0);
        return { id: system.id, potential };
      })
      .sort((a, b) => b.potential - a.potential);

    const k = Math.min(padMaxPerComponent, Math.max(1, Math.ceil(scored.length / 3)));
    for (const entry of scored.slice(0, k)) {
      allPads.add(entry.id);
      padPotentials.set(entry.id, entry.potential);
    }
  }

  const pads = [...allPads.values()];
  if (!pads.length) return blankOrders();

  // Transfers: move extra fleets from non-pads into pads (distributed by pad potential).
  const transfers: Orders["moves"] = [];
  const incomingTo = new Map<string, number>();

  for (const component of components) {
    const componentPads = pads.filter((id) => component.includes(id));
    if (!componentPads.length) continue;

    const weightedPads = componentPads.map((id) => ({
      item: id,
      weight: Math.max(1, padPotentials.get(id) || 1),
    }));

    for (const fromId of component) {
      if (componentPads.includes(fromId)) continue;
      const from = systemById.get(fromId);
      if (!from || from.ownerId !== playerId) continue;
      const keep = keepBySystem.get(fromId) || 1;
      const available = Math.max(0, (from.fleets || 0) - keep);
      if (available <= 0) continue;

      const toId = pickWeighted(weightedPads, rand) || componentPads[0];
      if (!toId || toId === fromId) continue;
      transfers.push({ fromId, toId, count: available });
      incomingTo.set(toId, (incomingTo.get(toId) || 0) + available);
    }
  }

  // Placements: focus on pads (plus emergency defense).
  const placements: Record<string, number> = {};
  let remainingPlacement = Math.max(0, player.fleetsToPlace || 0);

  const placementWeights = new Map<string, number>();
  for (const padId of pads) {
    const pad = systemById.get(padId);
    if (!pad) continue;
    const threat = computeThreat(game, playerId, pad, systemById);
    const critical = productionLossIfLost.get(padId) || 0;
    const weight = (padPotentials.get(padId) || 1) * 0.08 + 2 + threat * 0.05 + critical * 0.6;
    placementWeights.set(padId, weight);
  }

  for (const system of ownedSystems) {
    if (pads.includes(system.id)) continue;
    const threat = computeThreat(game, playerId, system, systemById);
    const critical = productionLossIfLost.get(system.id) || 0;
    if (threat < 14 && critical < 1) continue;
    placementWeights.set(system.id, Math.max(0.5, threat * 0.04 + critical * 0.9));
  }

  const weightedList = [...placementWeights.entries()].sort((a, b) => b[1] - a[1]);
  const totalWeight = weightedList.reduce((sum, [, w]) => sum + w, 0);

  if (!weightedList.length) {
    const fallback = player.homeSystemId || ownedSystems[0].id;
    placements[fallback] = remainingPlacement;
    remainingPlacement = 0;
  } else if (totalWeight > 0) {
    for (const [id, weight] of weightedList) {
      if (remainingPlacement <= 0) break;
      const share = Math.max(0, Math.floor((remainingPlacement * weight) / totalWeight));
      if (share <= 0) continue;
      placements[id] = (placements[id] || 0) + share;
      remainingPlacement -= share;
    }

    let cursor = 0;
    while (remainingPlacement > 0 && weightedList.length) {
      const id = weightedList[cursor % weightedList.length][0];
      placements[id] = (placements[id] || 0) + 1;
      remainingPlacement -= 1;
      cursor += 1;
    }
  }

  const padStates = new Map<string, PadState>();
  for (const padId of pads) {
    const pad = systemById.get(padId);
    if (!pad) continue;
    const keep = keepBySystem.get(padId) || 1;
    const projected = (pad.fleets || 0) + (placements[padId] || 0) + (incomingTo.get(padId) || 0);
    const available = Math.max(0, projected - keep);
    padStates.set(padId, {
      id: padId,
      keep,
      projected,
      available,
      potential: padPotentials.get(padId) || 1,
      targets: [],
    });
  }

  const powerups: PowerupOrder[] = [];

  // Terraform: improve weakest low-tier system when terrain is capped.
  if ((player.research?.terrain || 0) >= POWERUPS.terraform.cost && (player.research?.terrain || 0) >= 20) {
    const terraformTarget = pickTerraformTarget(game, playerId);
    if (terraformTarget) powerups.push({ type: "terraform", targetId: terraformTarget.id });
  }

  // Defense net: protect the most threatened / critical system when crystal is capped.
  if ((player.research?.crystal || 0) >= POWERUPS.defenseNet.cost && (player.research?.crystal || 0) >= 20) {
    let best: { system: SystemState; score: number } | null = null;
    for (const system of ownedSystems) {
      if ((system.defenseNetTurns || 0) > 0) continue;
      const threat = computeThreat(game, playerId, system, systemById);
      const critical = productionLossIfLost.get(system.id) || 0;
      const score = threat * 1.1 + critical * 8 + (system.id === player.homeSystemId ? 10 : 0);
      if (!best || score > best.score) best = { system, score };
    }
    if (best && best.score >= 16) {
      powerups.push({ type: "defenseNet", targetId: best.system.id });
    }
  }

  const canSpendFusion = (player.research?.fusion || 0) >= POWERUPS.wormhole.cost && (player.research?.fusion || 0) >= 20;
  const canSpendMetal = (player.research?.metal || 0) >= POWERUPS.stellarBomb.cost && (player.research?.metal || 0) >= 20;

  let plannedWormhole: { fromId: string; toId: string } | null = null;
  if (canSpendFusion && padStates.size && rand() < wormholeChance) {
    const padByStrength = [...padStates.values()].sort((a, b) => b.projected - a.projected);
    const fromPad = padByStrength[0];
    if (fromPad) {
      const reachableNow = new Set<string>();
      for (const owned of ownedSystems) {
        for (const neighborId of game.links?.[owned.id] || []) reachableNow.add(neighborId);
      }

      let bestTarget: { system: SystemState; score: number } | null = null;
      for (const target of game.systems) {
        if (!isAttackableTarget(game, playerId, target)) continue;
        if (reachableNow.has(target.id)) continue;
        if (target.id === fromPad.id) continue;
        if ((game.links?.[fromPad.id] || []).includes(target.id)) continue;
        if (hasActiveWormhole(game, fromPad.id, target.id)) continue;
        if ((target.defenseNetTurns || 0) > 0 && target.ownerId) continue;
        const score = captureValue(target) - (target.fleets || 0) * 0.8;
        if (!bestTarget || score > bestTarget.score) bestTarget = { system: target, score };
      }

      if (bestTarget && bestTarget.score > wormholeValueThreshold) {
        plannedWormhole = { fromId: fromPad.id, toId: bestTarget.system.id };
        powerups.push({ type: "wormhole", fromId: plannedWormhole.fromId, toId: plannedWormhole.toId });
      }
    }
  }

  // Update pad targets with wormhole considered.
  for (const pad of padStates.values()) {
    pad.targets = getReachableSystemsForAttack(game, systemById, pad.id, plannedWormhole).filter((t) =>
      isAttackableTarget(game, playerId, t)
    );
  }

  // Phase 1: grab neutral systems efficiently (avoid duplicate targets).
  const chosenTargets = new Set<string>();
  const neutralOptions: AttackOption[] = [];

  for (const pad of padStates.values()) {
    if (pad.available <= 0) continue;
    for (const target of pad.targets) {
      if (target.ownerId) continue;
      const defender = Math.max(0, target.fleets || 0);
      const send = fleetsNeededForProbability(defender, neutralDesiredProb);
      if (send <= 0) continue;
      if (send > pad.available) continue;
      const value = captureValue(target);
      const priority = value / Math.max(1, send);
      neutralOptions.push({ padId: pad.id, targetId: target.id, send, priority, value, defender, ownerId: null });
    }
  }

  neutralOptions.sort((a, b) => b.priority - a.priority || b.value - a.value);

  const attacks: Orders["moves"] = [];
  for (const option of neutralOptions) {
    if (chosenTargets.has(option.targetId)) continue;
    const pad = padStates.get(option.padId);
    if (!pad) continue;
    if (pad.available < option.send) continue;
    pad.available -= option.send;
    chosenTargets.add(option.targetId);
    attacks.push({ fromId: option.padId, toId: option.targetId, count: option.send });
  }

  // Phase 2: identify a primary enemy target to focus (possibly with a stellar bomb).
  type EnemyTargetInfo = {
    id: string;
    system: SystemState;
    value: number;
    defender: number;
    reachablePads: string[];
  };

  const enemyInfoById = new Map<string, EnemyTargetInfo>();
  for (const pad of padStates.values()) {
    for (const target of pad.targets) {
      if (!target.ownerId) continue;
      if (target.ownerId === playerId) continue;
      if (isAllied(game, playerId, target.ownerId)) continue;
      if ((target.defenseNetTurns || 0) > 0) continue;
      const value = captureValue(target);
      const defender = Math.max(0, target.fleets || 0);
      const existing = enemyInfoById.get(target.id);
      if (!existing) {
        enemyInfoById.set(target.id, { id: target.id, system: target, value, defender, reachablePads: [pad.id] });
      } else {
        existing.reachablePads.push(pad.id);
        if (value > existing.value) existing.value = value;
        if (defender > existing.defender) existing.defender = defender;
      }
    }
  }

  let primary: EnemyTargetInfo | null = null;
  for (const info of enemyInfoById.values()) {
    const reachBonus = Math.min(10, (info.reachablePads.length - 1) * 3);
    const leaderBonus = info.system.ownerId && info.system.ownerId === leaderId ? 16 : 0;
    const score = info.value + reachBonus + leaderBonus - info.defender * 0.55;
    if (!primary || score > primary.value) {
      primary = { ...info, value: score };
    }
  }

  const primaryAttackPads: string[] = [];
  if (primary) {
    const planBomb = canSpendMetal && primary.defender >= bombDefenderThreshold && rand() < bombChance;
    const effectiveDef = planBomb ? Math.floor(primary.defender / 2) : primary.defender;
    const need = fleetsNeededForProbability(effectiveDef, primaryDesiredProb);

    const reachablePads = primary.reachablePads
      .map((id) => padStates.get(id))
      .filter((p): p is PadState => Boolean(p))
      .sort((a, b) => b.available - a.available);

    const maxAttack = reachablePads.reduce((sum, p) => sum + p.available, 0);
    const maxProb = estimatedWinProb(Math.max(1, maxAttack), Math.max(0, effectiveDef));

    const okToAttack = maxAttack > 0 && (maxProb >= primaryMinProb || maxAttack >= need);
    if (okToAttack) {
      const sendTotal = Math.min(maxAttack, need);
      let remainingSend = sendTotal;
      for (const pad of reachablePads) {
        if (remainingSend <= 0) break;
        const send = Math.min(pad.available, remainingSend);
        if (send <= 0) continue;
        pad.available -= send;
        remainingSend -= send;
        primaryAttackPads.push(pad.id);
        attacks.push({ fromId: pad.id, toId: primary.system.id, count: send });
      }

      if (planBomb && primaryAttackPads.length) {
        powerups.push({ type: "stellarBomb", targetId: primary.system.id });
      }
    }
  }

  // Phase 3: additional enemy attacks (prefer efficiency and weaker defenders).
  const secondaryOptions: AttackOption[] = [];

  for (const pad of padStates.values()) {
    if (pad.available <= 0) continue;
    for (const target of pad.targets) {
      if (!target.ownerId) continue;
      if (target.ownerId === playerId) continue;
      if (primary && target.id === primary.system.id) continue;
      if (isAllied(game, playerId, target.ownerId)) continue;
      if ((target.defenseNetTurns || 0) > 0) continue;

      const defender = Math.max(0, target.fleets || 0);
      if (defender >= secondaryMaxDefender) continue;
      const send = fleetsNeededForProbability(defender, enemyDesiredProb);
      if (send <= 0) continue;
      if (send > pad.available) continue;
      const value = captureValue(target);
      const priority = value / Math.max(1, send);
      secondaryOptions.push({ padId: pad.id, targetId: target.id, send, priority, value, defender, ownerId: target.ownerId });
    }
  }

  secondaryOptions.sort((a, b) => b.priority - a.priority || a.defender - b.defender || b.value - a.value);

  for (const option of secondaryOptions) {
    if (chosenTargets.has(option.targetId)) continue;
    const pad = padStates.get(option.padId);
    if (!pad) continue;
    if (pad.available < option.send) continue;
    pad.available -= option.send;
    chosenTargets.add(option.targetId);
    attacks.push({ fromId: option.padId, toId: option.targetId, count: option.send });
  }

  // Order matters: transfers first (gathers fleets), then attacks.
  const moves = [...transfers, ...attacks];
  return { placements, moves, powerups, research: [] };
}
