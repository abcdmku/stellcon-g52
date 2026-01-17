import { CORE_RESOURCE_TYPES, computeIncome } from "@stellcon/shared";
import type { BotDifficulty, GameState, ResourceMap, ResourceType } from "@stellcon/shared";

export type PlayerEconomy = {
  totals: ResourceMap;
  production: number;
};

export function productionFromTotals(totals: ResourceMap) {
  return Math.min(...CORE_RESOURCE_TYPES.map((key) => totals[key] || 0));
}

export function resourceWeightsFor(playerTotals: ResourceMap, difficulty: BotDifficulty): Record<ResourceType, number> {
  const min = Math.min(...CORE_RESOURCE_TYPES.map((key) => playerTotals[key] || 0));
  const weights = {} as Record<ResourceType, number>;
  const bottleneckWeight = difficulty === "hard" ? 3 : difficulty === "medium" ? 2 : 1.25;
  for (const key of CORE_RESOURCE_TYPES) {
    weights[key] = (playerTotals[key] || 0) === min ? bottleneckWeight : 1;
  }
  return weights;
}

export function weightedResourceScore(resources: ResourceMap, weights: Record<ResourceType, number>) {
  let score = 0;
  for (const key of CORE_RESOURCE_TYPES) {
    score += (resources[key] || 0) * (weights[key] || 1);
  }
  return score;
}

export function computeEconomies(game: GameState) {
  const economy = new Map<string, PlayerEconomy>();
  for (const playerId of Object.keys(game.players)) {
    const income = computeIncome(game, playerId);
    economy.set(playerId, { totals: income.totals, production: income.fleets });
  }
  return economy;
}
