import { CORE_RESOURCE_TYPES } from "@stellcon/shared";
import type { GameState, SystemState } from "@stellcon/shared";

export function pickTerraformTarget(game: GameState, playerId: string) {
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
