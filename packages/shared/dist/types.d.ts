export type ResourceType = "fusion" | "terrain" | "metal" | "crystal";
export type PowerupKey = "stellarBomb" | "terraform" | "defenseNet" | "wormhole";
export type Phase = "planning" | "resolving" | "complete";
export type MapSize = "small" | "medium" | "large" | "massive";
export type ResourceMap = Record<ResourceType, number>;
export interface GameConfig {
    maxTurns: number;
    mapSize: MapSize;
    maxPlayers: number;
    turnSeconds: number;
    isPrivate: boolean;
}
export interface SystemState {
    id: string;
    q: number;
    r: number;
    tier: number;
    resources: ResourceMap;
    ownerId: string | null;
    fleets: number;
    defenseNetTurns: number;
    terraformed: boolean;
}
export interface MoveOrder {
    fromId: string;
    toId: string;
    count: number;
}
export interface PowerupOrder {
    type: PowerupKey;
    targetId: string;
}
export interface ResearchOrder {
    resource: ResourceType;
    amount: number;
}
export interface Orders {
    placements: Record<string, number>;
    moves: MoveOrder[];
    powerups: PowerupOrder[];
    research: ResearchOrder[];
}
export interface PlayerPowerupState {
    unlocked: boolean;
    charges: number;
}
export type PlayerPowerups = Record<PowerupKey, PlayerPowerupState>;
export interface PlayerState {
    id: string;
    name: string;
    color: string;
    homeSystemId: string | null;
    income: ResourceMap;
    research: ResourceMap;
    powerups: PlayerPowerups;
    fleetsToPlace: number;
    wormholeTurns: number;
    alliances: Record<string, number>;
    connected?: boolean;
    locked: boolean;
    orders: Orders;
}
export interface RevealedMove {
    playerId: string;
    fromId: string;
    toId: string;
    count: number;
}
export interface ResolutionSkirmishRound {
    playerId: string | null;
    fleets: number;
}
export interface ResolutionBattleRound {
    attacker: number;
    defender: number;
}
export interface ResolutionBattle {
    targetId: string;
    defenderId: string | null;
    defenderColorId: string | null;
    attackerId: string | null;
    attackerStartFleets: number;
    attackerSkirmishRounds: ResolutionSkirmishRound[][];
    rounds: ResolutionBattleRound[];
    winnerId: string | null;
    winnerFleets: number;
    defenderStartFleets: number;
    startOffsetMs: number;
    durationMs: number;
}
export interface SystemUpdate {
    id: string;
    ownerId: string | null;
    fleets: number;
    defenseNetTurns: number;
}
export interface ResolutionPlan {
    systemUpdates: SystemUpdate[];
}
export interface GameState {
    id: string;
    seed: string;
    config: GameConfig;
    createdAt: number;
    turn: number;
    phase: Phase;
    turnEndsAt: number | null;
    systems: SystemState[];
    links: Record<string, string[]>;
    players: Record<string, PlayerState>;
    log: unknown[];
    winnerId: string | null;
    revealedMoves?: RevealedMove[];
    resolutionStartedAt?: number;
    resolutionEndsAt?: number;
    resolutionBattles?: ResolutionBattle[];
    resolutionPlan?: ResolutionPlan;
}
export interface GameListItem {
    gameId: string;
    players: number;
    maxPlayers: number;
    availableColors: string[];
    mapSize: MapSize;
    turn: number;
    phase: Phase;
}
//# sourceMappingURL=types.d.ts.map