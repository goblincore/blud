/**
 * Standalone dev preview for R5.1 theme families.
 * Loads patterns.json, picks one family, renders 3 textured quads
 * (floor/wall/ceiling) with top-weighted picnums. Top-down ortho camera.
 * Not shipped — dev route only.
 */
import * as THREE from 'three';

interface WeightedPicnum { picnum: number; weight: number }
interface FamilyEntry {
  name: string;
  theme_tag: string;
  sector_count: number;
  floors: WeightedPicnum[];
  walls: WeightedPicnum[];
  ceilings: WeightedPicnum[];
}
interface Patterns {
  texture_families: Record<string, FamilyEntry>;
  map_archetypes: Record<string, { archetype: string; theme_tag: string }>;
}

async function main(): Promise<void> {
  const info = document.getElementById('family-info')!;
  const familyId = new URLSearchParams(window.location.search).get('family') ?? 'family_126';

  let patterns: Patterns;
  try {
    const res = await fetch('/assets/map-research/patterns.json');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    patterns = await res.json();
  } catch (err) {
    info.innerHTML = `<span class="err">Failed to load patterns.json: ${err}</span>
      <div style="margin-top:6px">Run <code>python scripts/analyze_maps.py</code> first,
      or validate via <code>python scripts/validate_patterns_schema.py</code>.</div>`;
    renderEmpty();
    return;
  }

  const family = patterns.texture_families[familyId];
  if (!family) {
    const avail = Object.keys(patterns.texture_families).slice(0, 10).join(', ');
    info.innerHTML = `<span class="err">Family '${familyId}' not found</span>
      <div>Try: ${avail}…</div>`;
    renderEmpty();
    return;
  }

  const topPicnum = (arr: WeightedPicnum[]) =>
    arr.slice().sort((a, b) => b.weight - a.weight)[0]!.picnum;
  const floorPic = topPicnum(family.floors);
  const wallPic  = topPicnum(family.walls);
  const ceilPic  = topPicnum(family.ceilings);

  info.innerHTML = `
    <b>${family.name}</b> <span style="opacity:.7">(${familyId})</span><br>
    theme: <code>${family.theme_tag}</code> · sectors: ${family.sector_count}<br>
    floor <code>${floorPic}</code> · wall <code>${wallPic}</code> · ceil <code>${ceilPic}</code>
  `;
  renderScene(floorPic, wallPic, ceilPic);
}

function renderEmpty(): void {
  const mount = document.getElementById('app')!;
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1116);
  const cam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  cam.position.z = 3;
  renderer.setAnimationLoop(() => renderer.render(scene, cam));
}

function renderScene(floorPic: number, wallPic: number, ceilPic: number): void {
  const mount = document.getElementById('app')!;
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1116);

  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = 6;
  const camera = new THREE.OrthographicCamera(
    -viewSize * aspect, viewSize * aspect,
     viewSize, -viewSize,
     0.1, 100,
  );
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);

  const loader = new THREE.TextureLoader();
  const loadTile = (p: number): THREE.Texture => {
    const t = loader.load(`/assets/blood-tiles/${p}.png`);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: loadTile(floorPic) }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = new THREE.MeshBasicMaterial({ map: loadTile(wallPic) });
  const wallN = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.4), wallMat);
  wallN.rotation.x = -Math.PI / 2;
  wallN.position.set(0, 0.01, -3);
  scene.add(wallN);
  const wallE = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 6), wallMat);
  wallE.rotation.x = -Math.PI / 2;
  wallE.position.set(3, 0.01, 0);
  scene.add(wallE);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshBasicMaterial({ map: loadTile(ceilPic) }),
  );
  ceil.rotation.x = -Math.PI / 2;
  ceil.position.set(-2.2, 0.02, -2.2);
  scene.add(ceil);

  window.addEventListener('resize', () => {
    const a = window.innerWidth / window.innerHeight;
    camera.left = -viewSize * a; camera.right = viewSize * a;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => renderer.render(scene, camera));
}

main().catch((err) => {
  console.error(err);
  const info = document.getElementById('family-info');
  if (info) info.innerHTML = `<span class="err">boot error: ${err}</span>`;
});
