# Level 0: The Wake — Implementation Brief

**Date:** 2026-09-11 · **Design:** [design.md](design.md) · **Tasks:** [tasks.md](tasks.md)

The entry point for agents building the Wake. It splits the work into three
implementation plans, says what each one depends on, and pins the decisions
that were made so agents don't re-open them.

---

## 1. The three plans

| # | Plan | What it builds | Covers tasks |
| --- | --- | --- | --- |
| 1 | [Level format + Blender pipeline](../../../superpowers/plans/2026-09-11-wake-1-level-format.md) | A level JSON format, generic layout generators, a Blender exporter, the Wake blockout, `?level=the-wake` in the game, a headless gate | P-1, P-2, W-B1, W-H2 |
| 2 | [Game loop](../../../superpowers/plans/2026-09-11-wake-2-game-loop.md) | Player health and damage, death/restart, pickups and ammo reserve, triggers and gates, level complete, a status HUD | L-1 … L-5 |
| 3 | [Wake content](../../../superpowers/plans/2026-09-11-wake-3-content.md) | The starting melee weapon (shovel / pickaxe / axe variants), the bell, grave waves, room alerts, the CD ending | W-B2, W-B4, W-B6, W-D7 (numbers only) |

**Order:** Plan 1 tasks 1–2 first (they define the shared types). Then Plan 1
tasks 3–6 and Plan 2 tasks 1–3 and Plan 3 tasks 1, 3, 4 can all run in
parallel: they are pure modules. The `game-main.ts` wiring tasks run one at a
time, in this order: Plan 1 T5 → Plan 2 T4 → Plan 2 T5 → Plan 3 T2 → Plan 3 T5.

```
P1-T1 ─ P1-T2 ─┬─ P1-T3 ─ P1-T4 ─────────────┐
               ├─ P2-T1, P2-T2, P2-T3 (pure)  │
               └─ P3-T1, P3-T3, P3-T4 (pure)  │
                                             ▼
          P1-T5 (wire level) ─ P1-T6 (gate) ─ P2-T4 (damage, death, HUD)
            ─ P2-T5 (pickups, triggers, gates) ─ P3-T2 (melee) ─ P3-T5 (bell, waves)
            ─ P3-T6 (owner playtest)
```

## 2. Base branch

**Plans 2 and 3 build on the dynamite weapon-slot work**, which is not on
`main` yet: `claude/dynamite-weapon-slot` (worktree
`.claude/worktrees/dynamite-weapon-slot`) adds `game-weapon-slots.ts` (slot
switching), unlimited ammo by default (`?ammo=finite` restores the magazine), a
live-actor gib and `?room=`.

- **Plan 1 tasks 1–4** touch no shared files: base on `main`.
- **Everything that edits `game-main.ts`**: base on `main` *after*
  `claude/dynamite-weapon-slot` merges. If it hasn't merged when the work
  starts, base on `claude/dynamite-weapon-slot` and say so in the commit.
- **Never** start a wiring task on a branch that lacks `game-weapon-slots.ts`;
  Plan 3's melee slot extends it.

## 3. Decisions pinned for implementers

| Decision | Detail |
| --- | --- |
| **Levels are Blender scenes exported to JSON** | Rooms, tunnels, furniture, solids, gates and triggers are boxes; spawns, graves, pickups, bells and the start are empties; accents are point lights. The game generates walls, mouths and lintels from rooms + tunnels, exactly like the ring level. |
| **One floor height in v1** | Every floor is y = 0. The crypt is *at grade* in the blockout (a low, dark room), not down stairs. Actors and the player controller both assume a flat floor; multi-height floors are a separate project. |
| **Authored levels load with `?level=<id>`** | From `public/assets/levels/<id>.level.json`. No param = the existing ring level, unchanged. |
| **Navigation is built with gates open** | So enemies can route through a gate once it opens. The player collides with closed gates. |
| **Melee is slot 1** | Slots become `melee` (Digit1), `shotgun` (Digit2), `dynamite` (Digit3). The Wake starts with melee only; the shotgun must be picked up. |
| **The Wake uses finite ammo** | The level JSON's `ammo: "finite"` turns the magazine and reserve on; the ring keeps unlimited ammo. |
| **Melee damage reuses projectile wounds** | A swing calls `actor.hit()` (pellet crater) or `actor.hitSlug()` (big crater) at sampled contact points. No new wound type in v1. |
| **The bell is a mesh, not SDF, in v1** | Hit by a segment-vs-sphere test; it swings and tolls. Dents are a follow-up. |
| **Waves spawn standing** | Zombies appear at their grave with no climb-out animation in v1. A climb/rise animation is a follow-up. |
| **Sound** | None. The game has no audio yet. Put `// SOUND:` comments where a sound belongs. |

## 4. Dispatch notes

- Plans follow the repo's plan format; `superpowers:dispatching-plans` turns
  each `### Task N` into a dispatch file.
- **Dispatchable (pure, no GPU):** every task marked *(dispatchable)*. They run
  vitest and `tsc` only.
- **Session tasks** (marked *(session)*) edit `game-main.ts` and need the
  browser gate or a human look. Run them in a Claude Code session, one at a time.
- Dispatch frontmatter: copy `docs/dev-notes/dispatch-character-task-template.md`
  (`status: pending`; model with its provider prefix; `base_branch` per §2;
  `setup: "test -d node_modules || ln -s /Users/donny/Projects/blud/node_modules node_modules"`).
- **Headless gates** run with `LAB_TMP=.lab-tmp` in a sandbox, or Chrome
  silently produces no frames (`scripts/lab-servers.sh`).
- Blender tasks need `/opt/homebrew/bin/blender` (Blender 5.2) on PATH.
- Do not claim a GPU, gameplay or build pass from unit tests alone (AGENTS.md).

## 5. What "done" looks like for the Wake v1

1. `npm run dev` then `/sdf-game.html?level=the-wake` boots into the gates,
   holding the melee weapon.
2. Walk the whole route: gates → open grave (shotgun; two zombies rise) →
   graveyard → shoot the bell (crypt opens, wave) → crypt → parlour (mourners
   turn) → CD on the coffin → "level complete".
3. Zombies hurt; you can die and restart.
4. `scripts/sdf-game-wake-gate.sh` passes.
5. The owner has played it and picked the starting melee variant (P3-T6).
