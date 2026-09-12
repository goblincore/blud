# Neural upscale P3 — owner runbook

From capture to a trained model in the game. Every step that costs money or touches the RunPod API
key is **yours**; agents never run them.

- Spec: `docs/superpowers/specs/2026-09-11-neural-upscale-p3-training-design.md`
- Budget: **$10 cap**. The estimate for one RTX 4090 at $0.69/h is about **3.9 h ≈ $2.70**
  (6 runs × 25 min, plus setup and a 40-minute pull window).

## 0. Check the pre-flight passed

`p3-preflight.md` in this folder must say **PASS**. It covers local training, G3 parity, the pull
round trip, the dashboard and the in-game smoke. Don't launch a pod otherwise.

## 1. Capture the dataset (local, hours)

On a quiet machine. Re-running the same command resumes. Details are in `p3a-capture.md`.

```bash
mkdir -p ~/blud-upscale-data
LAB_VITE_PORT=5320 LAB_CDP_PORT=9320 UPSCALE_NAME=v2-2026-09-12 UPSCALE_PAIRS=1000 \
  bash -c '. scripts/lab-servers.sh; trap lab_servers_down EXIT; lab_servers_up; node scripts/upscale-capture-v2.mjs' 2>&1 | tee ~/blud-upscale-data/v2-2026-09-12.log
uv run scripts/upscale-dataset-check.py ~/blud-upscale-data/v2-2026-09-12
```

**Roster.** The capture draws only `zombie,goblin,soldier` — the characters actually in the game.
The rest of `characterNames()` is work in progress and a third of it cannot spawn, so capturing it
would spend time and dataset weight on bodies that will not ship. Override when that changes:

```bash
UPSCALE_CHARACTERS=zombie,goblin,soldier,minotaur   # add one as it becomes ready
UPSCALE_CHARACTERS=all                              # whatever the page offers
```

Expect roughly **1–1.5 h** for 1,000 pairs (4.4–5.2 s/pair measured).

## 2. RunPod API key (once)

```bash
runpodctl doctor      # asks for the key from https://www.runpod.io/console/user/settings and saves it
runpodctl user        # shows your account and balance, so the key works
```

## 3. Pick a GPU and read its price

```bash
runpodctl gpu list
```

Pick one GPU with at least 24 GB that is in stock on community cloud. The RTX 4090 is the default;
an RTX 3090 or A5000 also works. Note its hourly price.

## 4. Pack, read the estimate, launch

```bash
scripts/neural-upscale/runpod/pack.sh ~/blud-upscale-data/v2-2026-09-12
scripts/neural-upscale/runpod/launch.sh --dataset ~/blud-upscale-data/v2-2026-09-12 --hourly-usd <price>         # dry run: read it
scripts/neural-upscale/runpod/launch.sh --dataset ~/blud-upscale-data/v2-2026-09-12 --hourly-usd <price> --yes   # creates the pod; billing starts
```

For another GPU, add `--gpu-id "<id from gpu list>"`. Note the pod id it prints.

## 5. Upload and start training

```bash
runpodctl send ~/blud-upscale-data/upload/v2-2026-09-12-upload.tar     # prints a one-time code
```

In the RunPod console, open the pod → **Connect** → **Web terminal**:

```bash
cd /workspace && runpodctl receive <code> && tar -xf v2-2026-09-12-upload.tar
bash /workspace/neural-upscale/runpod/bootstrap-pod.sh --data /workspace/v2-2026-09-12 --hourly-usd <price>
```

It starts in the background and prints the dashboard link. Closing the terminal is fine.

## 6. Watch the dashboard

`https://<pod id>-8080.proxy.runpod.net` opens on any device and refreshes every 30 s. The link is
unlisted but not password-protected; it shows only crops and numbers.

- **Runs table:** each number is the error against the clean supersampled picture, so lower is
  better. Green means the run beats plain bicubic resizing. **G4 pass** means it's worth trying in-game.
- **Curves:** train loss should fall. The validation lines should cross under the dashed bicubic
  line, especially on face, wound, edge, medium and far.
- **Showcase:** the same crop as nearest | bicubic | model | native | supersampled target.

The grid takes about 3 hours. Pod logs are `/workspace/grid.log` and `/workspace/bootstrap.log`.
If anything looks wrong: `scripts/neural-upscale/runpod/stop.sh <pod id>`.

## 7. Pull the models (within 40 minutes of the grid finishing)

When every run shows done (or the page shows `STOPPED_AT_CAP`):

```bash
scripts/neural-upscale/runpod/pull.sh <pod id>
```

It installs every export into `.upscale-models/` and runs G3 parity on each. Never load a model
whose parity fails.

## 8. Stop, delete, check the bill

The pod stops itself 40 minutes after the grid ends. Confirm it has, then delete it once the pull
has worked; a stopped pod still bills for its disk.

```bash
runpodctl pod get <pod id>
runpodctl pod delete <pod id>
runpodctl billing
```

## 9. Judge it in the game

```bash
npm run dev
```

Open `/sdf-game.html?upscale=trained&upscalemodel=<name>`. Use the name of the best G4-passing
export, for example `s16-rgbd-best`.

Press **U** to cycle **native** (full-resolution render) → **nearest** (blocky 2×) → **model**.
The label bottom-left names the mode. Look at faces, wounds and outlines at close, medium and far
range, both still and moving. Adding `&upscalelayout=dc` should look identical: it's the same maths,
laid out differently on the GPU.

Your verdict decides. Note it in `TASKS.md` or tell Claude.

## If the grid stopped at the cap or failed

- `STOPPED_AT_CAP`: the spend meter reached the cap (a pricier GPU or a slow pod). There is no
  automatic re-run; decide the next step with Claude.
- `GRID_FAILED.txt`: the grid crashed. The pod still packs what exists, waits, and stops. Pull
  what's there, confirm the pod stopped, and share `/workspace/grid.log`.
