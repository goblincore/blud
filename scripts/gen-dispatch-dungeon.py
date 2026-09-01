import io, os, re

PLAN = '/Users/donny/Projects/blud/.claude/worktrees/dungeon-relighting-specularity-15dbea/docs/superpowers/plans/2026-09-01-dungeon-relighting.md'
SLUG = '2026-09-01-dungeon-relighting'
OUT  = os.path.expanduser('~/.claude/dispatch/plans')
PROJ = '/Users/donny/Projects/blud'
src  = io.open(PLAN, encoding='utf-8').read()

# --- split into task sections -------------------------------------------
parts = re.split(r'^## Task (\d+): (.+)$', src, flags=re.M)
header = parts[0]
tasks = {}
for i in range(1, len(parts), 3):
    n = int(parts[i]); name = parts[i+1].strip(); body = parts[i+2]
    body = re.split(r'^## Self-Review', body, flags=re.M)[0]
    tasks[n] = (name, body.rstrip())

goal = re.search(r'\*\*Goal:\*\* (.+)', header).group(1)
arch = re.search(r'\*\*Architecture:\*\* (.+?)\n\n', header, re.S).group(1).replace('\n',' ')
stack = re.search(r'\*\*Tech Stack:\*\* (.+)', header).group(1)
nonneg = re.search(r'## Non-negotiables\n\n(.+?)\n---', header, re.S).group(1).strip()

SHOTS = {
    2: ['beam', 'corridor'],
    3: [],
    4: [],
    5: ['wall', 'corridor'],
    6: ['room', 'corridor'],
    7: ['beam'],
    8: ['beam'],
    9: ['corridor'],
}

DEPS = {
    2: [], 3: [],
    4: [3], 5: [2, 4], 6: [5], 7: [6], 8: [7], 9: [8],
}
TOTAL = 10

written = []
for n in sorted(DEPS):
    name, body = tasks[n]
    dep = ', '.join(f'{SLUG}-task-{d}' for d in DEPS[n])
    fm = f'''---
title: "Dungeon Relighting - Task {n}: {name}"
status: pending
project: {PROJ}
model: zai/glm-5.3-flash
api_key_env: ZAI_API_KEY
base_url: https://api.z.ai/api/coding/paas/v4
branch: dispatch/{SLUG}-task-{n}
priority: 2
max_runtime: 30m
created: 2026-09-01
depends_on: [{dep}]
allowed_tools: Edit,Write,Bash,Read,Glob,Grep,WebFetch,WebSearch
harness: pi
---
'''
    shots = SHOTS[n]
    if shots:
        shotline = ('**For THIS task, capture and read these poses before you commit:** '
                    + ', '.join('`%s`' % x for x in shots) + '.')
    else:
        shotline = ("**This task changes no rendering** (it is pure module code with no "
                    "wiring into the scene yet), so no screenshot is required. Do not "
                    "waste runtime capturing one.")
    doc = fm + f'''
## Context

This is Task {n} of {TOTAL} from the implementation plan **Dungeon Relighting**
(`docs/superpowers/plans/2026-09-01-dungeon-relighting.md`). Read the spec for background:
`docs/superpowers/specs/2026-09-01-dungeon-relighting-design.md`.

**Goal:** {goal}

**Architecture:** {arch}

**Tech Stack:** {stack}

### What this project is

Blud is a Blood-inspired FPS. The page `sdf-game.html` currently renders a BRIGHT
WHITE ART GALLERY — a ring of 4 rooms joined by tunnels. We are pivoting it to a
DARK, DANK, WET GRAY STONE DUNGEON lit by an offset weapon-mounted flashlight and
warm fire braziers, with per-pixel bumped specular on the stone ("Doom 3 meets
dungeon", owner's words).

Task 1 (already merged) created `src/lab/sdf-zombie/webgpu/dungeon-lighting.ts`,
which exports `AmbientRig`, `GALLERY_RIG` and `DUNGEON_RIG` as plain data.

### Non-negotiables — violating one of these costs a day

{nonneg}

### Test baseline

`npm test` currently reports **7 failures, ALL in `scripts/blob-measure.test.ts`**
(a pre-existing `tsx` binary issue). That file is NOT your problem. Any OTHER
failing test is yours and must be fixed before you commit.

### Visual verification — you CAN do this, and you MUST

You are a vision-capable model, and this repo has a headless WebGPU capture
harness. A green test suite is NOT evidence that a render change worked — this
project's recorded scar is explicit: *"the toolchain does not compile shaders
anywhere — three render bugs survived eight green dispatch tasks."* So look at
the thing.

One command gets you a deterministic screenshot (it boots a Vite server and a
WebGPU headless Chrome if they are not already up, and stops only what it
started):

```bash
LAB_VITE_PORT=5288 LAB_CDP_PORT=9288 scripts/dungeon-look.sh <pose>
# writes /tmp/dungeon-look/<pose>.png
```

Named poses: `corridor` (down a tunnel — falloff and fog), `wall` (close on
stone — normal-map specular), `beam` (a figure lit by the beam — shadows),
`room` (room3 zombies). For anything else:
`LOOK_POSE="x,z,yaw,pitch" scripts/dungeon-look.sh custom`.

Then **`Read` the PNG** — that gives you the image — and judge it against what
the task says should have changed. The HUD in the top-left also prints a real
frame time, which is trustworthy because the sim is frozen and stepped
deterministically.

{shotline}

If a shot shows the change did not work, FIX IT and shoot again. Do not commit a
render change whose screenshot you have not looked at. If a shot is inconclusive,
say so explicitly in your report rather than claiming success.

## Instructions

{body}

## Acceptance Criteria

- Every `- [ ]` step is completed (the screenshot steps included)
- `npm test` shows 7 failures, all in `scripts/blob-measure.test.ts`, and no others
- `npx tsc --noEmit` is clean
- Changes are committed to branch `dispatch/{SLUG}-task-{n}`
- Every screenshot named above was captured AND read, and your report says what
  you saw in each one — not that you took it, what it showed
- If any step still could not be verified, your report says so plainly
'''
    path = os.path.join(OUT, f'{SLUG}-task-{n}.md')
    io.open(path, 'w', encoding='utf-8').write(doc)
    written.append((n, name, DEPS[n], path))

for n, name, d, p in written:
    print('task-%-2d deps=%-14s %s' % (n, str(d), name))
print(f'\n{len(written)} files written to {OUT}')
