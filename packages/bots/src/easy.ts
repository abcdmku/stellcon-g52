import type { GameState, Orders, SystemState } from "@stellcon/shared";
import { blankOrders, clampInt } from "./shared.js";
import { botRand } from "./rand.js";
import { getNeighborSystems, isAttackableTarget } from "./game.js";

export function planEasy(game: GameState, playerId: string): Orders {
  const player = game.players[playerId];
  if (!player) return blankOrders();
  const rand = botRand(game, playerId, "easy");
  const owned = game.systems.filter((s) => s.ownerId === playerId);
  if (!owned.length) return blankOrders();

  const placements: Record<string, number> = {};
  const home = player.homeSystemId ? owned.find((s) => s.id === player.homeSystemId) : null;
  const placementTarget = home || owned[Math.floor(rand() * owned.length)];
  placements[placementTarget.id] = Math.max(0, player.fleetsToPlace || 0);

  const moves: Orders["moves"] = [];
  const systemById = new Map(game.systems.map((s) => [s.id, s]));
  const frontier = owned.filter((from) =>
    getNeighborSystems(game, systemById, from.id).some((target) => isAttackableTarget(game, playerId, target))
  );

  const attempts = Math.min(2, frontier.length);
  for (let i = 0; i < attempts; i += 1) {
    const from = frontier[Math.floor(rand() * frontier.length)];
    const projected = (from.fleets || 0) + (placements[from.id] || 0);
    if (projected <= 2) continue;
    const targets = getNeighborSystems(game, systemById, from.id).filter((target) => isAttackableTarget(game, playerId, target));
    if (!targets.length) continue;
    const target: SystemState = targets[Math.floor(rand() * targets.length)];
    const send = clampInt(projected * (0.25 + rand() * 0.35), 1, projected - 1);
    if (send <= 0) continue;
    moves.push({ fromId: from.id, toId: target.id, count: send });
  }

  return { placements, moves, powerups: [], research: [] };
}
