---
title: M5-D — NotBlood fidelity pass: flare burn-death, dynamite physics, gib taxonomy
date: 2026-04-26
status: queued for dispatch
parent: docs/superpowers/specs/2026-04-25-blud-flare-burn-fidelity.md
---

# Goal

Three behavioral gaps surfaced from playtest after M5-A/B/C landed. They
share NotBlood-source investigation territory (the gib/death outcome
branching is the same code path for both flare-DoT death and dynamite
explosion death), so this is **one bundled dispatch** rather than three.

1. **Flare burn-death lacks a transition.** Burned-out enemies currently
   just disappear. NotBlood plays a collapse → gib spawn → small ground
   flame at the death spot. The stuck-flare projectile is also not
   visually present on the enemy during the 0.6s pre-ignition delay (the
   billboard's there in code but the player can't see it stuck in the
   body).
2. **Cultists burn forever.** The `CultistState.Burning` brain runs the
   sprint-at-player AI but the DoT never actually kills them — there is
   no death cap. NotBlood gives burning cultists a defined death state
   (research Phase 1 confirms which `seqKill` variant + DoT cap).
3. **Dynamite under-delivers.** Throw velocity feels much weaker than
   NotBlood's default-bundle, and detonation behavior is wrong: in
   NotBlood the *default* hand-thrown bundle appears to detonate on
   impact, not after a fuse. (User confirmed via side-by-side playtest.)
   Explosion impulse + radius falloff also feels weaker than canonical.
4. **Gib outcomes too binary.** Today an enemy hit by an explosion
   either gibs (chunks-only) or plays the death-anim. NotBlood has more
   outcomes: head-decap-with-body-launched, body-knocked-back, and
   gibbed-with-secondary-cascade. We want at least one new
   "launched-corpse" outcome for dynamite kills above a threshold.

This is one dispatch because the death-outcome branching in
`actor.cpp::actDamageSprite` / `actKillDude` is the same code path that
governs flare-DoT death AND dynamite-explosion death — researching it
once feeds both fixes.

# NotBlood source-of-truth (Phase 1 reads these directly)

The dispatch's **first phase is investigation** — read these files and
write a findings doc before touching any code.

| File | What's in it |
| ---- | ------------ |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/aiburn.cpp` | `cultistBurnChase/Goto/Attack`, `zombieABurn*` AISTATEs — confirms cultist burn-death cap and zombie walk-toward-player behavior |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` | `actDamageSprite`, `actKillDude`, `actExplodeSprite`, `actKickObject` — the gib outcome branching, explosion impulse math, and corpse-launch. Lines vary; grep for the function names. |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/actor.cpp` (kThing handlers) | `kThingTNTBundle`, `kThingProxBomb`, `kThingRemote` thing-type handlers — confirms whether default bundle is fuse-cooked or impact-detonate. Also where throw velocity is applied (probably `actFireThing` or similar). |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/ai.cpp` | `aiNewState`, `aiSetGenIdleState`, base AI transitions — to understand how burn-death transitions back from Burning AISTATE |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/weapon.cpp` | Player weapon fire functions — where the throw velocity for thrown TNT bundle is set (look for `actFireThing` or kThingTNTBundle spawn site) |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/callback.cpp` | `Remove`, gib spawn callbacks, ground-flame fx — what spawns the small persistent flame when a burning enemy dies |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/fx.cpp` | `fxSpawnPodStuff`, gib spawn helpers — for the burn-death gib particle set |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/gameutil.cpp` | Explosion radius/falloff math if not in actor.cpp |
| `/Users/donny/Documents/Raze/NotBlood/source/blood/src/dude.cpp` | `dudeInfo[]` — confirm `kDudeBurningCultist`'s `startHealth` (this is the DoT cap for cultist) |

# Phase 1 — investigation findings doc (commit before any code)

The dispatch writes
`docs/dev-notes/2026-04-26-notblood-fidelity-research.md` covering:

