import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { InputState } from '../engine/input';
import { movementDirection } from './player-motion';

export interface Player {
  update(dtSec: number, input: InputState): void;
  position(): THREE.Vector3;
}

export interface PlayerOptions {
  world: RAPIER.World;
  camera: THREE.PerspectiveCamera;
  spawn: THREE.Vector3Like;
}

const WALK_SPEED = 6;
const RUN_SPEED = 9;
const JUMP_VELOCITY = 8.5;
const MOUSE_SENSITIVITY = 0.0022;
const EYE_HEIGHT = 1.55;
const BODY_RADIUS = 0.3;
const BODY_HALF_HEIGHT = 0.7; // total capsule height = 2*(radius + halfHeight) = 2

export function createPlayer(opts: PlayerOptions): Player {
  const { world, camera, spawn } = opts;

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(spawn.x, spawn.y, spawn.z);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(BODY_HALF_HEIGHT, BODY_RADIUS);
  world.createCollider(colliderDesc, body);

  const controller = world.createCharacterController(0.02);
  controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  controller.setApplyImpulsesToDynamicBodies(true);
  controller.enableAutostep(0.3, 0.2, true);
  controller.enableSnapToGround(0.3);

  let yaw = 0;
  let pitch = 0;
  let verticalVel = 0;
  const GRAVITY = 25;
  const PITCH_LIMIT = Math.PI / 2 - 0.05;

  function update(dtSec: number, input: InputState) {
    const { dx, dy } = input.consumeMouseDelta();
    yaw -= dx * MOUSE_SENSITIVITY;
    pitch -= dy * MOUSE_SENSITIVITY;
    if (pitch > PITCH_LIMIT) pitch = PITCH_LIMIT;
    if (pitch < -PITCH_LIMIT) pitch = -PITCH_LIMIT;

    const movement = {
      forward: input.isDown('KeyW'),
      back: input.isDown('KeyS'),
      left: input.isDown('KeyA'),
      right: input.isDown('KeyD'),
    };
    const dir = movementDirection(movement, yaw);
    const sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = sprinting ? RUN_SPEED : WALK_SPEED;

    const grounded = controller.computedGrounded();
    if (grounded && verticalVel < 0) verticalVel = 0;
    if (grounded && input.justPressed('Space')) verticalVel = JUMP_VELOCITY;
    verticalVel -= GRAVITY * dtSec;

    const desired = {
      x: dir.x * speed * dtSec,
      y: verticalVel * dtSec,
      z: dir.z * speed * dtSec,
    };

    const collider = body.collider(0);
    controller.computeColliderMovement(collider, desired);
    const applied = controller.computedMovement();
    const pos = body.translation();
    body.setNextKinematicTranslation({
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    });

    const newPos = {
      x: pos.x + applied.x,
      y: pos.y + applied.y,
      z: pos.z + applied.z,
    };
    // EYE_HEIGHT is measured from the FEET. The capsule center sits half its
    // total extent (BODY_HALF_HEIGHT + BODY_RADIUS = 1.0 m) above the feet, so
    // anchor the eye to the feet — adding EYE_HEIGHT to the body CENTER would
    // double-count that 1 m and float the eye ~2.55 m up, making the player
    // tower over human-scale enemies (~1.95 m sprites).
    const feetY = newPos.y - (BODY_HALF_HEIGHT + BODY_RADIUS);
    camera.position.set(newPos.x, feetY + EYE_HEIGHT, newPos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
  }

  function position() {
    const p = body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  return { update, position };
}
