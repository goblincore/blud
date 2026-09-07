import type { Aabb, RoomDef, TunnelDef } from './game-level';
import type { Vec3 } from '../types';
import type { WanderBounds } from '../wander';
/** Static floor routing. Collision inflation keeps the entire actor clear;
 * no diagonal corner cuts and no rays through the unwalkable centre block. */
export function createEncounterNavigation(rooms: readonly RoomDef[], tunnels: readonly TunnelDef[], boxes: readonly Aabb[], radius = .34) {
    const bounds: WanderBounds = { minX: Math.min(...rooms.map(r => r.minX)), maxX: Math.max(...rooms.map(r => r.maxX)),
        minZ: Math.min(...rooms.map(r => r.minZ)), maxZ: Math.max(...rooms.map(r => r.maxZ)) };
    const step = .4;
    const solids = boxes.filter(b => b.min[1] < 1.8 && b.max[1] > .1);
    const floors = [...rooms, ...tunnels];
    const canStand = (p: Vec3) => floors.some(r => p[0] >= r.minX && p[0] <= r.maxX && p[2] >= r.minZ && p[2] <= r.maxZ)
        && !solids.some(b => p[0] > b.min[0] - radius && p[0] < b.max[0] + radius && p[2] > b.min[2] - radius && p[2] < b.max[2] + radius);
    const canTravel = (a: Vec3, b: Vec3) => {
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / .12));
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (!canStand([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]))
                return false;
        }
        return true;
    };
    const nx = Math.ceil((bounds.maxX - bounds.minX) / step), nz = Math.ceil((bounds.maxZ - bounds.minZ) / step);
    const point = (i: number): Vec3 => [bounds.minX + (i % nx + .5) * step, 0, bounds.minZ + (Math.floor(i / nx) + .5) * step];
    const open = Uint8Array.from({ length: nx * nz }, (_, i) => canStand(point(i)) ? 1 : 0);
    const edges = Array.from({ length: open.length }, () => [] as number[]);
    for (let i = 0; i < open.length; i++)
        if (open[i])
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const x = i % nx + dx!, z = Math.floor(i / nx) + dz!;
                if (x < 0 || x >= nx || z < 0 || z >= nz)
                    continue;
                const j = z * nx + x;
                if (open[j] && canTravel(point(i), point(j)))
                    edges[i]!.push(j);
            }
    const nearest = (p: Vec3) => {
        let best = -1, dist = Infinity;
        for (let i = 0; i < open.length; i++)
            if (open[i]) {
                const q = point(i), d = Math.hypot(q[0] - p[0], q[2] - p[2]);
                if (d < dist && d < 1.5 && canTravel(p, q)) {
                    best = i;
                    dist = d;
                }
            }
        return best;
    };
    const route = (from: Vec3, to: Vec3): Vec3[] => {
        if (canTravel(from, to))
            return [[...to] as Vec3];
        const start = nearest(from), end = nearest(to);
        if (start < 0 || end < 0)
            return [];
        const parent = new Int32Array(open.length).fill(-1), queue = [start];
        parent[start] = start;
        for (let at = 0; at < queue.length && parent[end] === -1; at++)
            for (const j of edges[queue[at]!]!)
                if (parent[j] === -1) {
                    parent[j] = queue[at]!;
                    queue.push(j);
                }
        if (parent[end] === -1)
            return [];
        const path: Vec3[] = [];
        for (let i = end; i !== start; i = parent[i]!)
            path.push(point(i));
        path.reverse();
        path.push([...to] as Vec3);
        return path;
    };
    const follow = (from: Vec3, path: readonly Vec3[]): Vec3 | null => {
        for (let i = path.length - 1; i >= 0; i--)
            if (canTravel(from, path[i]!))
                return path[i]!;
        return null;
    };
    const roomAt = (p: Vec3) => {
        const room = rooms.find(r => p[0] >= r.minX && p[0] <= r.maxX && p[2] >= r.minZ && p[2] <= r.maxZ);
        if (room)
            return room.id;
        const tunnel = tunnels.find(t => p[0] >= t.minX && p[0] <= t.maxX && p[2] >= t.minZ && p[2] <= t.maxZ);
        if (!tunnel)
            return 0;
        const mid = tunnel.axis === 'x' ? (tunnel.minX + tunnel.maxX) / 2 : (tunnel.minZ + tunnel.maxZ) / 2;
        const r = rooms.find(r => r.id === tunnel.a)!;
        const c = tunnel.axis === 'x' ? (r.minX + r.maxX) / 2 : (r.minZ + r.maxZ) / 2;
        return ((tunnel.axis === 'x' ? p[0] : p[2]) - mid) * (c - mid) >= 0 ? tunnel.a : tunnel.b;
    };
    return { bounds, canStand, canTravel, route, follow, roomAt };
}
export type EncounterNavigation = ReturnType<typeof createEncounterNavigation>;
