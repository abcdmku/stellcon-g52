import { PLAYER_COLORS, addPlayer, beginResolution, createGame, finalizeResolution, startGame, submitOrders } from "@stellcon/shared";
import type { BotDifficulty, GameState, MapSize, Orders } from "@stellcon/shared";
import { planBotOrders, planHard } from "@stellcon/bots";
import type { HardBotStyle } from "@stellcon/bots";

export type SimBot = {
  id: string;
  name: string;
  difficulty: BotDifficulty;
  hardStyle?: Partial<HardBotStyle>;
};

export type SimGameOptions = {
  seed: string;
  mapSize: MapSize;
  maxTurns: number;
  bots: SimBot[];
};

export type SimGameResult = {
  seed: string;
  turnsPlayed: number;
  winnerId: string | null;
  winnerDifficulty: BotDifficulty | null;
};

function safePlanOrders(game: GameState, bot: SimBot): Orders {
  try {
    if (bot.difficulty === "hard" && bot.hardStyle) {
      return planHard(game, bot.id, bot.hardStyle);
    }
    return planBotOrders(game, bot.id, bot.difficulty);
  } catch {
    return { placements: {}, moves: [], powerups: [], research: [] };
  }
}

export function simulateGame(options: SimGameOptions): SimGameResult {
  const bots = options.bots;
  const game = createGame({
    id: "ARENA",
    seed: options.seed,
    config: {
      maxPlayers: bots.length,
      mapSize: options.mapSize,
      maxTurns: options.maxTurns,
      turnSeconds: 90,
      isPrivate: true,
    },
  });

  bots.forEach((bot, index) => {
    addPlayer(game, { id: bot.id, name: bot.name, color: PLAYER_COLORS[index % PLAYER_COLORS.length] });
  });

  startGame(game);

  const startTurn = game.turn;
  while (game.phase !== "complete") {
    for (const bot of bots) {
      const orders = safePlanOrders(game, bot);
      submitOrders(game, bot.id, orders);
    }
    beginResolution(game);
    finalizeResolution(game);
    if (game.turn > options.maxTurns + 2) break;
  }

  const turnsPlayed = Math.max(0, (game.turn || startTurn) - startTurn);
  const winnerId = game.winnerId ?? null;
  const winnerBot = winnerId ? bots.find((b) => b.id === winnerId) : null;
  return { seed: options.seed, turnsPlayed, winnerId, winnerDifficulty: winnerBot?.difficulty ?? null };
}
