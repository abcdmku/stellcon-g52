import type { Orders } from "@stellcon/shared";

export function emptyOrders(): Orders {
  return { placements: {}, moves: [], powerups: [], research: [] };
}
