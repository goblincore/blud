// scripts/module-index.ts
//
// Writes docs/architecture/module-index.md: one line per source module of the
// active tree (src/lab/sdf-zombie), grouped by area, so "which file owns X" is
// one grep away instead of a search through 800 flat files.
//
// Each line is the first sentence of the module's own header comment. A module
// with no header (or with only the extraction boilerplate) is listed as
// missing, and scripts/module-index.test.ts fails on it.
//
//   npx tsx scripts/module-index.ts           # rewrite the index
//   npx tsx scripts/module-index.ts --check   # exit 1 if it is stale
//   npx tsx scripts/module-index.ts --missing # list modules with no summary
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = 'src/lab/sdf-zombie';
export const INDEX_PATH = 'docs/architecture/module-index.md';
const SUMMARY_MAX = 150;

/** First match wins. Patterns test the path relative to ROOT, without `.ts`. */
export const AREAS: ReadonlyArray<{ name: string; about: string; match: RegExp }> = [
  // Subdirectories are already areas.
  { name: 'webgpu/march/', about: 'The SDF march shader, split by stage (WGSL).', match: /^webgpu\/march\// },
  { name: 'webgpu/earlyz/', about: 'Early-Z depth prepass for the march.', match: /^webgpu\/earlyz\// },
  { name: 'webgpu/skeleton-spike/', about: 'Mesh skeletons, skulls and organs drawn under the SDF flesh (shipped, despite the name).', match: /^webgpu\/skeleton-spike\// },
  { name: 'webgpu/upscale/', about: 'Upscaling of the low-res march target.', match: /^webgpu\/upscale\// },
  { name: 'characters/', about: 'Character bodies: `.blob` sources, generators and per-character data.', match: /^characters\// },
  { name: 'shared-wounds/', about: 'Shared wound-field probe page.', match: /^shared-wounds\// },
  { name: 'gait-curves/', about: 'Baked gait curve data.', match: /^gait-curves\// },

  // webgpu/ (the game and the WebGPU renderer)
  { name: 'Entrypoints and labs', about: 'One module per HTML page; see the entrypoint table above.', match: /(^|\/)[\w-]*main$|^webgpu\/(lab-renderer|normal-gradient-(probe|playtest))$|^webgl-bench$/ },
  { name: 'Dev panels', about: 'Tuning panels for the labs and the game.', match: /(^|\/)[\w-]*panel[\w-]*$/ },
  { name: 'Game: context and state', about: 'The GameContext and its state slices (ECS resources to be). All game state lives here.', match: /^webgpu\/(game-context|game-state-|seam-merge|boot-params|sim-clock|rng$)/ },
  { name: 'Game: debug seams', about: '`window.__sdfGame` members, read by the gate and capture scripts.', match: /^webgpu\/game-seams-/ },
  { name: 'Game: functions lifted out of main()', about: 'Named for how they were extracted, not what they hold; to be renamed by content.', match: /^webgpu\/game-[\w-]*-leaves\d*$/ },
  { name: 'Game: feature modules', about: 'Gameplay features wired into the game loop.', match: /^webgpu\/game-/ },
  { name: 'Weapons and viewmodel (render)', about: 'Weapon strikes, muzzle flash, held props, first-person view.', match: /^webgpu\/(axe-|flail-|muzzle-flash|flash-sprite|recoil-carry|free-aim|fpv-view|held-prop|viewmodel-|shotgun-casings|tracer-sprite|dynamite-|hand-volume|hands-sheet|pickups)/ },
  { name: 'Gibs and chunks (render)', about: 'Gib assets, baked chunks, gib sprites.', match: /^webgpu\/(gib-|chunk-|baked-chunks|gore-part-geom|soldier-corpse-bake)/ },
  { name: 'Blood, goo and splashes (render)', about: 'Blood views, the goo layer, impact splashes.', match: /^webgpu\/(blood-|goo-|impact-splash)/ },
  { name: 'Fire and explosions (render)', about: 'Burning bodies, fire volumes, flames, explosion VFX.', match: /^webgpu\/(burn-|fire-|flame-|explosion-vfx|post-tongues|tongue-tuning)/ },
  { name: 'Lighting and probes (render)', about: 'Light lists, profiles, layers, probe grids, outdoor light.', match: /^webgpu\/(light-|lamp-moods|probe-|room-probes|dungeon-lighting|outdoor-|kit-lights|self-shadow|beacon|storm|flashlight-bounce|ambient)/ },
  { name: 'Levels and world', about: 'Level definitions, kits, the train, the disco, the egg, sky, encounters.', match: /^webgpu\/(level-|active-level|enclosure|train-|disco-|egg|void-portal|portal|sky|kit-|ending-sequence|encounter-)/ },
  { name: 'Actors and crowd (render)', about: 'Per-actor GPU records, crowd atlas, character views, wounds on screen.', match: /^webgpu\/(crowd-|actor-sight|enemy-mind|character-|visual-actor-set|humanoid|zombie-gpu|bone-|goblin-skin|wound-|player-vitals)/ },
  { name: 'Deferred renderer (paused)', about: 'Opt-in deferred path; paused by the owner, not pursued.', match: /^webgpu\/deferred-/ },
  { name: 'Post-processing', about: 'AA, glow, VHS, shutter blur, fisheye.', match: /^webgpu\/(post-|fisheye|shutter-|vhs-)/ },
  { name: 'Bench, demo and telemetry', about: 'Benchmarks, demo record/replay, frame hashes, GPU timing.', match: /^webgpu\/(bench-|demo-|frame-hash|gpu-|pipeline-log)/ },
  { name: 'SDF march renderer', about: 'The SDF layer, hulls and shells, tile culling, surface nets, temporal accumulation.', match: /^webgpu\// },

  // The tree root (renderer-free logic, mostly)
  { name: 'Character authoring', about: 'The `.blob` language, body building, validation, silhouette fitting.', match: /^(blob-|build-body|body|face$|validate|connectivity|simplify|mirror|silhouette|ref-|ring-fit|mesh-beam-fit|extent|character-registry|pack|resolve|translate|clusters|lod|material|plate-armor|png-decode|bone-derive|types|vec$)/ },
  { name: 'Rig, pose and motion', about: 'Rigs, poses, IK, gait, motion profiles, hands.', match: /^(rig|pose|ik$|gait|motion|humanoid-pose|glb-clip|hand|wander|stagger|attack|charge|carry|collapse|sword-swing|barrel-spin|jaw)/ },
  { name: 'Damage, wounds and heads', about: 'Wound fields, severing, head damage and the head split, death states, melting, burning.', match: /^(damage|cut-wound|sever|humanoid-|head-|torn-lips|death-state|soft-death|melt|burn-|bleed-registry|player-hit-feedback)/ },
  { name: 'Gibs and gore (logic)', about: 'Gib parts, launch, tearing, entrails, strands.', match: /^(gib-|gore-parts|gobs|flesh-bits|entrails|strand|chunk-bake-field|detached-pose)/ },
  { name: 'AI and actors (logic)', about: 'Brains, the soldier, crowd logic.', match: /^(brain|soldier-|actor|crowd|zombie|status-lights)/ },
  { name: 'Weapons and FPV (logic)', about: 'First-person mode, dynamite flight, explosions, rockets, tracers.', match: /^(fpv|dynamite-flight|explosion-aoe|rockets|melee-ring|tracer-lights|prop-drop|blast-refraction)/ },
  { name: 'Blood and lighting probes (logic)', about: 'Blood simulation, probe grids, ambient.', match: /^(blood-|probe-|ambient|flashlight-bounce)/ },
  { name: 'Shared helpers and the WebGL lab', about: 'What fits no area above: the original WebGL lab shader, resolution scaling, samplers.', match: /^/ },
];

export interface ModuleEntry {
  /** Path relative to ROOT. */
  path: string;
  area: string;
  /** null when the module has no usable header. */
  summary: string | null;
}

const BOILERPLATE = /^(Extracted from game-main\.ts|Members lifted verbatim|Plan: docs\/)/;

/** The first sentence of a module's header comment, or null. */
export function summarize(source: string): string | null {
  const paragraphs = headerParagraphs(source);
  for (const p of paragraphs) {
    // A bare path line (`// src/…/x.ts`) is a label, not a summary.
    // The label may share its paragraph with the text that follows it.
    const text0 = p.replace(/^\S+\.(ts|js|mjs)(\s+|$)/, '');
    if (text0 === '' || BOILERPLATE.test(text0)) continue;
    const sentence = /^(.*?[.!?])(\s|$)/.exec(text0)?.[1] ?? text0;
    // A sentence cut at "e.g." or a version number is worse than the paragraph.
    const text = sentence.length < 25 && text0.length > sentence.length ? text0 : sentence;
    return clip(text);
  }
  return null;
}

function headerParagraphs(source: string): string[] {
  const lines = source.replace(/^\uFEFF/, '').split('\n');
  const body: string[] = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i]?.trimStart().startsWith('//')) {
    for (; i < lines.length && lines[i].trimStart().startsWith('//'); i++) {
      body.push(lines[i].trimStart().replace(/^\/\/\/?\s?/, ''));
    }
  } else if (lines[i]?.trimStart().startsWith('/*')) {
    for (; i < lines.length; i++) {
      const end = lines[i].includes('*/');
      body.push(lines[i].replace(/^\s*\/\*+\s?/, '').replace(/\*\/.*$/, '').replace(/^\s*\*\s?/, ''));
      if (end) break;
    }
  }
  return body
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '');
}

function clip(text: string): string {
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function areaOf(path: string): string {
  const key = path.replace(/\.(ts|js)$/, '');
  return AREAS.find((a) => a.match.test(key))!.name;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__snapshots__') walk(p, out);
    } else if (/\.(ts|js)$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

export function collect(root = ROOT): ModuleEntry[] {
  return walk(root)
    .map((file) => {
      const path = relative(root, file).split('\\').join('/');
      return { path, area: areaOf(path), summary: summarize(readFileSync(file, 'utf8')) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** HTML page → module, read from the root `*.html` files. */
export function entrypoints(dir = '.'): Array<{ page: string; module: string }> {
  const out: Array<{ page: string; module: string }> = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.html')).sort()) {
    const src = /<script[^>]*\ssrc="\/(src\/[^"]+)"/.exec(readFileSync(join(dir, name), 'utf8'))?.[1];
    if (src?.startsWith(`${ROOT}/`)) out.push({ page: `/${name}`, module: src.slice(ROOT.length + 1) });
  }
  return out;
}

export function render(entries: ModuleEntry[], pages: Array<{ page: string; module: string }>): string {
  const out: string[] = [
    '# Module index (generated)',
    '',
    '<!-- Generated by scripts/module-index.ts. Do not edit by hand: change the',
    "     module's header comment, then run `npx tsx scripts/module-index.ts`. -->",
    '',
    `One line per module of the active tree. Paths are relative to \`${ROOT}/\`.`,
    'Tests sit beside their module as `<name>.test.ts` and are not listed.',
    "Each line is the first sentence of the module's header comment.",
    '',
    '## Entrypoints',
    '',
    '| Page | Module |',
    '| --- | --- |',
    ...pages.map((p) => `| \`${p.page}\` | \`${p.module}\` |`),
    '',
    '## Areas',
    '',
    '| Area | Modules | What is there |',
    '| --- | --- | --- |',
  ];
  const used = AREAS.filter((a) => entries.some((e) => e.area === a.name));
  for (const a of used) {
    out.push(`| [${a.name}](#${slug(a.name)}) | ${entries.filter((e) => e.area === a.name).length} | ${a.about} |`);
  }
  for (const a of used) {
    out.push('', `## ${a.name}`, '', a.about, '');
    for (const e of entries.filter((x) => x.area === a.name)) {
      out.push(`- \`${e.path}\` — ${e.summary ?? '(no summary)'}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function slug(heading: string): string {
  return heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const entries = collect();
  if (process.argv.includes('--missing')) {
    for (const e of entries.filter((x) => x.summary === null)) console.log(e.path);
  } else {
    const text = render(entries, entrypoints());
    if (process.argv.includes('--check')) {
      let current = '';
      try { current = readFileSync(INDEX_PATH, 'utf8'); } catch { /* absent counts as stale */ }
      if (current !== text) {
        console.error(`${INDEX_PATH} is stale. Run: npx tsx scripts/module-index.ts`);
        process.exit(1);
      }
    } else {
      writeFileSync(INDEX_PATH, text);
      const missing = entries.filter((e) => e.summary === null).length;
      console.log(`${INDEX_PATH}: ${entries.length} modules, ${missing} without a summary`);
    }
  }
}
