import { mulberry32, seedToInt } from "@stellcon/shared";
import type { BotDifficulty, GameState } from "@stellcon/shared";
import type { Rand } from "./shared.js";

export function botRand(game: GameState, playerId: string, difficulty: BotDifficulty, salt = ""): Rand {
  return mulberry32(seedToInt(`${game.seed}:bot:${difficulty}:${playerId}:${game.turn}:${salt}`));
}
