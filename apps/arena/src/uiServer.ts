import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { cpus } from "node:os";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { runTraining } from "./trainingRunner.js";
import type { TrainingProgress } from "./trainingRunner.js";
import { summarizeTournament } from "./tournamentRunner.js";
import type { TournamentProgress } from "./tournamentRunner.js";

type RunType = "train" | "tournament";
type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type RunRecord = {
  id: string;
  type: RunType;
  status: RunStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  options: Record<string, unknown>;
  progress: Record<string, unknown> | null;
  logs: string[];
  error: string | null;
  resultText: string | null;
  abort: AbortController | null;
};

function now() {
  return Date.now();
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function asMapSize(value: unknown) {
  return value === "small" || value === "medium" || value === "large" || value === "massive" ? value : "medium";
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function text(res: ServerResponse, status: number, body: string, contentType = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.end(body);
}

async function readBodyJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function safeId() {
  try {
    return randomUUID().slice(0, 8);
  } catch {
    return String(Math.random()).slice(2, 10);
  }
}

function keepLast<T>(items: T[], max: number) {
  if (items.length <= max) return items;
  return items.slice(items.length - max);
}

export type ArenaUiOptions = {
  host?: string;
  port?: number;
};

export async function startArenaUiServer(options: ArenaUiOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4567;
  const defaultThreads = Math.max(1, Math.min(8, cpus().length || 1));

  const runs = new Map<string, RunRecord>();
  const runOrder: string[] = [];
  const queue: string[] = [];
  let runningId: string | null = null;

  const outDir = join(process.cwd(), "out");
  const matrixPath = join(outDir, "hard-style-matrix.json");
  const uiHtmlUrl = new URL("../public/arena-ui.html", import.meta.url);

  const pushLog = (run: RunRecord, line: string) => {
    run.logs.push(line);
    run.logs = keepLast(run.logs, 3000);
  };

  const pumpQueue = async () => {
    if (runningId) return;
    const nextId = queue.shift();
    if (!nextId) return;
    const run = runs.get(nextId);
    if (!run) return;
    if (run.status !== "queued") return;

    runningId = run.id;
    run.status = "running";
    run.startedAt = now();
    run.abort = new AbortController();

    pushLog(run, `Started ${run.type} (${new Date(run.startedAt).toLocaleString()})`);

    try {
      if (run.type === "train") {
        const iters = clampInt(run.options.iters, 1, 5000, 60);
        const evalGames = clampInt(run.options.evalGames, 2, 5000, 6);
        const population = clampInt(run.options.population, 2, 512, 8);
        const maxTurns = clampInt(run.options.maxTurns, 10, 500, 20);
        const players = clampInt(run.options.players, 2, 8, 4);
        const threads = clampInt(run.options.threads, 1, 32, defaultThreads);
        const mapSize = asMapSize(run.options.mapSize);

        const onProgress = (progress: TrainingProgress) => {
          run.progress = {
            iter: progress.iter,
            iters: progress.iters,
            bestScore: progress.bestEval.score,
          };
          if (progress.iter > 0) {
            pushLog(run, `iter ${progress.iter}/${progress.iters} bestScore=${progress.bestEval.score.toFixed(2)} bestStyle=${JSON.stringify(progress.bestStyle)}`);
          }
        };

        const result = await runTraining({
          iters,
          evalGames,
          population,
          maxTurns,
          players,
          threads,
          mapSize,
          signal: run.abort.signal,
          onProgress,
        });

        run.resultText = result.text;
        pushLog(run, "");
        pushLog(run, result.text);
      } else {
        const games = clampInt(run.options.games, 1, 200000, 30);
        const players = clampInt(run.options.players, 2, 8, 4);
        const maxTurns = clampInt(run.options.maxTurns, 10, 500, 20);
        const threads = clampInt(run.options.threads, 1, 32, defaultThreads);
        const mapSize = asMapSize(run.options.mapSize);

        const onProgress = (progress: TournamentProgress) => {
          run.progress = { completed: progress.completed, total: progress.total };
        };

        const result = await summarizeTournament({
          games,
          players,
          mapSize,
          maxTurns,
          threads,
          signal: run.abort.signal,
          onProgress,
        });

        run.resultText = result.text;
        pushLog(run, result.text);
      }

      run.status = "completed";
      run.finishedAt = now();
      pushLog(run, `Completed (${new Date(run.finishedAt).toLocaleString()})`);
    } catch (error) {
      const msg = errorMessage(error);
      if (msg === "Cancelled") {
        run.status = "cancelled";
      } else {
        run.status = "failed";
      }
      run.error = msg;
      run.finishedAt = now();
      pushLog(run, `Error: ${msg}`);
    } finally {
      run.abort = null;
      runningId = null;
      void pumpQueue();
    }
  };

  const enqueue = (type: RunType, options: Record<string, unknown>) => {
    const run: RunRecord = {
      id: safeId(),
      type,
      status: "queued",
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      options,
      progress: null,
      logs: [],
      error: null,
      resultText: null,
      abort: null,
    };
    runs.set(run.id, run);
    runOrder.unshift(run.id);
    queue.push(run.id);
    void pumpQueue();
    return run;
  };

  const cancelRun = (id: string) => {
    const run = runs.get(id);
    if (!run) return false;
    if (run.status === "queued") {
      run.status = "cancelled";
      run.finishedAt = now();
      run.error = "Cancelled";
      const index = queue.indexOf(id);
      if (index >= 0) queue.splice(index, 1);
      pushLog(run, "Cancelled (queued)");
      return true;
    }
    if (run.status === "running") {
      run.abort?.abort();
      pushLog(run, "Cancel requested…");
      return true;
    }
    return false;
  };

  const clearCompleted = () => {
    const keep = new Set<string>();
    for (const id of runOrder) {
      const run = runs.get(id);
      if (!run) continue;
      if (run.status === "queued" || run.status === "running") keep.add(id);
    }
    for (const id of [...runs.keys()]) {
      if (keep.has(id)) continue;
      runs.delete(id);
    }
    const nextOrder = runOrder.filter((id) => keep.has(id));
    runOrder.length = 0;
    runOrder.push(...nextOrder);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      res.setHeader("cache-control", "no-store");
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");

      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(uiHtmlUrl, "utf8");
        text(res, 200, html, "text/html; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/defaults") {
        json(res, 200, {
          defaultThreads,
          mapSizes: ["small", "medium", "large", "massive"],
          maxPlayers: 8,
          minPlayers: 2,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        const running = runningId ? true : false;
        json(res, 200, { running, queueLength: queue.length, runs: runs.size, runningId });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/runs") {
        const items = runOrder
          .map((id) => runs.get(id))
          .filter((run): run is RunRecord => Boolean(run))
          .map((run) => ({
            id: run.id,
            type: run.type,
            status: run.status,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            options: run.options,
            progress: run.progress,
            logsCount: run.logs.length,
            error: run.error,
          }));
        json(res, 200, { items });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/runs/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const id = parts[2] || "";
        if (!id) {
          json(res, 400, { error: "Run id required" });
          return;
        }
        const run = runs.get(id);
        if (!run) {
          json(res, 404, { error: "Run not found" });
          return;
        }
        json(res, 200, run);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/train") {
        const body = (await readBodyJson(req)) as any;
        const run = enqueue("train", {
          mapSize: asMapSize(body?.mapSize),
          players: clampInt(body?.players, 2, 8, 4),
          maxTurns: clampInt(body?.maxTurns, 10, 500, 20),
          iters: clampInt(body?.iters, 1, 5000, 60),
          evalGames: clampInt(body?.evalGames, 2, 5000, 6),
          population: clampInt(body?.population, 2, 512, 8),
          threads: clampInt(body?.threads, 1, 32, defaultThreads),
        });
        json(res, 200, { ok: true, runId: run.id });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tournament") {
        const body = (await readBodyJson(req)) as any;
        const run = enqueue("tournament", {
          mapSize: asMapSize(body?.mapSize),
          players: clampInt(body?.players, 2, 8, 4),
          maxTurns: clampInt(body?.maxTurns, 10, 500, 20),
          games: clampInt(body?.games, 1, 200000, 30),
          threads: clampInt(body?.threads, 1, 32, defaultThreads),
        });
        json(res, 200, { ok: true, runId: run.id });
        return;
      }

      if (req.method === "POST" && url.pathname.endsWith("/cancel") && url.pathname.startsWith("/api/runs/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        const id = parts[2] || "";
        if (!id) {
          json(res, 400, { error: "Run id required" });
          return;
        }
        const ok = cancelRun(id);
        if (!ok) {
          json(res, 400, { error: "Run cannot be cancelled" });
          return;
        }
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/runs/clearCompleted") {
        clearCompleted();
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/matrix") {
        try {
          const raw = await readFile(matrixPath, "utf8");
          text(res, 200, raw, "application/json; charset=utf-8");
        } catch {
          json(res, 404, { error: "Matrix file not found", path: matrixPath });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/out-files") {
        try {
          const entries = await readdir(outDir, { withFileTypes: true });
          const files = entries
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .filter((name) => name.endsWith(".json"))
            .sort();
          json(res, 200, { dir: outDir, files });
        } catch {
          json(res, 200, { dir: outDir, files: [] });
        }
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, { error: errorMessage(error) });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => resolve());
  });

  const actual = server.address();
  const baseUrl =
    typeof actual === "object" && actual && typeof actual.port === "number"
      ? `http://${host}:${actual.port}`
      : `http://${host}:${port}`;

  console.log(`Arena UI listening on ${baseUrl}`);

  return { server, url: baseUrl };
}
