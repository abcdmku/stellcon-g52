import {
  DEFAULT_HARD_STYLE,
  findExactHardStyle,
  interpolateHardStyle,
  normalizeHardBotStyle,
  type HardBotStyle,
  type HardStyleMatrixPoint,
} from "@stellcon/bots";
import { mulberry32, seedToInt } from "@stellcon/shared";
import type { MapSize } from "@stellcon/shared";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SimGameOptions, SimGameResult } from "./simulate.js";
import { simulateGame } from "./simulate.js";
import { WorkerPool } from "./workerPool.js";

export type TrainingOptions = {
  iters: number;
  evalGames: number;
  mapSize: string;
  maxTurns?: number;
  players?: number;
  population?: number;
  threads?: number;
  signal?: AbortSignal;
  onProgress?: (progress: TrainingProgress) => void;
};

type EvalSummary = {
  score: number;
  wins: number;
  losses: number;
  ties: number;
  avgTurnsToWin: number | null;
};

export type TrainingProgress = {
  iter: number;
  iters: number;
  bestStyle: HardBotStyle;
  bestEval: EvalSummary;
};

type HardStyleMatrixEntry = {
  createdAt: string;
  durationMs: number;
  mapSize: MapSize;
  maxTurns: number;
  players: number;
  iters: number;
  evalGames: number;
  population: number;
  threads: number;
  style: HardBotStyle;
  eval: EvalSummary;
};

type HardStyleMatrixFile = {
  schema: "stellcon-hard-style-matrix-v1";
  updatedAt: string;
  entries: HardStyleMatrixEntry[];
};

function asMapSize(value: string): MapSize {
  if (value === "small" || value === "medium" || value === "large" || value === "massive") return value;
  return "medium";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new Error("Cancelled");
  }
}

function abortPromise(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Cancelled"));
      },
      { once: true }
    );
  });
}

function jitter(base: number, rand: () => number, magnitude: number) {
  return clamp01(base + (rand() * 2 - 1) * magnitude);
}

function mutateStyle(style: HardBotStyle, rand: () => number, magnitude: number): HardBotStyle {
  return {
    aggression: jitter(style.aggression, rand, magnitude),
    expansion: jitter(style.expansion, rand, magnitude),
    focus: jitter(style.focus, rand, magnitude),
    tactics: jitter(style.tactics, rand, magnitude),
  };
}

function scoreDuel({
  winnerId,
  turnsPlayed,
  maxTurns,
  winBase,
  lossBase,
  tieBase,
  speedWeight,
}: {
  winnerId: string | null;
  turnsPlayed: number;
  maxTurns: number;
  winBase: number;
  lossBase: number;
  tieBase: number;
  speedWeight: number;
}) {
  if (!winnerId) return tieBase;
  if (winnerId === "A") return winBase + Math.max(0, maxTurns - turnsPlayed) * speedWeight;
  return lossBase;
}

function buildOpponentBots(players: number, difficulty: "medium" | "hard", style?: HardBotStyle) {
  const bots: Array<{ id: string; name: string; difficulty: "medium" | "hard"; hardStyle?: HardBotStyle }> = [];
  for (let i = 0; i < players - 1; i += 1) {
    const id = String.fromCharCode("B".charCodeAt(0) + i);
    bots.push({
      id,
      name: `Opponent ${difficulty.toUpperCase()} ${i + 1}`,
      difficulty,
      hardStyle: difficulty === "hard" ? style : undefined,
    });
  }
  return bots;
}

function evalCandidate({
  style,
  evalGames,
  mapSize,
  maxTurns,
  players,
  simulate,
  signal,
}: {
  style: HardBotStyle;
  evalGames: number;
  mapSize: MapSize;
  maxTurns: number;
  players: number;
  simulate: (options: SimGameOptions) => Promise<SimGameResult>;
  signal?: AbortSignal;
}): Promise<EvalSummary> {
  const seeds = Array.from({ length: evalGames }).map((_, index) => `train:${mapSize}:${players}:${maxTurns}:${index}`);

  let score = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let winTurnsTotal = 0;

  const half = Math.max(1, Math.floor(evalGames / 2));
  const tasks: Array<Promise<{ result: SimGameResult; scoring: { winBase: number; lossBase: number; tieBase: number; speedWeight: number } }>> = [];

  for (let i = 0; i < half; i += 1) {
    const seed = seeds[i];
    const scoring = { winBase: 120, lossBase: -200, tieBase: -40, speedWeight: 4 };
    const opponents = buildOpponentBots(players, "medium");
    tasks.push(
      simulate({
        seed,
        mapSize,
        maxTurns,
        bots: [{ id: "A", name: "Hard Candidate", difficulty: "hard", hardStyle: style }, ...opponents],
      }).then((result) => ({ result, scoring }))
    );
  }

  for (let i = half; i < evalGames; i += 1) {
    const seed = seeds[i];
    const scoring = { winBase: 260, lossBase: -260, tieBase: -60, speedWeight: 6 };
    const opponents = buildOpponentBots(players, "hard", DEFAULT_HARD_STYLE);
    tasks.push(
      simulate({
        seed,
        mapSize,
        maxTurns,
        bots: [{ id: "A", name: "Hard Candidate", difficulty: "hard", hardStyle: style }, ...opponents],
      }).then((result) => ({ result, scoring }))
    );
  }

  const evaluate = Promise.all(tasks).then((results) => {
    for (const { result, scoring } of results) {
      score += scoreDuel({ winnerId: result.winnerId, turnsPlayed: result.turnsPlayed, maxTurns, ...scoring });
      if (!result.winnerId) {
        ties += 1;
      } else if (result.winnerId === "A") {
        wins += 1;
        winTurnsTotal += result.turnsPlayed;
      } else {
        losses += 1;
      }
    }

    return { score, wins, losses, ties, avgTurnsToWin: wins > 0 ? winTurnsTotal / wins : null };
  });
  if (!signal) return evaluate;
  return Promise.race([evaluate, abortPromise(signal)]);
}

