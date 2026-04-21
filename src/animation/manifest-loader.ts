import type { AnimationManifest, TileMetaMap } from './qav-schema';
import { validateManifest } from './qav-schema';

export interface AnimationBundle {
  tileMeta: TileMetaMap;
  weapons: Record<string, AnimationManifest>;
  characters: Record<string, AnimationManifest>;
}

const BASE = 'assets/animations';

export async function loadAnimationManifests(): Promise<AnimationBundle> {
  const [tileMetaRes, indexRes] = await Promise.all([
    fetch(`${BASE}/tiles-meta.json`),
    fetch(`${BASE}/index.json`),
  ]);
  if (!tileMetaRes.ok) throw new Error('failed to load tiles-meta.json');
  if (!indexRes.ok) throw new Error('failed to load index.json');
  const tileMeta = (await tileMetaRes.json()) as TileMetaMap;
  const index = (await indexRes.json()) as {
    weapons: Record<string, string>;
    characters: Record<string, string>;
  };

  const loadCategory = async (
    cat: Record<string, string>,
  ): Promise<Record<string, AnimationManifest>> => {
    const out: Record<string, AnimationManifest> = {};
    await Promise.all(
      Object.entries(cat).map(async ([name, relPath]) => {
        const res = await fetch(`${BASE}/${relPath}`);
        if (!res.ok) throw new Error(`failed to load ${relPath}`);
        const raw = await res.json();
        out[name] = validateManifest(raw, tileMeta);
      }),
    );
    return out;
  };

  const [weapons, characters] = await Promise.all([
    loadCategory(index.weapons),
    loadCategory(index.characters),
  ]);
  return { tileMeta, weapons, characters };
}
