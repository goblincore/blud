import { it, expect } from 'vitest';
import { buildBody } from '../build-body';
import { compileBlob } from '../blob-compile';
import { parseBlob } from '../blob-parse';
import { translateBody } from '../translate';
import src from '../characters/soldier.blob?raw';
import { SOLDIER_PROFILE } from '../motion-profile';
import { createZombieActor } from './game-actor';
import { makeSoldierMind } from './enemy-mind';
import { createEncounterDirector } from './encounter-director';
import { createEncounterNavigation } from './encounter-navigation';
import { ROOMS, TUNNELS, levelColliders, wanderBounds } from './game-level';
it('a soldier actually leaves its spawn room through the passage to pursue observed/heard contact', () => {
    const boxes = levelColliders(), nav = createEncounterNavigation(ROOMS, TUNNELS, boxes), director = createEncounterDirector(nav, boxes);
    const start: [
        number,
        number,
        number
    ] = [7, 0, -4.8];
    const actor = createZombieActor({ id: 1, room: 2, seed: 42, start, body: translateBody(buildBody(compileBlob(parseBlob(src))), start),
        view: { setRootShift() { }, update() { }, setHeadRotation() { }, setTime() { } } as any,
        bounds: wanderBounds(ROOMS[1]!), furniture: [], navigation: nav, profile: SOLDIER_PROFILE, mind: makeSoldierMind() });
    let crossed = false;
    for (let i = 0; i < 1000; i++) {
        const before = actor.pose().pos;
        const order = director.update([{ id: 1, pos: before, yaw: actor.pose().yaw, room: actor.room, home: start, soldier: true, disabled: false }], { x: 14, z: -4.8, room: 5 }, i === 0, 1 / 60).get(1)!;
        actor.setEncounterOrder(order);
        actor.step(1 / 60);
        expect(nav.canTravel(before, actor.pose().pos)).toBe(true);
        if (actor.room === 5) {
            crossed = true;
            break;
        }
    }
    expect(crossed).toBe(true);
});
