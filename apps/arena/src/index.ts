import { runTournament } from "./tournament.js";
import { trainHardStyle } from "./train.js";
import { runArenaUi } from "./ui.js";
import { cpus } from "node:os";

function usage() {
  return [
    "Stellcon Arena",
    "",
    "Commands:",
    "  tournament  Run bot-vs-bot matches",
    "  train       Tune hard-bot style via self-play",
    "  ui          Local web UI for runs",
    "",
    "Flags:",
    "  --map        small|medium|large|massive",
    "  --maxTurns   Max turns per game (default 20)",
    "  --threads    Worker threads (default auto, up to 8)",
    "  --host       UI host (default 127.0.0.1)",
    "  --port       UI port (default 4567)",
    "  --games      Tournament games (default 30)",
    "  --players    Players per game (default 4)",
    "  --iters      Training iterations (default 60)",
    "  --evalGames  Eval games per candidate (default 6)",
    "  --population Candidates per iter (default 8)",
    "",
    "Examples:",
    "  pnpm --filter arena build",
    "  pnpm --filter arena tournament -- --games 50 --players 4",
    "  pnpm --filter arena tournament -- --games 50 --players 4 --maxTurns 20",
    "  pnpm --filter arena train -- --iters 80 --evalGames 6 --population 10 --maxTurns 20",
    "  pnpm --filter arena ui -- --port 4567",
    "",
  ].join("\n");
}

function parseFlag(args: string[], name: string) {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function parseIntFlag(args: string[], name: string, fallback: number) {
  const raw = parseFlag(args, name);
  const value = raw == null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const [, , command, ...args] = process.argv;
  const defaultThreads = Math.max(1, Math.min(8, cpus().length || 1));

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    process.exit(0);
  }

  if (command === "tournament") {
    const games = parseIntFlag(args, "games", 30);
    const players = parseIntFlag(args, "players", 4);
    const mapSize = parseFlag(args, "map") ?? "medium";
    const maxTurns = parseIntFlag(args, "maxTurns", 20);
    const threads = parseIntFlag(args, "threads", defaultThreads);
    await runTournament({ games, players, mapSize, maxTurns, threads });
    return;
  }

  if (command === "train") {
    const iters = parseIntFlag(args, "iters", 60);
    const evalGames = parseIntFlag(args, "evalGames", 6);
    const mapSize = parseFlag(args, "map") ?? "medium";
    const maxTurns = parseIntFlag(args, "maxTurns", 20);
    const players = parseIntFlag(args, "players", 4);
    const population = parseIntFlag(args, "population", 8);
    const threads = parseIntFlag(args, "threads", defaultThreads);
    await trainHardStyle({ iters, evalGames, mapSize, maxTurns, players, population, threads });
    return;
  }

  if (command === "ui") {
    const host = parseFlag(args, "host") ?? "127.0.0.1";
    const port = parseIntFlag(args, "port", 4567);
    await runArenaUi({ host, port });
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  console.error(usage());
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
