# Task 2 report

Status: completed.

Implemented injury-aware Soldier combat while keeping `kind: 'soldier'` immutable. Support-arm loss retains the shotgun, uses a 1.5x aim time, and applies deterministic yaw error to the actual projectile direction. Gun-arm loss makes the same Soldier melee-capable: it pursues through the encounter/ring path, throws a left-arm hook when that arm remains, and uses a body-driven shove with both arms gone. A range- and line-of-sight-gated contact pulse fires once as each swing crosses its contact phase. The actor exposes the accumulated contact count through `__sdfGame.brains`; no player-health system was added.

Encounter snapshots now distinguish stable Soldier identity from current ranged capability. Disarmed Soldiers cannot own or reposition for firing lanes and can immediately enter melee arbitration from current body state. Motion no longer collapses for arm loss, and the shotgun carry requires only the gun arm.

Concentrated batches of four or more pellet hits promote the pending Soldier reaction to the existing lurch class and synchronously cancel aim. Single pellets retain their brief flinch. During a strong reaction the gun remains bound to the right hand, that carry swings rearward/outward, support-hand IK releases, and the carry blends back into its requested pose while grounded footwork remains active. Zombie stagger and motion branches remain unchanged. Postmortem Soldier head geometry is again eligible for ordinary sever checks while living lesser head wounds retain Task 1 protection.

TDD evidence:
- New Soldier brain and encounter tests first failed for one-hand timing, disarmed attacks/contact, stable identity/dynamic melee capability, and firing-lane exclusion, then passed after implementation.
- The strong-batch actor regression caught the diagnostic timing distinction between synchronous mind state and the last completed actor frame; it now asserts the completed strong-reaction frame and recovery without stun lock.
- Motion tests verify arm loss stays standing, the remaining hand travels through a real strike arc, the strong reaction releases the support grip, and the gun grip remains attached to the right hand.

Validation:
- Focused brain, motion, attack, mind, encounter, actor, Soldier actor, and weapon suites: 221 tests across 8 files passed.
- `npx tsc --noEmit` passed.
- `git diff --check` passed.
- No GPU or browser work was run; parent owns visual QA.

Files intentionally outside this task remain untracked and were not included: `docs/superpowers/plans/2026-09-08-soldier-reactions.md` and `docs/superpowers/specs/2026-09-08-soldier-reactions-design.md`.

## Review follow-up

Resolved both P2 findings from the independent review. Actor contact dispatch now requires the completed motion frame to remain standing and nonfatal, preventing a swing crossing its contact phase on the same substep as lethal collapse from producing a callback or diagnostic count. The regression advances a disarmed Soldier to late windup, applies lethal torso damage, and verifies collapse without contact.

Strong-reaction support-hand recovery now begins after the initial release and progressively moves the constrained IK target from the released hand position to the gun fore-end, reaching the grip before the lurch expires. This removes the one-frame snap at the old `strongSoldierReaction` boundary while preserving arm lengths and keeping the gun attached to the right hand. The motion regression measures frame-to-frame hand continuity through lurch expiry and final fore-end proximity.

Follow-up validation: 223 tests across the same 8 focused files passed; `npx tsc --noEmit` and `git diff --check` passed. No GPU or browser work was run.
