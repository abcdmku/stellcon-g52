import type { BotDifficulty, MapSize } from "@stellcon/shared";
import type { SimGameOptions, SimGameResult, SimBot } from "./simulate.js";
import { simulateGame } from "./simulate.js";
import { WorkerPool } from "./workerPool.js";

export type TournamentOptions = {
  games: number;
  players: number;
  mapSize: string;
  maxTurns?: number;
  threads?: number;
  signal?: AbortSignal;
  onProgress?: (progress: TournamentProgress) => void;
};

export type TournamentProgress = {
  completed: number;
  total: number;
};

type DiffStats = {
  games: number;
  wins: number;
  ties: number;
  losses: number;
  totalTurnsInWins: number;
};

function asMapSize(value: string): MapSize {
  if (value === "small" || value === "medium" || value === "large" || value === "massive") return value;
  return "medium";
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Cancelled");
  }
}

export async function summarizeTournament(options: TournamentOptions) {
  const difficulties: BotDifficulty[] = ["easy", "medium", "hard"];
  const players = Math.max(2, Math.min(8, Math.floor(options.players)));
  const games = Math.max(1, Math.floor(options.games));
  const mapSize = asMapSize(options.mapSize);
  const maxTurns = Math.max(10, Math.floor(options.maxTurns ?? 20));
  const threads = Math.max(1, Math.min(32, Math.floor(options.threads ?? 1)));
  const signal = options.signal;
  const total = games;
  let completed = 0;

  const stats = new Map<BotDifficulty, DiffStats>(
    difficulties.map((difficulty) => [difficulty, { games: 0, wins: 0, ties: 0, losses: 0, totalTurnsInWins: 0 }])
  );
  let totalTies = 0;

  const makeBots = (): SimBot[] =>
    Array.from({ length: players }).map((_, index) => {
      const difficulty = difficulties[index % difficulties.length];
      return {
        id: `p${index + 1}`,
        difficulty,
        name: `AI ${difficulty.toUpperCase()} ${index + 1}`,
      };
    });

  const applyResult = (bots: SimBot[], result: SimGameResult) => {
    const winnerId = result.winnerId;
    if (!winnerId) {
      totalTies += 1;
      for (const bot of bots) {
        const entry = stats.get(bot.difficulty)!;
        entry.games += 1;
        entry.ties += 1;
      }
      completed += 1;
      options.onProgress?.({ completed, total });
      return;
    }

    for (const bot of bots) {
      const entry = stats.get(bot.difficulty)!;
      entry.games += 1;
      if (bot.id === winnerId) {
        entry.wins += 1;
        entry.totalTurnsInWins += result.turnsPlayed;
      } else {
        entry.losses += 1;
      }
    }
    completed += 1;
    options.onProgress?.({ completed, total });
  };

  if (threads <= 1) {
    for (let i = 0; i < games; i += 1) {
      throwIfAborted(signal);
      const bots = makeBots();
      const seed = `arena:${mapSize}:${players}:${maxTurns}:${i}`;
      const result = simulateGame({ seed, mapSize, maxTurns, bots });
      applyResult(bots, result);
    }
  } else {
    const pool = new WorkerPool(new URL("./arenaWorker.js", import.meta.url), threads);
    const simulate = (payload: SimGameOptions) => pool.run<SimGameOptions, SimGameResult>("simulateGame", payload);

    try {
      let nextIndex = 0;
      await Promise.all(
        Array.from({ length: pool.size }).map(async () => {
          while (true) {
            if (signal?.aborted) break;
            const i = nextIndex;
            nextIndex += 1;
            if (i >= games) break;

            const bots = makeBots();
            const seed = `arena:${mapSize}:${players}:${maxTurns}:${i}`;
            const result = await simulate({ seed, mapSize, maxTurns, bots });
            applyResult(bots, result);
          }
        })
      );
    } finally {
      await pool.close();
    }

    throwIfAborted(signal);
  }

  const lines: string[] = [];
  lines.push("Tournament results");
  lines.push(`- games: ${games}`);
  lines.push(`- players per match: ${players}`);
  lines.push(`- map: ${mapSize}`);
  lines.push(`- maxTurns: ${maxTurns}`);
  lines.push(`- threads: ${threads}`);
  lines.push(`- ties: ${totalTies}`);
  lines.push("");

  for (const difficulty of difficulties) {
    const entry = stats.get(difficulty)!;
    const avgTurnsToWin = entry.wins > 0 ? (entry.totalTurnsInWins / entry.wins).toFixed(2) : "-";
    lines.push(
      `${difficulty.padEnd(6)}  wins=${String(entry.wins).padStart(4)}  losses=${String(entry.losses).padStart(4)}  ties=${String(entry.ties).padStart(4)}  avgTurnsToWin=${avgTurnsToWin}`
    );
  }

  return { text: lines.join("\n") };
}
