# Soldier Reactions Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task-by-task, with review.

**Goal:** Make Soldier injuries readable, durable, bloody, and tactically meaningful.
**Architecture:** Extend existing regional injury, EnemyMind, motion and kit/wound presentation seams. Keep Soldier-specific policy separate from Zombie defaults.
**Tech Stack:** TypeScript, Three.js WebGPU, Vitest, authored Blob geometry.
**Spec:** docs/superpowers/specs/2026-09-08-soldier-reactions-design.md

## Global Constraints
- Active SDF FPS only; preserve Zombie behavior and renderer defaults.
- Preserve unrelated edits and never commit dev placeholder assets.
- Work in isolated codex/soldier-reactions; no merge or push.
- No concurrent GPU jobs. Report actual visual and test evidence separately.

### Task 1: Regional injury and firearm provenance
**Files:** soldier-damage.ts/test.ts, damage.ts, webgpu/game-actor.ts and projectile dispatch files under src/lab/sdf-zombie/ as required by trace.
**Interfaces:** Preserve soldierInjury return fields; extend wound metadata only where necessary to identify real two-barrel fire. Downed depends on legs, never arms. Support-arm loss does not release prop; gun-arm loss does.
- [x] Add and run failing authored-anatomy tests proving head pellet survival, arm-loss survival, cumulative head/torso lethality and the two-barrel exception.
- [x] Trace actual shotgun trigger through hit batching; carry explicit shot provenance instead of inferring weapon identity from wound radius/type. Use a direct head-hit criterion that excludes stray pellets and verify it in integration tests.
- [x] Prevent geometric head sever checks bypassing the survival policy for lesser head hits, while preserving visible wound carving.
- [x] Implement injury rules and prop release. Tests must cover full and distal arm severing.
- [x] Run focused damage/actor/projectile suites, review diff and commit scoped files.

### Task 2: Injured combat and motion
**Files:** soldier-brain.ts/test.ts, webgpu/enemy-mind.ts/test.ts, webgpu/game-actor.ts, motion.ts and focused motion tests; encounter/melee dispatch only as needed.
**Interfaces:** Pass missing arms into Soldier mind. Retain ranged firing with support-arm loss; gun-arm loss transitions to melee with a once-per-swing contact event and range/LOS gates. Existing attack interface supplies pose phase.
- [x] Keep character identity independent from melee capability: game-main currently uses !mind.meleeCapable to classify Soldier in encounter snapshots/debug. If capability becomes dynamic, correct those identity checks. Encounter orders must not force a disarmed Soldier back into a firing lane.
- [x] Write and run failing tests for support-arm firing, disarmed pursuit/attack, no phantom gunfire, stagger cancellation and recovery.
- [x] Implement slower single-arm shots and less accurate aim. Implement remaining-arm strike / both-arms-missing body shove, with visible windup, contact and recovery; emit a contact event once per swing; the current game has no player health, so do not introduce a new health subsystem.
- [x] Remove arm loss from motion.ts forced-collapse expression and change canHold/signals.fire gates to require only gun arm. Actor character-view pose must retain prop when support arm is missing.
- [x] Strong hits break carry/aim, throw arms back and recompose smoothly; retain grounded legs and Zombie poses.
- [x] Run brain, mind, actor and motion regression tests, inspect diff and commit.

### Task 3: Wounds, skull and armor sparks
**Files:** characters/soldier.blob; webgpu/kit-damage.ts/test.ts; existing Soldier surface/skeleton presentation modules located by code trace.
**Interfaces:** Reuse existing wound/bone rendering, add Soldier-only material/anatomy settings. Armor debris owns sparks lifetime and cleanup.
- [ ] Read .superpowers/sdd/2026-09-08-soldier-reactions/visual-trace.md. Mesh skeleton already applies to Soldier; improve sparse auto-derived bone anatomy and mesh-skull.ts Zombie-only sculpt via Soldier-specific adapter/authored bones without changing Zombie. Fix kit-damage world/bind coordinate mismatch and test translated/yawed/articulated hit positions before sparks.
- [ ] Use Soldier-only material/visual wound controls; no extra gameplay damage from visual tear lobes and no global shader-default changes. Respect explicit wound-panel overrides.
- [ ] Author contained Soldier cranium/jaw in soldier.blob: auto-derived skull is only34mm sphere against88mm face half-width. Use measured proposal in visual-trace.md; add containment and extraction tests. Add angular Soldier mesh-only sockets/jaw sculpt and restrained localized steel shading. Consider contained chest rib/sternum anatomy for torso exposure; preserve intact silhouette and existing Zombie geometry.
- [ ] Correct hitMeshSkull diagnostic to ray-resolve posed flesh surface rather than stamping at undersized bone bounds. Keep real gameplay wound depths unchanged unless visual evidence warrants Soldier-only tuning.
- [ ] Add bloody irregular wound presentation and angular skull with restrained metal reinforcement beneath face; preserve intact silhouette.
- [ ] Add short sparks on armor hits/shedding with reset/dispose and bounded resource usage; test event/lifecycle behavior.
- [ ] Run authored character/kit tests, typecheck/build, inspect Soldier in WebGPU with controlled head/body/arm shots and capture evidence.
- [ ] Review whole change; leave preview ready for user testing and report remaining visual limitations honestly.
