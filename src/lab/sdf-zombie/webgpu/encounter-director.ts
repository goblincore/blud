import type { Vec3 } from '../types';
import type { BrainPlayer } from '../brain';
import type { Aabb } from './game-level';
import type { EncounterNavigation } from './encounter-navigation';
export interface EncounterAgent {
    id: number;
    pos: Vec3;
    yaw: number;
    home: Vec3;
    room: number;
    soldier: boolean;
    disabled: boolean;
}
export interface EncounterOrder {
    mode: 'idle' | 'combat' | 'pursue' | 'search' | 'return' | 'yield';
    player: BrainPlayer | null;
    visible: boolean;
    fireAllowed: boolean;
    moveTarget: Vec3 | null;
    halt: boolean;
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export function clearSight(a: Vec3, b: Vec3, boxes: readonly Aabb[]): boolean {
    for (const box of boxes) {
        let lo = 0, hi = 1;
        for (let k = 0; k < 3; k++) {
            const d = b[k]! - a[k]!;
            if (Math.abs(d) < 1e-8) {
                if (a[k]! < box.min[k]! || a[k]! > box.max[k]!) {
                    lo = 2;
                    break;
                }
                continue;
            }
            const u = (box.min[k]! - a[k]!) / d, v = (box.max[k]! - a[k]!) / d;
            lo = Math.max(lo, Math.min(u, v));
            hi = Math.min(hi, Math.max(u, v));
        }
        if (lo <= hi && hi >= 0 && lo <= 1)
            return false;
    }
    return true;
}
/** Conservative shotgun lane, widened with distance for the pellet spread. */
export function clearFireLane(self: EncounterAgent, target: Vec3, agents: readonly EncounterAgent[]): boolean {
    const dx = target[0] - self.pos[0], dz = target[2] - self.pos[2], length = Math.hypot(dx, dz);
    if (length < .001)
        return false;
    return !agents.some(a => {
        if (a.id === self.id || a.disabled)
            return false;
        const along = ((a.pos[0] - self.pos[0]) * dx + (a.pos[2] - self.pos[2]) * dz) / length;
        const side = Math.abs((a.pos[0] - self.pos[0]) * dz - (a.pos[2] - self.pos[2]) * dx) / length;
        return along > 0 && along < length + .2 && side < .45 + along * .07;
    });
}
export function createEncounterDirector(nav: EncounterNavigation, boxes: readonly Aabb[]) {
    type Memory = {
        at: Vec3;
        age: number;
        search: number;
    };
    const memory = new Map<number, Memory>(), lastShot = new Map<number, number>();
    const routes = new Map<number, {
        goal: Vec3;
        path: Vec3[];
        age: number;
    }>();
    let clock = 0, owner: number | null = null, lease = 0, pause = 0;
    const observed = new Map<number, boolean>();
    const nextPoint = (a: EncounterAgent, goal: Vec3, dt: number) => {
        let route = routes.get(a.id);
        if (!route || distance(route.goal, goal) > .6 || route.age > .65) {
            route = { goal: [...goal] as Vec3, path: nav.route(a.pos, goal), age: 0 };
            routes.set(a.id, route);
        }
        route.age += dt;
        return nav.follow(a.pos, route.path);
    };
    return {
        shot(id: number) { lastShot.set(id, clock); if (owner === id) {
            owner = null;
            lease = 0;
            pause = .45;
        } },
        clear() { memory.clear(); routes.clear(); lastShot.clear(); owner = null; lease = 0; pause = 0; },
        debug: () => ({ owner, memories: [...memory].map(([id, m]) => ({ id, at: m.at, age: m.age })) }),
        update(agents: readonly EncounterAgent[], player: BrainPlayer | null, gunshot: boolean, dt: number): Map<number, EncounterOrder> {
            clock += dt;
            lease -= dt;
            pause = Math.max(0, pause - dt);
            observed.clear();
            const ids = new Set(agents.map(a => a.id));
            for (const id of memory.keys())
                if (!ids.has(id)) {
                    memory.delete(id);
                    routes.delete(id);
                    lastShot.delete(id);
                }
            const target: Vec3 | null = player ? [player.x, 0, player.z] : null;
            for (const a of agents) {
                if (a.disabled) {
                    memory.delete(a.id);
                    continue;
                }
                const prior = memory.get(a.id);
                const dx = target ? target[0] - a.pos[0] : 0, dz = target ? target[2] - a.pos[2] : 0;
                const bearing = Math.atan2(dx, dz), angle = Math.atan2(Math.sin(bearing - a.yaw), Math.cos(bearing - a.yaw));
                const visible = !!target && distance(a.pos, target) < 10 && (!!prior || Math.abs(angle) < Math.PI * .39)
                    && clearSight([a.pos[0], 1.4, a.pos[2]], [target[0], 1.4, target[2]], boxes);
                observed.set(a.id, visible);
                if (visible || (gunshot && target && distance(a.pos, target) < 12))
                    memory.set(a.id, { at: [...target!] as Vec3, age: 0, search: 0 });
                else if (prior) {
                    prior.age += dt;
                    if (prior.age > 8)
                        memory.delete(a.id);
                }
            }
            // One hop from direct observations only; relays cannot refresh one
            // another forever or broadcast the player into unopened rooms.
            for (const a of agents)
                if (!a.disabled && !observed.get(a.id)) {
                    const ally = agents.find(b => observed.get(b.id) && b.room === a.room && distance(a.pos, b.pos) < 6);
                    if (ally && target)
                        memory.set(a.id, { at: [...target] as Vec3, age: 0, search: 0 });
                }
            const candidates = agents.filter(a => a.soldier && !a.disabled && observed.get(a.id) && target && distance(a.pos, target) <= 6 && clearFireLane(a, target, agents));
            if (lease <= 0 || !candidates.some(a => a.id === owner)) {
                owner = null;
                lease = 0;
            }
            if (owner === null && pause <= 0 && candidates.length) {
                candidates.sort((a, b) => (lastShot.get(a.id) ?? -100) - (lastShot.get(b.id) ?? -100) || a.id - b.id);
                owner = candidates[0]!.id;
                lease = 3.5;
                lastShot.set(owner, clock); // stalled leases rotate too
            }
            const orders = new Map<number, EncounterOrder>();
            for (const a of agents) {
                const known = memory.get(a.id), visible = observed.get(a.id) ?? false;
                let goal: Vec3 | null = null, halt = false, mode: EncounterOrder['mode'] = 'idle';
                const fireAllowed = owner === a.id && visible && !!target && clearFireLane(a, target, agents);
                if (a.disabled) {
                    orders.set(a.id, { mode: 'idle', player: null, visible: false, fireAllowed: false, moveTarget: null, halt: true });
                    continue;
                }
                if (visible && target) {
                    mode = 'combat';
                    if (a.soldier && !fireAllowed) {
                        const blocked = !clearFireLane(a, target, agents), crowded = agents.some(b => b.id !== a.id && !b.disabled && distance(a.pos, b.pos) < 1.05);
                        if (blocked || crowded || distance(a.pos, target) > 4.5) {
                            const bearing = Math.atan2(a.pos[0] - target[0], a.pos[2] - target[2]);
                            const choices = [-.65, .65, -1.1, 1.1, 0].map(offset => [target[0] + Math.sin(bearing + offset) * 3.8, 0, target[2] + Math.cos(bearing + offset) * 3.8] as Vec3)
                                .filter(p => nav.canStand(p) && agents.every(b => b.id === a.id || b.disabled || distance(p, b.pos) > 1.05)
                                && clearFireLane({ ...a, pos: p }, target, agents) && clearSight([p[0], 1.4, p[2]], [target[0], 1.4, target[2]], boxes));
                            choices.sort((p, q) => distance(a.pos, p) - distance(a.pos, q));
                            goal = choices[0] ?? null;
                        }
                    }
                }
                else if (known) {
                    goal = known.at;
                    mode = 'pursue';
                    if (distance(a.pos, known.at) < .5) {
                        known.search += dt;
                        goal = null;
                        halt = true;
                        mode = 'search';
                        if (known.search > 2) {
                            memory.delete(a.id);
                        }
                    }
                }
                else if (distance(a.pos, a.home) > .6) {
                    goal = a.home;
                    mode = 'return';
                }
                let moveTarget = goal ? nextPoint(a, goal, dt) : null;
                if (goal && !moveTarget)
                    halt = true;
                orders.set(a.id, { mode, player: visible ? player : null, visible, fireAllowed, moveTarget, halt });
            }
            // Resolve traffic after all desired directions are known. Opposing
            // traffic gives the lower ID right of way; the other steps aside.
            const desired = new Map([...orders].map(([id, order]) => [id, order.moveTarget]));
            for (const a of agents) {
                const order = orders.get(a.id)!;
                if (!order.moveTarget)
                    continue;
                const target = order.moveTarget;
                const ahead = agents.find(b => b.id !== a.id && !b.disabled && distance(a.pos, b.pos) < .95
                    && distance(b.pos, target) < distance(a.pos, target) - .15);
                if (!ahead)
                    continue;
                const other = desired.get(ahead.id);
                const opposing = other &&
                    (target[0] - a.pos[0]) * (other[0] - ahead.pos[0]) +
                        (target[2] - a.pos[2]) * (other[2] - ahead.pos[2]) < 0;
                if (opposing && a.id < ahead.id)
                    continue;
                let aside: Vec3 | null = null;
                if (opposing) {
                    const dx = target[0] - a.pos[0], dz = target[2] - a.pos[2], len = Math.hypot(dx, dz);
                    aside = [.55, .4, .25].flatMap(width => [1, -1].map(sign => [a.pos[0] + sign * dz / len * width, 0, a.pos[2] - sign * dx / len * width] as Vec3))
                        .find(p => nav.canTravel(a.pos, p) && agents.every(b => b.id === a.id || b.disabled || distance(p, b.pos) > .65)) ?? null;
                }
                order.moveTarget = aside;
                order.halt = !aside;
                order.mode = 'yield';
                order.fireAllowed = false;
            }
            return orders;
        },
    };
}
