export function buildConnectedComponentIndex(ids, links) {
    const idSet = new Set(ids);
    const componentById = {};
    let component = 0;
    for (const id of ids) {
        if (componentById[id] !== undefined)
            continue;
        componentById[id] = component;
        const queue = [id];
        while (queue.length) {
            const current = queue.shift();
            if (!current)
                continue;
            for (const nextId of links?.[current] || []) {
                if (!idSet.has(nextId))
                    continue;
                if (componentById[nextId] !== undefined)
                    continue;
                componentById[nextId] = component;
                queue.push(nextId);
            }
        }
        component += 1;
    }
    return componentById;
}
export function inSameConnectedComponent(componentById, aId, bId) {
    const a = componentById[aId];
    const b = componentById[bId];
    if (a === undefined || b === undefined)
        return false;
    return a === b;
}
//# sourceMappingURL=graph.js.map