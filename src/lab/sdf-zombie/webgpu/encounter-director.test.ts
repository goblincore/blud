// @ts-expect-error — node:fs available in vitest via happy-dom/node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createEncounterDirector, clearFireLane, type EncounterAgent } from './encounter-director';
import { createEncounterNavigation } from './encounter-navigation';
import { ROOMS, TUNNELS, levelColliders } from './game-level';
import { parseSectorLevel } from './sector-json';
import { buildSectorGround } from './sector-ground';
import { createSectorNavigation } from './sector-navigation';
import { sectorSightBlocker } from './sector-ray';
import { makeSoldierBrain, stepSoldierBrain } from '../soldier-brain';
const nav = createEncounterNavigation(ROOMS, TUNNELS, levelColliders());
const a = (id: number, x: number, z: number): EncounterAgent => ({ id, pos: [x, 0, z], home: [x, 0, z], yaw: Math.PI, room: 1, soldier: true, ranged: true, disabled: false });
describe('mixed encounter coordination', () => {
    it('lets real soldier brains finish three-shot bursts before another soldier takes the lane', () => {
        const d = createEncounterDirector(nav, []), agents = [a(1, -2, 2), a(2, 2, 2)];
        const player = { x: 0, z: 0, room: 1 }, dt = 1 / 60;
        const brains = agents.map(() => makeSoldierBrain());
        const shots: { id: number; time: number }[] = [];
        for (let frame = 0; frame < 480; frame++) {
            const orders = d.update(agents, player, false, dt);
            agents.forEach((agent, i) => {
                const order = orders.get(agent.id)!;
                const out = stepSoldierBrain(brains[i]!, {
                    dt, self: { x: agent.pos[0], z: agent.pos[2], yaw: Math.atan2(-agent.pos[0], -agent.pos[2]), room: 1 },
                    player, alerted: true, lineOfSight: order.visible, mayFire: order.fireAllowed, roll: .1, rollDrift: .5,
                });
                brains[i] = out.brain;
                if (out.fire) { shots.push({ id: agent.id, time: frame * dt }); d.shot(agent.id); }
            });
        }
        expect(shots.length).toBeGreaterThanOrEqual(6);
        expect(shots.slice(0, 6).map(s => s.id)).toEqual([1, 1, 1, 2, 2, 2]);
        for (const i of [1, 2, 4, 5]) expect(shots[i]!.time - shots[i - 1]!.time).toBeLessThan(.5);
    });
    it('holds one firing lane through quick follow-ups, then rotates after the burst', () => {
        const d = createEncounterDirector(nav, []), agents = [a(1, -2, 2), a(2, 0, 2), a(3, 2, 2)], player = { x: 0, z: 0, room: 1 };
        let orders = d.update(agents, player, false, .1);
        expect([...orders.values()].filter(o => o.fireAllowed)).toHaveLength(1);
        expect(orders.get(1)!.fireAllowed).toBe(true);
        d.shot(1);
        orders = d.update(agents, player, false, .4);
        expect(orders.get(1)!.fireAllowed).toBe(true);
        d.shot(1);
        orders = d.update(agents, player, false, .4);
        expect(orders.get(1)!.fireAllowed).toBe(true);
        orders = d.update(agents, player, false, .5);
        expect(orders.get(2)!.fireAllowed).toBe(true);
        expect(orders.get(1)!.fireAllowed).toBe(false);
    });
    it('blocks soldiers from shooting through a zombie and excludes downed blockers', () => {
        const shooter = a(1, 0, 3), zombie = { ...a(2, 0, 1.5), soldier: false };
        expect(clearFireLane(shooter, [0, 0, 0], [shooter, zombie])).toBe(false);
        expect(clearFireLane(shooter, [0, 0, 0], [shooter, { ...zombie, disabled: true }])).toBe(true);
    });
    it('does not assign a firing lane to a disarmed soldier', () => {
        const d = createEncounterDirector(nav, []), soldier = { ...a(1, 0, 3), ranged: false };
        const order = d.update([soldier], { x: 0, z: 0, room: 1 }, false, .1).get(1)!;
        expect(order.fireAllowed).toBe(false);
        expect(order.moveTarget).toBeNull();
    });
    it('pursues only last observed coordinates then forgets, never the hidden live player', () => {
        const d = createEncounterDirector(nav, [{ min: [-3, 0, -.5], max: [3, 3, .5] }]);
        const agent = a(1, 0, 3);
        d.update([agent], { x: 0, z: 1, room: 1 }, false, .1);
        let order = d.update([agent], { x: 0, z: -3, room: 2 }, false, .1).get(1)!;
        expect(order.visible).toBe(false);
        expect(order.player).toBeNull();
        expect(order.fireAllowed).toBe(false);
        expect(d.debug().memories[0]!.at).toEqual([0, 0, 1]);
        for (let i = 0; i < 90; i++)
            order = d.update([agent], { x: 2, z: -3, room: 2 }, false, .1).get(1)!;
        expect(d.debug().memories).toHaveLength(0);
        expect(order.mode).toBe('idle');
    });
    it('hearing starts investigation without granting sight or firing', () => {
        const d = createEncounterDirector(nav, [{ min: [-3, 0, -.5], max: [3, 3, .5] }]);
        const agent = a(1, 0, 3), order = d.update([agent], { x: 0, z: -3, room: 2 }, true, .1).get(1)!;
        expect(order.mode).toBe('pursue');
        expect(order.player).toBeNull();
        expect(order.fireAllowed).toBe(false);
    });
    it('gives opposing doorway traffic a passing side instead of halting both', () => {
        const d = createEncounterDirector(nav, []);
        const agents = [{ ...a(1, 9.2, -4.8), home: [11.8, 0, -4.8] as [
                    number,
                    number,
                    number
                ] },
            { ...a(2, 10, -4.8), home: [7.8, 0, -4.8] as [
                    number,
                    number,
                    number
                ] }];
        const orders = d.update(agents, null, false, .1);
        expect(orders.get(1)!.halt).toBe(false);
        const yielding = orders.get(2)!;
        expect(yielding.mode).toBe('yield');
        expect(yielding.halt).toBe(false);
        expect(yielding.moveTarget![2]).not.toBe(-4.8);
        expect(nav.canTravel(agents[1]!.pos, yielding.moveTarget!)).toBe(true);
    });
    it('keeps right of way independent of actor array order in a narrow passage', () => {
        const agents = [{...a(2,.4,-4.8), home:[-2,0,-4.8] as [number,number,number]},
            {...a(1,-.4,-4.8), home:[2,0,-4.8] as [number,number,number]}];
        const orders = createEncounterDirector(nav,[]).update(agents,null,false,.1);
        expect(orders.get(1)!.halt).toBe(false);
        expect(orders.get(2)!.mode).toBe('yield');
        expect(orders.get(2)!.moveTarget).not.toBeNull();
        expect(nav.canTravel(agents[0]!.pos,orders.get(2)!.moveTarget!)).toBe(true);
    });

});

