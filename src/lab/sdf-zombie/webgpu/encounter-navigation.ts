// src/lab/sdf-zombie/webgpu/encounter-navigation.ts
//
// Static floor navigation for encounters: a grid path planner over rooms and tunnels that keeps actors clear of solid boxes.
// The grid, BFS route and follow live in grid-navigation.ts; this file says what standing and travel mean on a room level.

import type { Aabb, RoomDef, TunnelDef } from './game-level';
import type { Vec3 } from '../types';
import type { WanderBounds } from '../wander';
import { createGridNavigation, type EncounterNavigation } from './grid-navigation';

export type { EncounterNavigation } from './grid-navigation';

/** Static floor routing. Collision inflation keeps the entire actor clear;
 * no diagonal corner cuts and no rays through the unwalkable centre block. */
export function createEncounterNavigation(rooms: readonly RoomDef[], tunnels: readonly TunnelDef[], boxes: readonly Aabb[], radius = .34): EncounterNavigation {
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
    return createGridNavigation({ bounds, step, canStand, canTravel, roomAt, floorAt: () => 0 });
}
