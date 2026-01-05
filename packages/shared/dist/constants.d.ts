export declare const RESOURCE_TYPES: string[];
export declare const RESOURCE_COLORS: {
    fusion: string;
    terrain: string;
    metal: string;
    crystal: string;
};
export declare const POWERUPS: {
    stellarBomb: {
        key: string;
        label: string;
        unlockCost: number;
        cost: number;
        resource: string;
        duration: number;
    };
    terraform: {
        key: string;
        label: string;
        unlockCost: number;
        cost: number;
        resource: string;
        duration: number;
    };
    defenseNet: {
        key: string;
        label: string;
        unlockCost: number;
        cost: number;
        resource: string;
        duration: number;
    };
    wormhole: {
        key: string;
        label: string;
        unlockCost: number;
        cost: number;
        resource: string;
        duration: number;
    };
};
export declare const PLAYER_COLORS: string[];
export declare const MAP_SIZES: {
    small: {
        width: number;
        height: number;
    };
    medium: {
        width: number;
        height: number;
    };
    large: {
        width: number;
        height: number;
    };
    massive: {
        width: number;
        height: number;
    };
};
export declare const DEFAULT_CONFIG: {
    maxTurns: number;
    mapSize: string;
    maxPlayers: number;
    turnSeconds: number;
    isPrivate: boolean;
};
export declare const PHASES: {
    planning: string;
    resolving: string;
    complete: string;
};
export declare const HOMEWORLD_FLEETS = 10;
export declare const RESOLUTION_TRAVEL_MS = 1200;
//# sourceMappingURL=constants.d.ts.map