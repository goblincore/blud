import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../gibs/particles';
import type { GibSystem } from '../gibs';

export interface Player {
  pos: Vec3;
  forward: Vec3;
  handPos: Vec3;
  takeDamage(amount: number, impulse: Vec3): void;
}

export interface FrameCtx {
  world: RAPIER.World;
  player: Player;
  gibs: GibSystem;
  now: number;          // seconds since game start (monotonic)
}

export interface ViewCtx { /* M2: extended later for first-person rendering */ }
export interface HudCtx  { /* M2: extended later for HUD overlay */ }

export interface Weapon {
  readonly id: string;
  readonly ammoMax: number;
  ammo: number;

  onPress(ctx: FrameCtx): void;
  onRelease(ctx: FrameCtx): void;
  onFrame(ctx: FrameCtx, dt: number): void;

  /** 0..1 — HUD ring fill. */
  chargeFraction(): number;

  renderView(ctx: ViewCtx): void;
  renderHud(ctx: HudCtx): void;
}
