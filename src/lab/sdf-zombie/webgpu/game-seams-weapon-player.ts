// src/lab/sdf-zombie/webgpu/game-seams-weapon-player.ts
//
// Members lifted verbatim out of game-main.ts's `window.__sdfGame` literal.
// Every one needed nothing but the GameContext, so this factory takes no deps.
//
// Plan: docs/superpowers/plans/2026-09-17-game-main-decomposition.md

import type { GameContext } from './game-context';
import * as THREE from 'three/webgpu';
import { type Vec3 } from '../types';
import { ROOMS, enclosureKeyAt } from './game-level';

export function createWeaponPlayerSeams(ctx: GameContext) {
  const { scene, camera } = ctx.boot.handle;
  return {
    /** Place the player at (x, z) with the given yaw/pitch and zero velocity
     *  (the distance-crowd bench's framing seam, 2026-09-14). Same fields
     *  `teleport()` writes; returns the enclosure key under the feet so a
     *  caller can assert the pose landed in the intended room. */
    placePlayer(p: { x: number; z: number; yaw: number; pitch?: number }) {
      ctx.player.player.pos = [p.x, 0, p.z];
      ctx.player.player.vel = [0, 0, 0];
      ctx.player.player.yaw = p.yaw;
      ctx.player.player.pitch = p.pitch ?? 0;
      ctx.player.player.grounded = true;
      return enclosureKeyAt(p.x, p.z);
    },
    /** Set the player pose. y defaults to 0 (feet on the floor). */
    setPose(x: number, z: number, yaw: number, pitch = 0, y = 0) {
      ctx.player.player.pos = [x, y, z];
      ctx.player.player.vel = [0, 0, 0];
      ctx.player.player.yaw = yaw;
      ctx.player.player.pitch = pitch;
      ctx.player.player.grounded = y === 0;
    },
    pose: () => ({ pos: [...ctx.player.player.pos] as Vec3, yaw: ctx.player.player.yaw, pitch: ctx.player.player.pitch }),
    /** Teleport to a room's centre, facing +z. */
    teleport(roomId: number) {
      const r = ROOMS.find(r => r.id === roomId);
      if (!r) return false;
      ctx.player.player.pos = [(r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2];
      ctx.player.player.vel = [0, 0, 0];
      ctx.player.player.yaw = 0;
      ctx.player.player.pitch = 0;
      return true;
    },
    /** The player's ground position — a capture rig needs it to stand beside a
     *  chosen body rather than detonate across the room. Read-only. */
    playerPos: () => [...ctx.player.player.pos] as Vec3,
    /** Enclosure key under the player's feet ('room1'..'room5', tunnel, 'void'). */
    room: () => enclosureKeyAt(ctx.player.player.pos[0], ctx.player.player.pos[2]),
    /** Walk the player toward (x, z) through the real collision path until
     *  within 0.25 m (or walkCancel). Pairs with step()/setLoopRunning. */
    walkTo: (x: number, z: number) => { ctx.player.autopilot = { x, z }; },
    walkCancel: () => { ctx.player.autopilot = null; },
    get walking() { return ctx.player.autopilot !== null; },
    get flashVisible() { return ctx.weapon.flashGroup?.visible ?? false; },
    /** Free-aim seam, for the gate and for A/B by hand. */
    get freeAim() { return ctx.player.freeAimOn; },
    get aimPoint() { return { x: ctx.weapon.aim.x, y: ctx.weapon.aim.y }; },
    setAimPoint(x: number, y: number) {
      ctx.weapon.aim = { x: Math.min(1, Math.max(-1, x)), y: Math.min(1, Math.max(-1, y)) };
      return { x: ctx.weapon.aim.x, y: ctx.weapon.aim.y };
    },
    get weaponLeanDeg() { return { yaw: ctx.weapon.yawDeg, pitch: ctx.weapon.pitchDeg }; },
    get bob() { return { distance: ctx.player.bobDistance, amount: ctx.player.bobAmount }; },
    /** Live finish knobs. The owner's look pass: the gun reads a touch too
     *  shiny under the dungeon rig and the hands are hard to see at this
     *  exposure. Both are judgement calls that depend on the final lighting,
     *  so they are knobs rather than new constants:
     *    __sdfGame.setGunTuning({ roughness: 0.30, envMapIntensity: 0.85 })
     *    __sdfGame.setGunTuning({ handNormalScale: 1.4 })
     */
    setGunTuning(t: {
      roughness?: number; envMapIntensity?: number; metalness?: number;
      handNormalScale?: number; handRoughness?: number;
    }) {
      for (const m of ctx.weapon.gunMaterials) {
        if (t.roughness !== undefined) m.roughness = t.roughness;
        if (t.envMapIntensity !== undefined) m.envMapIntensity = t.envMapIntensity;
        if (t.metalness !== undefined) m.metalness = t.metalness;
        m.needsUpdate = true;
      }
      if (ctx.weapon.handMaterial) {
        if (t.handNormalScale !== undefined) ctx.weapon.handMaterial.normalScale.setScalar(t.handNormalScale);
        if (t.handRoughness !== undefined) ctx.weapon.handMaterial.roughness = t.handRoughness;
        ctx.weapon.handMaterial.needsUpdate = true;
      }
      return {
        roughness: ctx.weapon.gunMaterials[0]?.roughness ?? null,
        envMapIntensity: ctx.weapon.gunMaterials[0]?.envMapIntensity ?? null,
        metalness: ctx.weapon.gunMaterials[0]?.metalness ?? null,
        handNormalScale: ctx.weapon.handMaterial?.normalScale.x ?? null,
      };
    },
    get shells() { return ctx.weapon.shells; },
    /** Unlimited ammo (the shipped default; ?ammo=finite turns it off). */
    get infiniteAmmo() { return ctx.weapon.infiniteAmmo; },
    get hingeOpenRad() { return ctx.weapon.hingePivot?.rotation.x ?? 0; },
    /** The two chamber mouths in WORLD space, right now. The eject origin is
     *  supposed to track these through the swing; nothing proved it did. */
    breechWorld: () => ctx.weapon.breechNodes.map((n) => {
      const v = new THREE.Vector3(); n.getWorldPosition(v);
      return [v.x, v.y, v.z] as Vec3;
    }),
    /** Where the last case was when it was handed to the tumble. */
    get lastEjectOrigin() { return ctx.weapon.lastEjectOrigin; },
    /** Live projectile debug (chunk-bake gate): kind, position, age. */
    pelletsDebug: () => ctx.weapon.pellets.map(p => ({ kind: p.kind, pos: [...p.pos] as [number, number, number], age: p.ageSec })),
    /** The arms, for the gate: both present, skin has no emissive, the watch
     *  screen exists. `watchScreen` is the drawable canvas for a later pass. */
    get arms() {
      return {
        left: !!ctx.weapon.arms?.left.parent, right: !!ctx.weapon.arms?.right.parent,
        skinEmissive: ctx.weapon.arms?.skin.emissiveIntensity ?? null,
        watch: !!ctx.weapon.arms?.left.getObjectByName('Watch_Screen'),
      };
    },
    get watchScreen() { return ctx.weapon.arms?.screen ?? null; },
    /** The eject arc's seed for the current/last reload; 0 = reference arc. */
    get reloadSeed() { return ctx.weapon.reloadSeed; },
    get reloadSpeed() { return ctx.weapon.reloadSpeed; },
    /** Hold one seed for every reload from now on (null releases it), so a
     *  gate can capture the same arc twice. */
    pinReloadSeed(seed: number | null) { ctx.weapon.pinnedReloadSeed = seed; },
    get gunReady() { return ctx.weapon.gunReady; },
    get cooldown() { return ctx.weapon.cooldown; },
    // SLUG MODE surface + HUD-truthful flag.
    get slugMode() { return ctx.weapon.slugMode; },
    /** A visible sphere in WORLD space, drawn through the normal geometry
     *  pass — so captures can mark predicted impacts vs actual craters.
     *  One marker at a time; pass null coords to remove. */
    placeMarker(x: number | null, y = 0, z = 0, colorHex = 0xff00ff) {
      if (!ctx.player.marker) {
        const geo = new THREE.SphereGeometry(0.03, 12, 8);
        ctx.player.marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex }));
        ctx.player.marker.frustumCulled = false;
        scene.add(ctx.player.marker);
      }
      (ctx.player.marker.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
      if (x === null) { ctx.player.marker.visible = false; return; }
      ctx.player.marker.visible = true;
      ctx.player.marker.position.set(x, y, z);
    },
    projectiles: () => ctx.weapon.pellets.map(p => ({
      pos: [...p.pos] as Vec3,
      vel: [...p.vel] as Vec3,
      ageSec: p.ageSec,
    })),
    /** HIDE THE VIEW MODEL (the held shotgun/arm rig parented to the camera).
     *  A capture that must see the BODY's silhouette has the player's own arm
     *  across the right half of the frame, which covers the very flesh the
     *  rupture review is about. The rig lives under the camera, NOT the scene,
     *  so `setRegisteredObjectsVisible` cannot reach it. Capture-only, and off
     *  by default. */
    setViewModelVisible: (on: boolean) => {
      ctx.weapon.viewModelAnchor.visible = !!on;
      return ctx.weapon.viewModelAnchor.visible;
    },
    /** Where a view-model hangs (child of the camera). */
    viewModelAnchor: ctx.weapon.viewModelAnchor
  };
}
