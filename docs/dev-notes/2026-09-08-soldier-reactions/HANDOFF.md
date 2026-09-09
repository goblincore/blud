# Soldier reactions — resumed 2026-09-09

User accepted the improved Soldier reactions and authorized merging into main on 2026-09-09. Historical snapshots below are retained for context.

Final follow-up: any surviving hit triggers the accepted protective crouch for two seconds, refreshed by further hits, with smooth recovery. Persistent leg injury still owns the crippled shuffle. Motion/actor tests (141) and production build passed; user subsequently approved the merge.

## Resumed pass / renderer regression

- Latest correction supersedes the large rearward arm targets: chest hits should smoothly open the existing two-handed grip. A wider outward opening is allowed; continuity and a naturally aligned gun/wrist matter more than keeping amplitude tiny. Every new hit must start from the current transition pose, including mid-reaction/recovery. Avoid a preset-pose snap or revolver-draw silhouette. Keep asymmetric, varied arm timing and paths. Remove the earlier fixed carry override and immediate support-hand release as well as the rearward targets.
- Dead bone skeleton sources corrected in `a0fa2c2a`; current stagger/material work remains uncommitted.
- Added small/medium/heavy reactions, asymmetric arm paths, forearm-aligned gun, heavy torso hunch variant and severity-matched recovery holds. Collision corrections translate the frame, held gun and fall anchor together.
- New material shader code initially reassigned immutable WGSL `detailNoise` and `wet` bindings. Both compile errors are corrected. Fresh WebGPU browser reload shows complete Soldier and zombie bodies without shader compilation errors.
- Validation: 178 focused motion/brain/actor tests, 234 shader/material tests, 29 actor/collision tests, typecheck and Node 22 production build pass. These sets overlap; do not sum them as unique tests.
- Real-time capture `medium-realtime.png` shows flesh following the asymmetric rearward arm pose. Synchronous batched `step()` captures sometimes show exposed bones that disappear on subsequent real-time frames; exact GPU synchronization cause remains unproven. Use real-time capture for visual conclusions.
- Heavy hunch, all reaction variants and close-up wound contrast still need representative visual acceptance. No performance claim. No merge/push.

### Current-pose opening follow-up

- Removed the forced carry pose, abrupt support-hand release and large rearward arm targets. The opening now starts from the current carry, preserves gun pitch, varies outward amount/support timing and blends back to the requested carry.
- Equal-strength hits continue the current reaction rather than resetting the lurch/hunch and localized recoil. Stronger hits can escalate. Mixed same-frame impacts preserve the strongest reaction and its source.
- Rendered gun grip now follows the actual constrained rig hand, rather than the unsolved animation target. Authored rotation is preserved, and firing uses the corrected muzzle. A regression reproduced 40.3 cm of separation before this fix.
- Removed a late-recovery clamp that could release abruptly when changing from aim to low carry.
- Final combined validation: **452/452 tests across 10 files**, Node 22 production build, typecheck and diff check passed. Console shows no WGSL compilation errors. Live actual torso-hit screenshots `opening-final.png` / `opening-mid.png` retain complete flesh and a seated forward-facing gun. All variants and subjective movement quality remain for user playtesting; this is not visual acceptance.

### Persistent lower-body injury follow-up

- User explicitly accepted the bent/crouched reaction during live playtesting on 2026-09-09 ("so much better ... really good"). Preserve this posture tuning while revising arm reactions.
- Surviving authored pelvis/thigh wounds now feed persistent `mobilityInjury` from the injury ledger. Pose smoothly lowers the pelvis, bends knees and leans forward; locomotion becomes a slower, shorter, uneven shuffle through existing grounded footwork.
- Four leg injury points now remain mobile; six disable, eight retain the existing sever threshold. The automatic single-blast joint shortcut remains for arms, but no longer bypasses the surviving-leg injury state. Actual geometric sever/support loss and fatal rules still take precedence.
- Combined focused suite: **221/221 across nine files**. Independent review found no blocker. Actual pelvis slug in WebGPU left all limbs alive and the bent posture persisted after recovery. Side view and moving shuffle captures are saved here as `mobility-side.png` and `mobility-shuffle.png`.
- Moving QA covered roaming at roughly 0.44 m/s, not a controlled pursuit test. User visual acceptance remains separate from this smoke check. Task-owned QA Chrome was closed; Vite 5274 remains available for user playtesting.

### Arm durability and progressive interruption — 2026-09-09

- Living Soldier arms now require a local injury budget for geometric cuts. Focused arm damage severs at eight points, scattered damage at sixteen; targeted joint double-volley cuts require both barrels of the same shot. Living arm slug craters are bounded to arm girth so structural protection does not leave a fully stripped working skeleton. Corpse cuts retain the prior behavior.
- Three distinct firearm shots within 1.5 seconds trigger a full 1.35-second aim interruption. Pellets share a volley ID; slugs now use the same ID allocator and carry provenance through the live projectile dispatch. Deduplication lasts three seconds across frame batches and completed chains.
- Latest user clarification: preserve all existing arm-opening variants and accepted crouch. The separate full opening rotates the whole upper arm and bent elbow BACK and OUT, carrying the gun outward and slightly UP. It must blend from the current pose, including mid-reaction; no overhead salute or wrist twist. Full motion refinement is implemented; live smoke confirms the larger opening, with subjective animation acceptance left to user playtesting.
- Final focused validation: 254 tests across eight motion/helper/brain/footwork/injury/actor/weapon files passed; Node 22 production build and diff check passed. Live WebGPU fixture stamped three distinct torso shots while aiming, entered stagger, displayed the bent/outward gun arm with a raised muzzle, then returned to engage. This uses actual actor hits with explicit shot IDs, not physical projectile flight. Console had no shader errors; existing zero-index draw warning remains.
- Full rotation now aims toward an absolute outward target rather than adding a fixed large yaw to every starting pose. Tests constrain the elbow below/outside the shoulder and verify low-carry onset, heavy escalation continuity, gun alignment and recovery. Preserved smaller variants and accepted crouch. Capture: `full-final-front.png`. Task-owned QA browser closed; Vite 5274 remains available.

