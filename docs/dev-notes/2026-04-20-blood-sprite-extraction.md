# Blood (1997) Sprite Extraction — Dev Placeholder Workflow

**Status:** Placeholder workflow — REPLACE BEFORE RELEASE.
**Date:** 2026-04-20
**Purpose:** Extract zombie sprite frames from a legally-owned copy of *Blood* (1997, Monolith) into PNGs we can drop into the Blud gib system during development.

---

## 1. Legal framing (read this first)

The original *Blood* art is copyrighted by Atari / Nightdive. Using those sprites as temporary dev placeholders on your own machine (and on a private repo) is broadly tolerated in the modding scene and is how most Build-engine hobby devs bootstrap their art pipelines. **Shipping them in any public release of Blud — binaries, web build, public git branch, screenshots, itch demo — is copyright infringement.** You own Blood, so extract only from your own Steam/GOG/CD install, never from a pirated copy or someone else's RFF dump.

**Hard rules for this project:**

- Extracted frames live under `public/assets/enemies/zombie-placeholder/` (gitignored).
- `.gitignore` must exclude `**/zombie-placeholder/` and any file named `BLOOD.RFF`, `*.ART`, `*.SEQ`, `PALETTE.DAT`.
- Every file in the placeholder folder has filename suffix `-placeholder.png`. No exceptions.
- Before **any** public push, tag, or build artifact upload: `rg -l zombie-placeholder` must return zero hits in referenced code paths, or the art must be swapped.
- Add a CI check or a pre-release checklist item: "No Blood-derived art in shipped assets."

Treat this workflow like a throwaway scaffold. The real zombie sprites will be original art or a CC0 pack; these PNGs exist only so the gib system has something to animate while you build it.

---

## 2. Blood file formats (what you're dealing with)

Blood uses the Ken Silverman **Build engine** asset layout plus a Monolith-specific archive format:

- **`BLOOD.RFF`** — the main resource archive. Contains `.SEQ` animation scripts, `.QAV` weapon anims, `.RAW` sound, maps, etc. The RFF FAT may be XOR-encrypted (versions 0x300/0x301). Most extractors handle this transparently.
- **`TILES000.ART` … `TILES017.ART`** — Build-engine sprite tilesheets. Each `.ART` holds a contiguous range of numbered tiles. All graphics (walls, sprites, HUD, enemy frames) live here, addressed by a global tile number (`picnum`).
- **`PALETTE.DAT`** — the 256-color game palette. ART tiles are stored as 8-bit paletted, column-major (not row-major!) raw bytes. You must feed `PALETTE.DAT` to any extractor or you get color-scrambled output. Blood also has palette swap tables (palookups) used for cultists, lit/unlit variants, etc.
- **`.SEQ` files** — animation sequences inside `BLOOD.RFF`. Each SEQ is a list of frames; each frame references a tile number (`picnum`) plus timing (TPF = ticks per frame, 1/120s). Enemies are driven by SEQs keyed by a `seqStartId` in `dudeInfo`.

**Key implication:** in Blood, enemy animation is not a flat "tile N through tile N+K" range. It's a set of SEQs (one per state per angle) that reference arbitrary picnums. To get the right frames you either (a) extract all TILES\*.ART, open them in a GUI, and visually grab the zombie tiles, or (b) parse the relevant `.SEQ` files to get the exact picnum list per state. Option (a) is 10x faster for a placeholder pass.

---

## 3. Toolchain comparison

