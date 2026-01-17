import { isAllied } from "@stellcon/shared";
import type { GameState, SystemState, WormholeLink } from "@stellcon/shared";

export function getActiveWormholes(game: GameState): WormholeLink[] {
  const wormholes = Array.isArray(game.wormholes) ? game.wormholes : [];
  return wormholes.filter((w) => (w.turnsRemaining || 0) > 0);
}

export function hasActiveWormhole(game: GameState, a: string, b: string) {
  return getActiveWormholes(game).some((w) => (w.fromId === a && w.toId === b) || (w.fromId === b && w.toId === a));
}

export function isAttackableTarget(game: GameState, playerId: string, target: SystemState) {
  if (target.ownerId === playerId) return false;
  if (target.ownerId && isAllied(game, playerId, target.ownerId)) return false;
  if (target.ownerId && (target.defenseNetTurns || 0) > 0) return false;
  return true;
}

export function getNeighborSystems(game: GameState, systemById: Map<string, SystemState>, systemId: string): SystemState[] {
  return (game.links?.[systemId] || [])
    .map((id) => systemById.get(id))
    .filter((entry): entry is SystemState => Boolean(entry));
}

export function getReachableSystemsForAttack(
  game: GameState,
  systemById: Map<string, SystemState>,
  fromId: string,
  plannedWormhole?: { fromId: string; toId: string } | null
): SystemState[] {
  const reachable: SystemState[] = [];
  for (const neighbor of getNeighborSystems(game, systemById, fromId)) {
    reachable.push(neighbor);
  }

  for (const wormhole of getActiveWormholes(game)) {
    const other =
      wormhole.fromId === fromId ? wormhole.toId : wormhole.toId === fromId ? wormhole.fromId : null;
    if (!other) continue;
    const target = systemById.get(other);
    if (target) reachable.push(target);
  }

  if (plannedWormhole && plannedWormhole.fromId === fromId) {
    const target = systemById.get(plannedWormhole.toId);
    if (target) reachable.push(target);
  }

  return [...new Map(reachable.map((system) => [system.id, system])).values()];
}

export function computeThreat(game: GameState, playerId: string, system: SystemState, systemById: Map<string, SystemState>) {
  let threat = 0;
  for (const neighbor of getNeighborSystems(game, systemById, system.id)) {
    if (!neighbor.ownerId) continue;
    if (neighbor.ownerId === playerId) continue;
    if (isAllied(game, playerId, neighbor.ownerId)) continue;
    threat += Math.max(0, neighbor.fleets || 0);
  }
  return threat;
}

export function ownedComponents(game: GameState, playerId: string, systemById: Map<string, SystemState>) {
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
      for (const nextId of game.links?.[current] || []) {
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
