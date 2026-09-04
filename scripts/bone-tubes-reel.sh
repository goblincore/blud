#!/usr/bin/env bash
# scripts/bone-tubes-reel.sh — the owner's three A/B captures (spec §8): field bones
# (off) vs tube bones (on) on the same frozen game scene, via perf-r2-parity.mjs.
# Usage: scripts/bone-tubes-reel.sh <outDir>
set -euo pipefail
OUT=${1:?outDir}
export LAB_VITE_PORT=${LAB_VITE_PORT:-5299} LAB_CDP_PORT=${LAB_CDP_PORT:-9299}
ON="__sdfGame.setBoneMesh(true)"; OFF="__sdfGame.setBoneMesh(false)"
# 1. torso crater: ribs + sternum
scripts/perf-r2-parity.sh capture "$OUT/1-torso" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimSurface(); __sdfGame.fireSlug()"
# 2. head shot: cranium + jaw  (aimHead is a seam to add if aimSurface cannot target the head: aim at the head cluster centre)
scripts/perf-r2-parity.sh capture "$OUT/2-head" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimHead(); __sdfGame.fireSlug()"
# 3. severed arm chunk on the floor
scripts/perf-r2-parity.sh capture "$OUT/3-chunk" --room 3 --on "$ON" --off "$OFF" \
  --pre "__sdfGame.aimSurface('armL'); __sdfGame.fireSlug(); __sdfGame.fireSlug(); await new Promise(r=>setTimeout(r, 1500))"
echo "reel in $OUT — a-*.png = tubes, b-*.png = field; the owner's eye is the gate; ANY bone through intact skin fails"
