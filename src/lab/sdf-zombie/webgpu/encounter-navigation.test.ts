import { describe, it, expect } from 'vitest';
import { ROOMS, TUNNELS, levelColliders } from './game-level';
import { createEncounterNavigation } from './encounter-navigation';
const nav = createEncounterNavigation(ROOMS, TUNNELS, levelColliders());
describe('encounter navigation', () => {
    it('routes across rooms through actual openings, including the fifth room', () => {
        const from: [
            number,
            number,
            number
        ] = [-4.8, 0, -4.8], to: [
            number,
            number,
            number
        ] = [16.5, 0, -4.8];
        const route = nav.route(from, to);
        expect(route.length).toBeGreaterThan(0);
        let last = from;
        for (const p of route) {
            expect(nav.canTravel(last, p)).toBe(true);
            last = [...p];
        }
        expect(route.at(-1)).toEqual(to);
    });
    it('never shortcuts the central wall or furniture', () => {
        expect(nav.canTravel([-1.5, 0, -1.5], [1.5, 0, 1.5])).toBe(false);
        expect(nav.canStand([-6.2, 0, -2.8])).toBe(false);
        const from: [
            number,
            number,
            number
        ] = [-7.5, 0, -2.8], goal: [
            number,
            number,
            number
        ] = [-4.5, 0, -2.8];
        const path = nav.route(from, goal);
        expect(path.length).toBeGreaterThan(1);
        expect(nav.follow(from, path)).not.toEqual(goal);
    });
    it('reports current room across a tunnel instead of a permanent spawn room', () => {
        expect(nav.roomAt([9, 0, -4.8])).toBe(2);
        expect(nav.roomAt([10.2, 0, -4.8])).toBe(5);
        expect(nav.canStand([30, 0, 30])).toBe(false);
    });
});
