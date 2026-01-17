import type { BotDifficulty, GameState, Orders } from "@stellcon/shared";
import { blankOrders } from "./shared.js";
import { planEasy } from "./easy.js";
import { planMedium } from "./medium.js";
import { planHard } from "./hard.js";
export { DEFAULT_HARD_STYLE, normalizeHardBotStyle, planHard } from "./hard.js";
export type { HardBotStyle } from "./hard.js";
export { findExactHardStyle, interpolateHardStyle } from "./styleMatrix.js";
export type { HardStyleMatrixPoint, HardStyleTarget } from "./styleMatrix.js";

export function planBotOrders(game: GameState, playerId: string, difficulty: BotDifficulty): Orders {
  if (!game || !playerId) return blankOrders();
  if (game.phase !== "planning") return blankOrders();
  if (difficulty === "easy") return planEasy(game, playerId);
  if (difficulty === "medium") return planMedium(game, playerId);
  return planHard(game, playerId);
}
