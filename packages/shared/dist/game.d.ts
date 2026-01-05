export declare function createGame({ id, config, seed }?: {
    config?: {};
    seed?: string;
}): {
    id: any;
    seed: string;
    config: {
        maxTurns: number;
        mapSize: string;
        maxPlayers: number;
        turnSeconds: number;
        isPrivate: boolean;
    };
    createdAt: number;
    turn: number;
    phase: string;
    turnEndsAt: any;
    systems: {
        id: string;
        q: any;
        r: any;
        tier: number;
        resources: {};
        ownerId: any;
        fleets: number;
        defenseNetTurns: number;
        terraformed: boolean;
    }[];
    links: {};
    players: {};
    log: any[];
    winnerId: any;
};
export declare function addPlayer(game: any, { id, name, color: requestedColor }?: {}): any;
export declare function assignHomeworlds(game: any): void;
export declare function startGame(game: any): void;
export declare function initResources(value: any): {};
export declare function computeIncome(game: any, playerId: any): {
    totals: {};
    fleets: number;
    surplus: {};
};
export declare function startPlanningPhase(game: any): void;
export declare function submitOrders(game: any, playerId: any, orders: any): void;
export declare function lockIn(game: any, playerId: any): boolean;
export declare function beginResolution(game: any): void;
export declare function finalizeResolution(game: any): void;
export declare function resolveTurn(game: any): void;
export declare function setAlliance(game: any, fromId: any, toId: any): void;
export declare function isAllied(game: any, playerId: any, otherId: any): boolean;
export declare function redactGameState(game: any, viewerId: any): {
    id: any;
    seed: any;
    config: any;
    createdAt: any;
    turn: any;
    phase: any;
    turnEndsAt: any;
    systems: any;
    links: any;
    players: {
        [k: string]: any;
    };
    log: any;
    winnerId: any;
    revealedMoves: any;
    resolutionStartedAt: any;
    resolutionEndsAt: any;
    resolutionBattles: any;
};
//# sourceMappingURL=game.d.ts.map