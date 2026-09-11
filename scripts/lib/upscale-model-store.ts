/**
 * DEV-ONLY store of trained neural upscale models, served by the vite dev middleware
 * (docs/superpowers/plans/2026-09-11-neural-upscale-p3-contracts.md §4). Never part of a build.
 * Layout: <root>/<name>/model.json, root = $UPSCALE_MODELS_DIR or <repo>/.upscale-models.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** No path separators, no leading dot: a name can never leave the store. */
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface ModelSummary {
  name: string;
  id: string | null;
  inputs: string | null;
  source: string | null;
  run: string | null;
  step: number | null;
  weightHash: string | null;
  /** metrics.overall from the export, when present. */
  overall: number | null;
  error?: string;
}

export function modelStoreRoot(repoRoot: string, env: Record<string, string | undefined> = process.env): string {
  return env.UPSCALE_MODELS_DIR ? resolve(env.UPSCALE_MODELS_DIR) : join(repoRoot, '.upscale-models');
}

/** The raw model.json text, or null for an invalid name or a missing model. */
export function readModelText(root: string, name: string): string | null {
  if (!MODEL_NAME_RE.test(name)) return null;
  const file = join(root, name, 'model.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Summaries sorted by name. The weights are NOT validated here; the game's parser does that. */
export function listModels(root: string): ModelSummary[] {
  if (!existsSync(root)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && MODEL_NAME_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .flatMap((name): ModelSummary[] => {
      const text = readModelText(root, name);
      if (text === null) return [];
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const metrics = (j.metrics ?? {}) as Record<string, unknown>;
        return [{
          name, id: str(j.id), inputs: str(j.inputs), source: str(j.source), run: str(j.run),
          step: num(j.step), weightHash: str(j.weightHash), overall: num(metrics.overall),
        }];
      } catch (e) {
        return [{
          name, id: null, inputs: null, source: null, run: null, step: null, weightHash: null, overall: null,
          error: `bad JSON: ${String(e)}`,
        }];
      }
    });
}