**Burn-death outcome.**
- For zombie (`kDudeZombieAxe` → `kDudeBurningZombieAxe`): exact AISTATE
  graph after ignition. Confirm "walks slowly toward player" behavior
  and cite the AISTATE/movement-speed values.
- For cultist (`kDudeCultistShotgun` → `kDudeBurningCultist`): exact
  death cap (startHealth value + DoT damage rate → expected time-to-die)
  and the death seqKill / fx callback chain.
- The collapse → gib → ground-flame death sequence: which callback
  spawns gibs, which fx spawns the lingering ground flame, what its
  duration is.

**Dynamite default behavior.**
- Identify which `kThing*` is spawned by the player's hand-thrown
  default dynamite bundle in NotBlood. Look at the player weapon-fire
  code (probably `WeaponProcess` / `FireWeapon` for the dynamite slot)
  and trace what `actFireThing` is called with.
- Document throw velocity (initial XY/Z components) and any cook
  mechanic (fuse / proximity / impact).
- Document the explosion: `actExplodeSprite` parameters for the
  matching kExplosion type, radius-falloff curve, impulse magnitude.

**Gib-outcome taxonomy.**
- `actDamageSprite` / `actKillDude` branching: list every distinct
  death outcome (gibbed-fully, head-decap, body-launched, normal
  death-anim, etc) and the condition that selects each one (damage
  type, magnitude, sprite type).
- For explosion damage specifically: what triggers the head-detach +
  body-launch outcome vs full-gib vs normal death? Confirm whether
  this is a single-roll branch or threshold-based.

**Recommendation.**
- If the planned approach (impact-detonate default bundle, body-launch
  outcome via single dynamic-body corpse, walk-toward-player burning
  zombie, capped cultist DoT death) matches NotBlood, proceed.
- **If research shows a meaningfully different mechanic, the dispatch
  is empowered to recommend an alternative in this doc and adjust
  Phases 2-N accordingly** — but the recommendation must cite source
  lines and the impl change must be summarized in the doc before code
  is touched.

The Phase 1 doc is committed before any further phases run. This is the
review artifact for the user.

# Architecture — three independent fixes

## Fix 1 — Flare burn-death visual transition (Phases 2-3)

Files: `src/game/weapons/stuck-flare.ts`, `src/game/enemy/axe-zombie.ts`,
`src/game/enemy/cultist-ai.ts`, `src/game/enemy/shotgun-cultist.ts`,
`src/game/gibs/index.ts`, `src/game/gibs/particles.ts` (likely a new
`ground-flame.ts` particle effect).

**Stuck-flare visibility on enemy.** The stuck-flare billboard exists
in code but isn't visible on the enemy during the 0.6s pre-ignition.
Either the billboard is being parented to the wrong space (world vs
enemy-local) or it's being culled / occluded. Phase 2 reads
`stuck-flare.ts` rendering, finds why it's not showing, fixes it. The
flare should be a small bright billboard sticking out of the enemy
sprite during the 0.6s smoke-only delay — visually obvious that "this
enemy is about to ignite."

