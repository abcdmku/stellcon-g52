# `@stellcon/bots`

Shared AI (bot) decision-making for Stellcon.

This package is used by:
- `apps/server` to generate orders for AI players during live games.
- `apps/arena` to run bot-vs-bot simulations and tune hard-bot parameters via self-play.

## Install / Build (workspace)

From repo root:
- `pnpm --filter @stellcon/bots typecheck`
- `pnpm --filter @stellcon/bots build`
- `pnpm --filter @stellcon/bots dev` (watch mode)

## Public API

All exports come from `packages/bots/src/index.ts`.

### `planBotOrders(game, playerId, difficulty): Orders`

Primary entrypoint used by the server.
- Returns empty orders if the game is not in the `planning` phase.
- Delegates to one of:
  - `planEasy`
  - `planMedium`
  - `planHard`

### Hard bot (configurable)

Hard mode supports a “style” object, which is how the arena “learns” without changing code.

- `planHard(game, playerId, style?: Partial<HardBotStyle>): Orders`
- `DEFAULT_HARD_STYLE`
- `normalizeHardBotStyle(style): HardBotStyle`
- `type HardBotStyle = { aggression; expansion; focus; tactics }` (each `0..1`)

`normalizeHardBotStyle` clamps values to `0..1` and fills missing fields from `DEFAULT_HARD_STYLE`.

## Hard bot style knobs

The hard bot is a heuristic planner that scores targets, picks a primary focus target, and then spends remaining fleets on secondary value attacks. The style parameters shift constants and thresholds inside that planner.

### `aggression` (`0..1`)

Higher aggression generally:
- Keeps fewer fleets back for defense (“spends” more fleets forward).
- Accepts lower win probabilities for attacks.
- Allows more secondary attacks against tougher defenders.

### `expansion` (`0..1`)

Higher expansion generally:
- Values neutral capture more (especially early).
- Spreads fleets across more owned systems (“more pads”).
- Increases “system count” value to prioritize growth.

### `focus` (`0..1`)

Higher focus generally:
- Weights higher-tier / higher-value targets more heavily.
- Puts more emphasis on hitting the current leader.
- Increases production-gain and enemy-loss weighting in target valuation.

### `tactics` (`0..1`)

Higher tactics generally:
- Uses powerups more aggressively (wormholes and stellar bombs).
- Lowers thresholds for “special plays” when a target’s value is high enough.

### Determinism

Bots use a seeded RNG (`botRand`) derived from the game state + player id + difficulty, so the same game seed produces repeatable bot behavior. For hard mode, the style is included in the RNG salt so different styles are deterministically different.

## How the planner works (high level)

Hard bot planning is roughly:
1. Compute economies and resource weights (what resources matter most right now).
2. Compute per-system “threat” and decide how many fleets to keep at home.
3. Allocate placements across multiple owned systems (“pads”).
4. Attack neutrals efficiently (good value per fleet).
5. Pick a primary enemy target to focus (optionally bomb it) and coordinate multiple pads into one attack.
6. Spend remaining fleets on secondary enemy attacks.
7. Consider utility powerups (terraform target selection, wormholes) when valuable.

Easy/medium reuse subsets/simplifications of this logic.

## Code structure

Key modules in `packages/bots/src/`:
- `index.ts`: package exports + `planBotOrders`
- `easy.ts`, `medium.ts`, `hard.ts`: difficulty-specific planners
- `combat.ts`: combat odds + “fleets needed” helpers
- `economy.ts`: production / resource weighting / scoring
- `game.ts`: reachability, threat, ownership helpers
- `powerups.ts`: powerup target helpers (e.g. terraform)
- `rand.ts`: deterministic bot RNG
- `shared.ts`: shared helpers (`blankOrders`, clamping, weighted picking)

## Arena integration ("learning")

`apps/arena` runs repeated simulations and uses simple parameter search (mutation + hill-climb) to find a `HardBotStyle` that wins more and wins faster.

Example:
- `pnpm --filter arena build`
- `pnpm --filter arena train -- --players 4 --iters 80 --evalGames 6 --population 10 --maxTurns 20`

Training flags:
- `--players <int>`: Players per simulated game (min `2`, default `4`).
- `--iters <int>`: Number of training iterations (min `1`, default `60`).
- `--population <int>`: How many style variants are tried each iteration (min `2`, default `8`). Higher explores more variants per iter but takes longer.
- `--evalGames <int>`: How many simulated games are used to score each candidate style (min `2`, default `6`). Higher reduces randomness/noise but takes longer.
- `--maxTurns <int>`: Max turns per simulated game (min `10`, default `20`).
- `--map <small|medium|large|massive>`: Map size used for evaluation (default `medium`).
- `--threads <int>`: Worker threads used to run simulations in parallel (default auto, up to `8`). Use `1` to disable parallelism.

How training works (overview):
1. Start from `DEFAULT_HARD_STYLE` as the current “best” style.
2. Repeat for `--iters` iterations:
   - Generate `--population` candidate styles:
     - One candidate is the current best (baseline).
     - The rest are small random mutations of the best (4 numbers: `aggression/expansion/focus/tactics`, each clamped to `0..1`).
   - Score each candidate by running `--evalGames` simulated games (with `--players` total players):
     - Roughly half are candidate hard + (`players - 1`) `medium` opponents.
     - The rest are candidate hard + (`players - 1`) default hard opponents (to avoid “overfitting” only to medium).
   - Keep the best-scoring candidate; if it beats the global best, update the global best.
3. Save the best style + its evaluation summary:
   - `apps/arena/out/best-hard-style.json` (latest run)
   - `apps/arena/out/hard-style-<map>-p<players>-t<maxTurns>.json` (config-specific)
   - `apps/arena/out/hard-style-matrix.json` (accumulates many configs)

Tiny picture of the loop:
```text
best = DEFAULT_HARD_STYLE
for iter in 1..iters:
  candidates = [best] + mutate(best) x (population-1)
  for c in candidates:
    score(c) = run evalGames simulated matches
  best = argmax(score)
write best-hard-style.json
```

Notes:
- Runs are deterministic for the same flags (seed is derived from flag values).
- Output is written under `apps/arena/out/` (when run via `pnpm --filter arena ...`).
- The matrix file is meant to hold many runs for different `(mapSize, maxTurns, players)` combos; consumers can pick an exact match or interpolate between nearby runs when a combo is missing.

This writes a JSON file like `apps/arena/out/best-hard-style.json` containing:
- `best.style` (`HardBotStyle`)
- `best.eval` (wins/losses/ties and average turns to win)

The server can be configured to use that trained style (see `apps/server/src/ai/bots.ts`).

## Adding a new bot / difficulty

1. Add a new planner file (e.g. `veryHard.ts`) that returns `Orders`.
2. Keep it deterministic by using `botRand` instead of `Math.random`.
3. Export it from `index.ts` and update call sites accordingly.