// Sector levels (plan 2026-10-24-sector-levels-3a Task 5) on the committed sectors fixture: A (floor 0,
// a column x -1..1, z -5..-3), B (z -8..-12, floor 0.5), C (z -12..-16, floor 1.5).
describe('sight on a sector level', () => {
    const L = parseSectorLevel(JSON.parse(readFileSync('public/assets/levels/fixtures/sectors.level.json', 'utf8')));
    const map = L.sectors!, ground = buildSectorGround(map);
    const sNav = createSectorNavigation(map, ground, L.rooms, []), blocked = sectorSightBlocker(map, ground);
    const at = (x: number, y: number, z: number): EncounterAgent => ({ ...a(1, x, z), pos: [x, y, z], home: [x, y, z], yaw: Math.PI });
    it('a wall between hides the player; the same line in the open sees', () => {
        // The column stands between z -1 and z -7 at x 0 — a box-only test would see straight through it.
        const hidden = createEncounterDirector(sNav, [], blocked).update([at(0, 0, -1)], { x: 0, z: -7, room: 1 }, false, .1, 0).get(1)!;
        expect(hidden.visible).toBe(false);
        expect(hidden.fireAllowed).toBe(false);
        expect(createEncounterDirector(sNav, []).update([at(0, 0, -1)], { x: 0, z: -7, room: 1 }, false, .1).get(1)!.visible).toBe(true);
        const open = createEncounterDirector(sNav, [], blocked).update([at(2.5, 0, -1)], { x: 2.5, z: -7, room: 1 }, false, .1, 0).get(1)!;
        expect(open.visible).toBe(true);
    });
    it('sight is floor-relative: a body on B sees the player on the C ledge over the riser', () => {
        // From B (floor 0.5) to C (floor 1.5): eye 1.9 -> 2.9 clears C's 1.5 m riser at z -12. At a
        // flat 1.4 m the line would run into the riser.
        expect(blocked([0, 1.4, -9], [0, 1.4, -14])).toBe(true);
        const d = createEncounterDirector(sNav, [], blocked);
        const order = d.update([at(0, 0.5, -9)], { x: 0, z: -14, room: 1 }, false, .1, 1.5).get(1)!;
        expect(order.visible).toBe(true);
        // The target keeps the player's real height.
        expect(d.debug().memories[0]!.at).toEqual([0, 1.5, -14]);
    });
});