async function readMatrix(matrixPath: string): Promise<HardStyleMatrixFile | null> {
  try {
    const raw = await readFile(matrixPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.schema !== "stellcon-hard-style-matrix-v1") return null;
    const entriesRaw = parsed.entries;
    if (!Array.isArray(entriesRaw)) return null;

    const entries: HardStyleMatrixEntry[] = [];
    for (const item of entriesRaw) {
      if (!isRecord(item)) continue;
      const mapSize = asMapSize(String(item.mapSize || ""));
      const maxTurns = Number(item.maxTurns);
      const players = Number(item.players);
      const style = normalizeHardBotStyle(item.style as Partial<HardBotStyle>);
      const evalRaw = item.eval;
      if (!Number.isFinite(maxTurns) || !Number.isFinite(players) || players < 2) continue;
      if (!isRecord(evalRaw)) continue;
      const evalSummary: EvalSummary = {
        score: Number(evalRaw.score) || 0,
        wins: Number(evalRaw.wins) || 0,
        losses: Number(evalRaw.losses) || 0,
        ties: Number(evalRaw.ties) || 0,
        avgTurnsToWin: typeof evalRaw.avgTurnsToWin === "number" ? evalRaw.avgTurnsToWin : null,
      };

      entries.push({
        createdAt: String(item.createdAt || ""),
        durationMs: Number(item.durationMs) || 0,
        mapSize,
        maxTurns: Math.floor(maxTurns),
        players: Math.floor(players),
        iters: Number(item.iters) || 0,
        evalGames: Number(item.evalGames) || 0,
        population: Number(item.population) || 0,
        threads: Number(item.threads) || 0,
        style,
        eval: evalSummary,
      });
    }

    return {
      schema: "stellcon-hard-style-matrix-v1",
      updatedAt: String(parsed.updatedAt || ""),
      entries,
    };
  } catch {
    return null;
  }
}

async function upsertMatrixEntry(matrixPath: string, entry: HardStyleMatrixEntry) {
  const existing = await readMatrix(matrixPath);
  const next: HardStyleMatrixFile = existing ?? {
    schema: "stellcon-hard-style-matrix-v1",
    updatedAt: "",
    entries: [],
  };

  const key = `${entry.mapSize}:${entry.players}:${entry.maxTurns}`;
  const filtered = next.entries.filter((e) => `${e.mapSize}:${e.players}:${e.maxTurns}` !== key);
  next.entries = [...filtered, entry].sort((a, b) => {
    const aKey = `${a.mapSize}:${String(a.players).padStart(2, "0")}:${String(a.maxTurns).padStart(3, "0")}`;
    const bKey = `${b.mapSize}:${String(b.players).padStart(2, "0")}:${String(b.maxTurns).padStart(3, "0")}`;
    return aKey.localeCompare(bKey);
  });
  next.updatedAt = new Date().toISOString();
  await writeFile(matrixPath, JSON.stringify(next, null, 2), "utf8");
}

