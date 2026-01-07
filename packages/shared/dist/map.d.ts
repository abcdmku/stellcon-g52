import type { ResourceMap, SystemState } from "./types.js";
type Links = Record<string, string[]>;
type Rand = () => number;
export declare function rollResourcesForTier(tier: number, rand: Rand): ResourceMap;
export declare function generateGalaxy({ seed, width, height, density, homeworldCount, }?: {
    seed?: string;
    width?: number;
    height?: number;
    density?: number;
    homeworldCount?: number;
}): {
    systems: SystemState[];
    links: Links;
};
export declare function pickHomeworlds(systems: SystemState[], count: number, rand: Rand): SystemState[];
export {};
//# sourceMappingURL=map.d.ts.map