## Latest user corrections — next iteration

- Screenshots show flesh stripped from an arm while its skeleton can still operate. Shooting an arm off must break/remove the bones too; a functional bare skeletal arm is not the intended result. Distinguish merely exposing some bone from destroying the limb. Trace rendered cosmetic carving against structural sever/prop eligibility before changing thresholds.
- Wounds read too brown/purple. Desired look is deep, viscous, gooey, shiny RED blood.
- Consider blood splatter decals on kit meshes and/or the SDF surface.
- Soldier surfaces are too smooth. Investigate subtle pitted normal/bump detail, preserving silhouette and measuring any meaningful render cost.
- Keep prior accepted combat intent: support-arm loss permits one-handed fire; gun-arm loss drops weapon and uses remaining arm; both arms gone uses body shove; arm loss alone does not collapse him. Healthy ordinary-firearm instant kill reserved for concentrated two-barrel head hit.

## Where the work is

- Worktree: `/Users/donny/Projects/blud/.worktrees/soldier-reactions`
- Branch: `codex/soldier-reactions`
- Base: `7a5b65e3`; current code HEAD: `a17cef59`
- No merge or push. Primary checkout has unrelated user changes; preserve them.
- Source is committed. Plan/spec and QA notes/captures are currently untracked and deliberately preserved.
- Plan/spec: `docs/superpowers/plans/2026-09-08-soldier-reactions.md`, `docs/superpowers/specs/2026-09-08-soldier-reactions-design.md`
- Detailed per-task reports and review history: `.superpowers/sdd/2026-09-08-soldier-reactions/`

## Implemented, subject to visual revision

Regional Soldier injury ledger; explicit actual shotgun barrel/shot provenance; arm-loss survival; dynamic ranged/melee capability; one-handed aim penalty; left hook/body shove contact events; grounded strong-hit lurch and staged regrip with separate smoothed carry target; authored skull/ribs; Soldier mesh skull/steel shading; render-only tangent wound lobes; Soldier wound/decal staining; posed armor hit/shedding events; bounded billboard spark pool. Stable event IDs survive wound aging and deduplication is bounded. Distal missing-limb injury history is bounded.

Important: render-only lobes intentionally do not add injury damage. This separation is a likely place to investigate the user's exposed-but-functional skeleton complaint. Do not blindly turn all visual tears into gameplay damage.

No player-health system exists in the current game; disarmed attacks emit once-per-swing range/LOS/fatal-gated contacts and diagnostic counts, matching the existing boundary rather than adding health.

## Verification already performed

- Final source build passed (`npm run build` using Node 22.22.1).
- Full suite on final source using Node 22: **4,203 passed, 1 failed**, 265 files. The failure is pre-existing `surface-nets.wgsl.test.ts`: HULL_FIELD calls mapBody with 17 arguments while declaration has 19. Same mismatch verified at base `7a5b65e3`; unrelated experimental hull code was not changed.
- An initial Node 25 run also failed panel localStorage tests. Worktree shell selects Node 25, primary selects Node 22. Explicit Node 22 fixes those panel failures.
- Whole-branch independent code review approved through `a17cef59`; this is not visual acceptance.
- Actual WebGPU/default mesh skeleton browser checks demonstrated surviving ordinary head slug; actual two-barrel head shot fatality; one-handed firing with support arm gone; earlier left-hook/body-shove contact checks; armor sparks/shedding; exposed ribs; final staged recovery barrel remaining outboard and return to aim.
- Latest final-code body-shove staging in a crowded teleported scene remained in pursuit with no token while a distant Zombie held a token. No new bug established: ring incumbency/teleport staging may explain it. Earlier controlled Task2 checks produced contacts. Do not claim this last attempt passed.
- Close-up wound colors and residual bright rims still need work; latest user explicitly rejects current brown/purple/smooth appearance.

## QA resources

- Preview Vite port 5274, PID14256 (owned by this task), URL `http://localhost:5274/sdf-game.html`; left running for handoff.
- Dedicated headless Chrome port9274 was used for QA; shut down when pausing.
- `/tmp/soldier-reactions-qa/` contains CDP helper, setup/torso-hit scripts, all raw captures, build.log, final-tests.log. Helpers are QA fixtures, not production code. `cdp.mjs eval` returns CDP exceptions without a nonzero shell exit; inspect results.
- Raw latest captures include final-skull-close.png, final-one-handed.png, final-flinch-hit.png, final-flinch-regrip.png, final-torso-recovered.png. Some diagnostic images intentionally hide the flesh or face decal; do not present those as normal gameplay.
- Do not infer GPU performance from HUD counters; these were controlled visual/logic checks, not benchmarks.
