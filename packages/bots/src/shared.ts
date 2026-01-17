import type { Orders } from "@stellcon/shared";

export type Rand = () => number;

export function blankOrders(): Orders {
  return { placements: {}, moves: [], powerups: [], research: [] };
}

export function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function pickWeighted<T>(entries: Array<{ item: T; weight: number }>, rand: Rand): T | null {
  const filtered = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
  if (!filtered.length) return null;
  const total = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return filtered[0]?.item ?? null;
  let roll = rand() * total;
  for (const entry of filtered) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  return filtered[filtered.length - 1]?.item ?? null;
}
