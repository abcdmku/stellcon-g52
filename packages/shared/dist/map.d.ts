export declare function generateGalaxy({ seed, width, height, density }?: {
    seed?: string;
    width?: number;
    height?: number;
    density?: number;
}): {
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
};
export declare function pickHomeworlds(systems: any, count: any, rand: any): any[];
//# sourceMappingURL=map.d.ts.map