**Burn-death sequence (matches Phase 1 findings).** When DoT brings the
enemy to 0 HP while in the Burning state:
1. **Collapse** — play the existing `*-death-burn` SEQ.
2. **Gib spawn** — at the moment the death-burn animation completes (or
   at a specific frame; Phase 1 confirms NotBlood's timing), spawn the
   burn-death gib set. Use the existing `spawnExplosionGibs` /
   `gibs/index.ts` infrastructure but with a smaller chunk count and
   the burn-tinted (charred) particle palette. Phase 1 specifies the
   exact gib set NotBlood uses for burn-death.
3. **Ground flame** — spawn a small persistent flame particle effect at
   the death position. Lives ~3-5 seconds (Phase 1 confirms duration),
   fades out. Uses existing flare particle visuals if they're a close
   match, or a new `ground-flame.ts` particle if needed.

**Cultist burn-death cap.** Currently `CultistBrain.Burning` runs DoT
forever because no death state is wired. Add the cultist burn-death
transition: DoT ticks reduce HP; at HP ≤ 0 transition to a `Dying`
substate that plays `cultist-burn-death` SEQ then triggers the same
collapse → gib → ground-flame sequence. Phase 1 confirms the right
seqKill variant and the expected time-to-die from NotBlood's
`kDudeBurningCultist` startHealth + DoT rate.

**Zombie burn-walk behavior (currently wrong).** Today's zombie Burning
state runs panic-thrash (random target). NotBlood's `zombieABurn*`
walks toward the player at reduced speed. Replace the random-thrash
target selection with "walk toward last-known-player at burnSpeedMps"
(Phase 1 supplies the actual value; expect ~0.6× normal). Cultist
keeps current sprint-at-player (Phase 1 verifies this matches
`cultistBurnGoto`).

## Fix 2 — Dynamite throw + impact detonate (Phases 4-5)

Files: `src/game/weapons/dynamite.ts`, `src/game/gibs/tuning.ts`.

**Throw velocity port.** Phase 1 documents NotBlood's actual XY/Z
velocity for the thrown default bundle. Update `DYNAMITE_COOK.minVelocityMps`
and `DYNAMITE_COOK.maxVelocityMps` (and `pitchLobDeg` if the launch
angle differs) to match. If NotBlood's mechanic is impact-detonate
(no cook), the cook charging mechanic is removed for the default
bundle: a single press throws at one velocity (the NotBlood value).

**Impact detonation.** Default bundle (most likely outcome based on
playtest) detonates on first contact with geometry or an enemy.
Replace the fuse-countdown explosion-trigger in `dynamite.ts` (around
the projectile update loop where `fuseLeft` ticks) with: detonate
when projectile collides with a static body or any enemy collider.
Bouncing-without-detonate path is removed for default bundle.

**If Phase 1 shows it's actually fuse-cooked**, leave the cook
mechanic but tune throw velocity + bounce coefficient + reduce
fuse to match NotBlood's value.

**Stronger explosion.** Update `EXPLOSION_STANDARD` in `tuning.ts`:
port radius, peak damage, and impulse magnitude from Phase 1 findings.
The current values may be ~30-50% under canonical.

## Fix 3 — Gib taxonomy + body-launch outcome (Phases 6-7)

Files: `src/game/enemy/axe-zombie.ts`, `src/game/enemy/shotgun-cultist.ts`,
`src/game/gibs/index.ts`, `src/game/gibs/tuning.ts` (likely a new
`launched-corpse.ts` for the dynamic-body corpse).

**Gib outcome selector.** Right now the kill-by-explosion path does a
binary check (gibbed vs death-anim) based on damage magnitude.
Replace with a multi-outcome selector that mirrors Phase 1's findings.
Minimum new outcomes:

- **Launched-corpse** (the user-requested feel): when explosion damage
  exceeds the gib threshold AND the impulse vector magnitude is above
  a second threshold, the enemy spawns:
  - A head gib (existing chunk pipeline) at the head position with
    the explosion impulse + a small upward bias.
  - A single dynamic-body corpse (new) using the existing Rapier
    dynamic-body infrastructure that the gib chunks already use.
    The corpse is a single billboard sprite (use the death-burn or
    death-explode sprite, whichever is the "wholeness preserved"
    form) attached to a dynamic body sized roughly to the enemy.
    Receives the explosion impulse, tumbles + bounces against arena
    walls, settles as a static corpse decal after low-velocity-for-N-frames.
- **Existing outcomes preserved** — full gib (when impulse exceeds the
  gib threshold but launched-corpse threshold not met), normal
  death-anim (no explosion or below gib threshold).

Phase 1 may recommend a different outcome taxonomy. If so, the
dispatch follows Phase 1's recommendation and documents the
divergence in the findings doc.

**Tuning.** Add `LAUNCHED_CORPSE` constants to `tuning.ts`:
`impulseThreshold`, `linearDamping`, `angularDamping`, `restingVelocity`,
`settleDurationSec`, `bounceMaterial`. Wire to a small Rapier dynamic
body. Reuse decal-spawn-on-rest infrastructure from existing
chunk-settling code if present; otherwise add minimal settle hook.

# Phase outline

| Phase | Description | Files |
| ----- | ----------- | ----- |
| 1 | Investigation — write `docs/dev-notes/2026-04-26-notblood-fidelity-research.md` and **commit it** | dev-notes only |
| 2 | Stuck-flare visibility fix + burn-death visual sequence wiring | `src/game/weapons/stuck-flare.ts`, gib + particle system |
| 3 | Cultist burn-death cap + zombie burn-walk-toward-player; tests | `src/game/enemy/*.ts` |
| 4 | Dynamite throw velocity + impact-detonate (or fuse-tune per Phase 1) | `src/game/weapons/dynamite.ts`, `tuning.ts` |
| 5 | Stronger explosion impulse + radius falloff | `src/game/gibs/tuning.ts`, `gibs/index.ts` if math lives there |
| 6 | Gib outcome selector + launched-corpse implementation | `src/game/enemy/*.ts`, `src/game/gibs/launched-corpse.ts` (new) |
| 7 | Tests, build/typecheck verification, TASKS.md update + close relevant F2 entries | all |

# Acceptance

1. **Stuck flare visible on enemy** during the 0.6s pre-ignition delay.
2. **Burn-death plays through end-to-end**: stuck → smoke → ignite →
   burning sprite + matching AI behavior (zombie walks toward player,
   cultist sprints) → DoT kills (cultist within ~3-5s; zombie similar)
   → collapse anim → gib spawn → small ground flame persists ~3-5s →
   fades.
3. **Dynamite throw feels right** — bundle reaches the far wall of the
   arena from spawn under reasonable input. Default bundle detonates
   on first impact (or matches Phase 1's actual mechanic).
4. **Explosion knockback visible** — gibs fly noticeably farther; chunk
   trajectories more dramatic.
5. **Launched-corpse outcome triggers on direct dynamite hits** —
   above the impulse threshold, the enemy's body separates (head gib +
   tumbling corpse) and the corpse bounces off arena geometry before
   settling.
6. `npx tsc --noEmit` green; `npm run build` green; `npm test` — all
   pre-existing tests pass; new tests cover (a) stuck-flare visibility
   gate, (b) cultist DoT death cap timer, (c) zombie burn-walk
   target-selection, (d) impact-detonate collision trigger, (e) gib
   outcome selector branching, (f) launched-corpse settle math.
7. **Phase 1 findings doc committed** at
   `docs/dev-notes/2026-04-26-notblood-fidelity-research.md` —
   committed *before* any of phases 2-7 modify code.

# Out of scope

- **Pickup/item drop on burn-melt.** Documented in Phase 1 doc;
  deferred. New F2 entry created (`F2.zombie-burn-drop`).
- **Fuse-based dynamite subtypes.** Default-bundle only; remote +
  prox + alt-bundles are deferred.
- **Per-bone ragdoll.** Launched-corpse is a single dynamic body, not
  a multi-body skeletal ragdoll.
- **AI-vs-AI explosion damage** (cultist/zombie damaging each other
  with friendly fire from caught-in-blast).
- **Cascade gibs** (existing F2.cascade-gibs entry — secondary chunk
  spawn on ground impact). May be addressed if Phase 1 finds it's
  cheap to bundle, otherwise stays deferred.
- **Cultist dodge / search / LOS** (existing F2.cultist.* entries).

# Process notes

- One dispatch on **deepseek-v4-pro** via **pi harness**, ~90min
  budget, mirroring the M5-C dispatch pattern.
- Branch: `dispatch/blud-m5d-fidelity-pass`. ff-merge to main after
  diff review + manual playtest.
- Phase 1 findings doc is the primary review artifact: it gets the
  reader (and the user) up to speed on what NotBlood actually does
  before any code review begins.
- The dispatch is empowered to recommend an alternative architecture
  in the Phase 1 doc if research reveals NotBlood's mechanic differs
  meaningfully from this spec's plan — the divergence must be
  cited with source lines and called out clearly in the doc.
