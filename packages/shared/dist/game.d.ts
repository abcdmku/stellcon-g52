import type { GameConfig, GameState, Orders, PlayerState, ResourceMap } from "./types.js";
export declare function normalizeCeveron(game: GameState): void;
export declare function createGame({ id, config, seed }?: {
    id?: string;
    config?: Partial<GameConfig>;
    seed?: string;
}): GameState;
export declare function addPlayer(game: GameState, { id, name, color: requestedColor }?: {
    id?: string;
    name?: string;
    color?: string;
}): PlayerState;
export declare function assignHomeworlds(game: GameState): void;
export declare function startGame(game: GameState): void;
export declare function initResources(value: number): ResourceMap;
export declare function computeIncome(game: GameState, playerId: string): {
    totals: ResourceMap;
    fleets: number;
    surplus: ResourceMap;
};
export declare function startPlanningPhase(game: GameState): void;
export declare function submitOrders(game: GameState, playerId: string, orders: Partial<Orders>): void;
export declare function lockIn(game: GameState, playerId: string): boolean;
export declare function beginResolution(game: GameState): void;
export declare function finalizeResolution(game: GameState): void;
export declare function resolveTurn(game: any): void;
export declare function setAlliance(game: GameState, fromId: string, toId: string): void;
export declare function isAllied(game: GameState, playerId: string | null, otherId: string | null): boolean;
export declare function redactGameState(game: GameState, viewerId: string | null): GameState;
//# sourceMappingURL=game.d.ts.map