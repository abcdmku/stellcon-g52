export declare const CORE_RESOURCE_TYPES: readonly ["fusion", "terrain", "metal", "crystal"];
export declare const RESOURCE_TYPES: readonly ["fusion", "terrain", "metal", "crystal", "ceveron"];
export declare const RESOURCE_COLORS: {
    fusion: string;
    terrain: string;
    metal: string;
    crystal: string;
    ceveron: string;
};
export declare const POWERUPS: {
    readonly stellarBomb: {
        readonly key: "stellarBomb";
        readonly label: "Stellar Bomb";
        readonly unlockCost: 20;
        readonly cost: 20;
        readonly resource: "metal";
        readonly duration: 0;
    };
    readonly terraform: {
        readonly key: "terraform";
        readonly label: "Terraform";
        readonly unlockCost: 20;
        readonly cost: 20;
        readonly resource: "terrain";
        readonly duration: 0;
    };
    readonly defenseNet: {
        readonly key: "defenseNet";
        readonly label: "Defense Net";
        readonly unlockCost: 20;
        readonly cost: 20;
        readonly resource: "crystal";
        readonly duration: 3;
    };
    readonly wormhole: {
        readonly key: "wormhole";
        readonly label: "Wormhole";
        readonly unlockCost: 20;
        readonly cost: 20;
        readonly resource: "fusion";
        readonly duration: 3;
    };
};
export declare const PLAYER_COLORS: readonly ["#ff5f6d", "#ff9f43", "#ffd93d", "#3dffb8", "#35d0ff", "#4a7dff", "#b06cff", "#ff5fe7"];
export declare const MAP_SIZES: {
    readonly small: {
        readonly width: 12;
        readonly height: 4;
    };
    readonly medium: {
        readonly width: 18;
        readonly height: 6;
    };
    readonly large: {
        readonly width: 24;
        readonly height: 8;
    };
    readonly massive: {
        readonly width: 36;
        readonly height: 12;
    };
};
export declare const DEFAULT_CONFIG: {
    readonly maxTurns: 20;
    readonly mapSize: "medium";
    readonly maxPlayers: 2;
    readonly turnSeconds: 90;
    readonly isPrivate: false;
};
export declare const PHASES: {
    readonly planning: "planning";
    readonly resolving: "resolving";
    readonly complete: "complete";
};
export declare const HOMEWORLD_FLEETS = 10;
export declare const RESOLUTION_TRAVEL_MS = 1200;
//# sourceMappingURL=constants.d.ts.map