| Tool | Platform | Handles RFF | Handles ART + palette | PNG export | Link |
|---|---|---|---|---|---|
| **BAFed** (M210) | Java (macOS/Linux/Windows) | No (ART only) | Yes, preconfigured with Blood palette | Yes, batch multi-select export | [m210.duke4.net](https://m210.duke4.net/index.php/downloads/download/8-java/41-build-art-files-editor), [archive.org 2.20](https://archive.org/details/bafed-2.20) |
| **SLADE3** | macOS/Linux/Windows | No (ART only) | Yes, with correct palette loaded | Yes, right-click → Export as PNG | [github.com/sirjuddington/SLADE](https://github.com/sirjuddington/SLADE/releases) |
| **Camoto / libgamearchive** | Linux/Windows (CLI) | **Yes** — native Blood RFF support incl. decryption | Partial (reads ART) | Via scripting | [github.com/Malvineous/libgamearchive](https://github.com/Malvineous/libgamearchive) |
| **KBARF** | Linux/Windows (C source) | Yes — RFF extract + decrypt | No (RFF only) | No | Referenced from shikadi ModdingWiki |
| **BARFC** | Windows only | Yes | No | No | [cruo.bloodgame.ru/barfc](http://cruo.bloodgame.ru/barfc/) |
| **ReBUILD `rff` CLI** | Win32 + GPL source | Yes (formats 2.0/3.0/3.1) | No (pair with ART tools) | No | [blood.sourceforge.net/rebuild.php](https://blood.sourceforge.net/rebuild.php) |
| **xtract** | C, ported to macOS | GRP (Duke) — not Blood RFF | Yes (extracts ART tiles) | Unclear (check source) | [github.com/rusq/xtract](https://github.com/rusq/xtract) |
| **EDuke32 `kextract`** | Cross-platform | No — GRP only, not RFF | No | No | EDuke32 utilities |

### Recommended combo for macOS

**For a Blood install where `BLOOD.RFF` and `TILES*.ART` already sit side-by-side on disk (Steam "Blood: Fresh Supply", GOG One Unit Whole Blood, NotBlood-ready dumps): you do not need an RFF extractor at all.** The `TILES*.ART` and `PALETTE.DAT` are already loose files. Skip straight to BAFed.

**Primary recommendation: BAFed (Build ART Files Editor).** It's Java so runs on your Mac, it ships with the Blood palette preconfigured, it lets you Ctrl-click a range of tiles and batch-export to PNG, and it displays the alpha-keyed transparency correctly. Fastest path to a folder of PNGs.

**Fallback: SLADE3** if you prefer a native macOS binary and are comfortable loading `PALETTE.DAT` manually. Works but slightly more fiddly for Build ART.

**Only if `BLOOD.RFF` is a monolithic file with no loose ART on disk** (rare with modern Steam/GOG installs — they ship loose data for source port compat): use **Camoto** (`gamearch` CLI) to extract the RFF first. Camoto is the most maintained cross-platform option and handles Blood's FAT encryption natively.

---

## 4. Zombie sprite tile ranges

### What the source tells us

From NotBlood `source/blood/src/dude.cpp` (the `dudeInfo` table, ~line 28 onward), each enemy's entry contains a `seqStartId`. For zombie variants:

| Enemy | `seqStartId` |
|---|---|
| Axe Zombie (normal, kDudeZombieAxeNormal) | **4096** |
| Axe Zombie (buried variant) | 4352 |
| "Heavy" zombie variant | 4608 |
| Zombie variant (likely Axe pain/special) | 4864 |
| Butcher Zombie (kDudeZombieButcher) | **5632** |
| Zombie (burning/gib special) | 11520 |

**Important:** `seqStartId` is a Blood SEQ resource ID (the numeric name of a `.SEQ` file inside `BLOOD.RFF`, e.g. `4096.SEQ`), **not** a TILES.ART tile number. The SEQ file is the animation; it references actual picnums for each frame. To get exact tile numbers per state you'd parse the SEQ binary (see [SEQEDIT.TXT](https://github.com/videogamepreservation/blood/blob/master/SEQEDIT.TXT) for the format) — overkill for a placeholder pass.

### Practical tile range (visual grab via BAFed)

In the retail TILES layout, the axe zombie's sprite frames sit in a contiguous block inside **`TILES002.ART`** (tiles 2048-3071 in global numbering). Community sprite rips (e.g. [The Spriters Resource - Blood Axe Zombie](https://www.spriters-resource.com/ms_dos/blood/sheet/30721/)) show the axe zombie occupies roughly **tiles 2560-2720** across all states and 8 angles. Exact counts per state (axe zombie):

- **Walk/idle**: ~8 frames × 8 angles = ~64 tiles
- **Attack (swing)**: ~6 frames × 8 angles = ~48 tiles
- **Pain / hit flinch**: ~2-3 frames × 8 angles = ~16-24 tiles
- **Death (normal)**: ~5-7 frames, often front-facing only = ~7 tiles
- **Gib / explode**: shared gore tiles from the generic gib pool (tiles ~2200-2260 range) plus head/limb chunks

Butcher Zombie: in `TILES003.ART`, tiles roughly **2880-3000** — smaller set, fewer states.

**Treat these ranges as ~±50 estimates.** The definitive method is: open `TILES002.ART` in BAFed, scroll visually, select the zombie block, export. Takes 5 minutes.

---

## 5. Recommended procedure (macOS, 30-minute path)

Prereqs: Blood install on disk (Steam Fresh Supply, GOG, or original CD data), Java 11+, BAFed 2.20.

```
# 1. Locate the data files. Typical macOS Steam path:
ls "~/Library/Application Support/Steam/steamapps/common/Blood Fresh Supply/"
# Expect: BLOOD.RFF, TILES000.ART ... TILES017.ART, PALETTE.DAT, *.MAP

# 2. Make a scratch folder (OUTSIDE the repo; these files must never be committed)
mkdir -p ~/scratch/blood-extract
cd ~/scratch/blood-extract

# 3. Copy in the three things BAFed needs
cp "~/Library/Application Support/Steam/steamapps/common/Blood Fresh Supply/TILES002.ART" .
cp "~/Library/Application Support/Steam/steamapps/common/Blood Fresh Supply/TILES003.ART" .
cp "~/Library/Application Support/Steam/steamapps/common/Blood Fresh Supply/PALETTE.DAT" .

# 4. Launch BAFed
java -jar BAFed.jar
```

In BAFed GUI:

1. **File → Open Palette** → select `PALETTE.DAT`. Choose "Blood" preset if prompted.
2. **File → Open ART** → `TILES002.ART`. Tile grid renders with transparency.
3. Scroll to ~tile 2560. You'll see the axe zombie walk cycle laid out as 8 angles × frames.
4. Click first zombie tile, Shift+Click last zombie tile (covers all states).
5. **File → Export Selected → PNG** → choose output folder `~/scratch/blood-extract/png/`.
6. BAFed writes `2560.png`, `2561.png`, ... one file per tile, palette-correct, alpha-keyed.

Then organize on the command line:

```bash
cd ~/scratch/blood-extract/png

# Quick sanity check - count extracted frames
ls *.png | wc -l

# Rename into semantic folders (adjust ranges after you eyeball what's what)
mkdir -p walk attack pain die gib
# Blood lays out sprites as 8 angles per frame. Walk is typically first block.
# Example (tune after inspection):
mv 2560.png 2561.png 2562.png 2563.png 2564.png 2565.png 2566.png 2567.png walk/
# ... etc

# Stage into the project (gitignored path)
mkdir -p /Users/donny/Projects/blud/public/assets/enemies/zombie-placeholder
cp -r walk attack pain die gib /Users/donny/Projects/blud/public/assets/enemies/zombie-placeholder/
```

Verify the gitignore catches it:

```bash
cd /Users/donny/Projects/blud
git check-ignore public/assets/enemies/zombie-placeholder/walk/2560.png
# Expect: the path echoed back (meaning it IS ignored). If silent, fix .gitignore NOW.
```

### If TILES files aren't loose on disk (monolithic RFF)

Insert before step 3:

```bash
# Install Camoto gamearch (homebrew has no formula; build from source)
git clone https://github.com/Malvineous/libgamearchive
cd libgamearchive && ./autogen.sh && ./configure && make
# gamearch CLI is then in src/
./src/gamearch --type=arch-rff-blood ~/path/to/BLOOD.RFF --list
./src/gamearch --type=arch-rff-blood ~/path/to/BLOOD.RFF --extract=TILES002.ART
```

---

## 6. Legally-free alternatives (fallback)

If the Blood extraction is painful, or you want an early smoke-test asset you could accidentally commit without panic, there are CC0/CC-BY zombie sprite packs:

- **OpenGameArt — "Zombie sprites"**: multiple CC0 packs, typically 4-8 angles, walk/attack/death. Search [opengameart.org](https://opengameart.org/) for "zombie sprite". Quality varies; a few packs are Build-engine-compatible in proportion.
- **Kenney.nl voxel / isometric zombies**: CC0, clean, consistent. Aesthetic is modern-chunky rather than 1997-pixelated, so doesn't match Blud's intended look but is drop-in safe.
- **Freedoom monsters**: GPL-licensed (note: GPL, not CC0 — compatible with open-source projects but imposes obligations). Includes a Former Human zombie in 8-angle sprite format. Closest match to Build-era aesthetic of the free options. [freedoom.github.io](https://freedoom.github.io/)

Not recommending a switch — the Blood placeholders will animate better because they're the exact frame counts Blud's gib system is being designed around — but these exist as emergency backup and are safe to check in.

---

## Checklist before any public commit or release build

- [ ] `rg -i "zombie-placeholder|BLOOD\.RFF|TILES0[0-1][0-9]\.ART" --type-not gitignore` returns no hits in tracked files
- [ ] `public/assets/enemies/zombie-placeholder/` is listed in `.gitignore`
- [ ] No screenshot in README / marketing shows Blood sprites
- [ ] Zombie asset references in code point to replacement (original or CC0) art, not `zombie-placeholder/`

---

## Sources

- [NotBlood dude.cpp](https://github.com/clipmove/NotBlood/blob/master/source/blood/src/dude.cpp) — `dudeInfo` table with `seqStartId` values
- [Blood SEQ format spec (SEQEDIT.TXT)](https://github.com/videogamepreservation/blood/blob/master/SEQEDIT.TXT)
- [RFF file format — shikadi ModdingWiki](https://moddingwiki.shikadi.net/wiki/RFF_Format)
- [Build ART format — justsolve Archive Team](http://justsolve.archiveteam.org/wiki/ART_(Duke_Nukem_3D))
- [BAFed on m210.duke4.net](https://m210.duke4.net/index.php/downloads/download/8-java/41-build-art-files-editor)
- [SLADE3 releases](https://github.com/sirjuddington/SLADE/releases)
- [Camoto / libgamearchive](https://github.com/Malvineous/libgamearchive)
- [ReBUILD Project (rff CLI, ART tools)](https://blood.sourceforge.net/rebuild.php)
- [The Spriters Resource — Blood Axe Zombie](https://www.spriters-resource.com/ms_dos/blood/sheet/30721/)
- [Blood Wiki — Axe Zombie](https://blood-wiki.org/index.php/Axe_Zombie)
