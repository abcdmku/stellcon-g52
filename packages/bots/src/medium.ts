import { POWERUPS } from "@stellcon/shared";
import type { GameState, Orders, PowerupOrder, SystemState } from "@stellcon/shared";
import { blankOrders, clampInt } from "./shared.js";
import { botRand } from "./rand.js";
import { computeThreat, getNeighborSystems, isAttackableTarget } from "./game.js";
import { pickTerraformTarget } from "./powerups.js";

function targetScore(target: SystemState) {
  const tier = target.tier ?? 0;
  const totalResources = Object.values(target.resources || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const defender = Math.max(0, target.fleets || 0);
  const neutralBonus = target.ownerId ? 0 : 4;
  return totalResources + tier * 2 + neutralBonus - defender * 0.65;
}

export function planMedium(game: GameState, playerId: string): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();
  const rand = botRand(game, playerId, "medium");

  const systemById = new Map(game.systems.map((s) => [s.id, s]));
  const owned = game.systems.filter((s) => s.ownerId === playerId);
  if (!owned.length) return blankOrders();

  const frontier = owned.filter((from) =>
    getNeighborSystems(game, systemById, from.id).some((target) => isAttackableTarget(game, playerId, target))
  );

  const placements: Record<string, number> = {};
  let remaining = Math.max(0, player.fleetsToPlace || 0);
  const placementTargets = frontier.length ? frontier : owned;
  let cursor = 0;
  while (remaining > 0 && placementTargets.length) {
    const pick = placementTargets[cursor % placementTargets.length];
    placements[pick.id] = (placements[pick.id] || 0) + 1;
    remaining -= 1;
    cursor += 1;
  }

  const powerups: PowerupOrder[] = [];
  if ((player.research?.terrain || 0) >= POWERUPS.terraform.cost && rand() < 0.2) {
    const terraformTarget = pickTerraformTarget(game, playerId);
    if (terraformTarget) powerups.push({ type: "terraform", targetId: terraformTarget.id });
  }

  if ((player.research?.crystal || 0) >= POWERUPS.defenseNet.cost && rand() < 0.18) {
    let best: { system: SystemState; threat: number } | null = null;
    for (const system of owned) {
      if ((system.defenseNetTurns || 0) > 0) continue;
      const threat = computeThreat(game, playerId, system, systemById);
      if (!best || threat > best.threat) best = { system, threat };
    }
    if (best && best.threat >= 10) powerups.push({ type: "defenseNet", targetId: best.system.id });
  }

  const moves: Orders["moves"] = [];
  const maxAttacks = 2;
  const attackFrom = frontier.length ? frontier : owned;

  const pickOrder = [...attackFrom].sort((a, b) => (b.fleets || 0) - (a.fleets || 0));
  for (const from of pickOrder) {
    if (moves.length >= maxAttacks) break;
    const projected = (from.fleets || 0) + (placements[from.id] || 0);
    if (projected <= 3) continue;
    const candidates = getNeighborSystems(game, systemById, from.id).filter((target) => isAttackableTarget(game, playerId, target));
    if (!candidates.length) continue;
    let best: { target: SystemState; score: number } | null = null;
    for (const target of candidates) {
      const score = targetScore(target);
      if (!best || score > best.score) best = { target, score };
    }
    if (!best || best.score < 2) continue;
    const defender = Math.max(0, best.target.fleets || 0);
    const send = clampInt(defender + 2 + rand() * 2, 1, projected - 1);
    if (send <= 0) continue;
    moves.push({ fromId: from.id, toId: best.target.id, count: send });
  }

  return { placements, moves, powerups, research: [] };
}