export async function runTraining(options: TrainingOptions) {
  const startedAt = Date.now();
  const iters = Math.max(1, Math.floor(options.iters));
  const evalGames = Math.max(2, Math.floor(options.evalGames));
  const population = Math.max(2, Math.floor(options.population ?? 8));
  const mapSize = asMapSize(options.mapSize);
  const maxTurns = Math.max(10, Math.floor(options.maxTurns ?? 20));
  const players = Math.max(2, Math.min(8, Math.floor(options.players ?? 4)));
  const threads = Math.max(1, Math.min(32, Math.floor(options.threads ?? 1)));
  const signal = options.signal;

  const outDir = join(process.cwd(), "out");
  const matrixSeedPath = join(outDir, "hard-style-matrix.json");

  const rand = mulberry32(seedToInt(`arena-train:${mapSize}:${players}:${maxTurns}:${iters}:${evalGames}:${population}`));

  const pool = threads <= 1 ? null : new WorkerPool(new URL("./arenaWorker.js", import.meta.url), threads);
  const simulate = pool
    ? (payload: SimGameOptions) => pool.run<SimGameOptions, SimGameResult>("simulateGame", payload)
    : async (payload: SimGameOptions) => simulateGame(payload);

  let bestStyle = normalizeHardBotStyle(DEFAULT_HARD_STYLE);
  const existingMatrix = await readMatrix(matrixSeedPath);
  if (existingMatrix?.entries?.length) {
    const points: HardStyleMatrixPoint[] = existingMatrix.entries.map((entry) => ({
      mapSize: entry.mapSize,
      maxTurns: entry.maxTurns,
      players: entry.players,
      style: entry.style,
    }));
    const target = { mapSize, maxTurns, players };
    bestStyle = findExactHardStyle(points, target) ?? interpolateHardStyle(points, target) ?? bestStyle;
  }

  let bestEval = await evalCandidate({ style: bestStyle, evalGames, mapSize, maxTurns, players, simulate, signal });
  options.onProgress?.({ iter: 0, iters, bestStyle, bestEval });

  try {
    for (let iter = 1; iter <= iters; iter += 1) {
      throwIfAborted(signal);
      const magnitude = Math.max(0.03, 0.22 * (1 - iter / iters));

      let iterBestStyle = bestStyle;
      let iterBestEval = bestEval;

      for (let i = 0; i < population; i += 1) {
        throwIfAborted(signal);
        const candidate = i === 0 ? bestStyle : mutateStyle(bestStyle, rand, magnitude);
        const evaluated = await evalCandidate({ style: candidate, evalGames, mapSize, maxTurns, players, simulate, signal });
        if (evaluated.score > iterBestEval.score) {
          iterBestStyle = candidate;
          iterBestEval = evaluated;
        }
      }

      if (iterBestEval.score > bestEval.score) {
        bestStyle = iterBestStyle;
        bestEval = iterBestEval;
      }

      options.onProgress?.({ iter, iters, bestStyle, bestEval });
    }
  } finally {
    await pool?.close();
  }

  const outPath = join(outDir, "best-hard-style.json");
  const configOutPath = join(outDir, `hard-style-${mapSize}-p${players}-t${maxTurns}.json`);
  const matrixOutPath = join(outDir, "hard-style-matrix.json");
  const durationMs = Math.max(0, Date.now() - startedAt);
  const payload = {
    createdAt: new Date().toISOString(),
    durationMs,
    mapSize,
    maxTurns,
    players,
    iters,
    evalGames,
    population,
    threads,
    best: {
      style: bestStyle,
      eval: bestEval,
    },
  };

  let saveError: string | null = null;
  let configSaveError: string | null = null;
  let matrixError: string | null = null;

  try {
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveError = message;
    configSaveError = message;
    matrixError = message;
  }

  if (!saveError) {
    try {
      await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!configSaveError) {
    try {
      await writeFile(configOutPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (error) {
      configSaveError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!matrixError) {
    try {
      await upsertMatrixEntry(matrixOutPath, {
        createdAt: payload.createdAt,
        durationMs,
        mapSize,
        maxTurns,
        players,
        iters,
        evalGames,
        population,
        threads,
        style: bestStyle,
        eval: bestEval,
      });
    } catch (error) {
      matrixError = error instanceof Error ? error.message : String(error);
    }
  }

  const lines: string[] = [];
  lines.push("Training complete");
  lines.push(`- map: ${mapSize}`);
  lines.push(`- players: ${players}`);
  lines.push(`- maxTurns: ${maxTurns}`);
  lines.push(`- iters: ${iters}, population: ${population}, evalGames: ${evalGames}, threads: ${threads}`);
  lines.push(`- best score: ${bestEval.score.toFixed(2)}, wins: ${bestEval.wins}, losses: ${bestEval.losses}, ties: ${bestEval.ties}`);
  if (bestEval.avgTurnsToWin != null) {
    lines.push(`- avg turns to win: ${bestEval.avgTurnsToWin.toFixed(2)}`);
  }
  lines.push(`- best hard style: ${JSON.stringify(bestStyle)}`);
  if (saveError) {
    lines.push(`- saved: (failed) ${outPath}`);
    lines.push(`- save error: ${saveError}`);
  } else {
    lines.push(`- saved: ${outPath}`);
  }
  if (configSaveError) {
    lines.push(`- config file: (failed) ${configOutPath}`);
    lines.push(`- config file error: ${configSaveError}`);
  } else {
    lines.push(`- config file: ${configOutPath}`);
  }
  if (matrixError) {
    lines.push(`- matrix: (failed) ${matrixOutPath}`);
    lines.push(`- matrix error: ${matrixError}`);
  } else {
    lines.push(`- matrix: ${matrixOutPath}`);
  }

  return { text: lines.join("\n") };
}
