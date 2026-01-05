import type { SystemState } from "./types.js";
type Links = Record<string, string[]>;
type Rand = () => number;
export declare function generateGalaxy({ seed, width, height, density, }?: {
    seed?: string;
    width?: number;
    height?: number;
    density?: number;
}): {
    systems: SystemState[];
    links: Links;
};
export declare function pickHomeworlds(systems: SystemState[], count: number, rand: Rand): SystemState[];
export {};
//# sourceMappingURL=map.d.ts.map