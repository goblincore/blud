#!/usr/bin/env bash
# Wrapper that gives scripts/blob-render-check.ts the servers it needs.
#   npm run blob:render-check -- mouse
#   BLOB_DIST=1.2 npm run blob:render-check -- mouse
#   LAB_VITE_PORT=5244 LAB_CDP_PORT=9244 npm run blob:render-check -- goblin
#
# WHY THIS EXISTS RATHER THAN "start the servers yourself first": the check is
# the thing an agent reaches for when the renderer is suspect, which is exactly
# the moment it should not also have to get a dev server and a WebGPU-enabled
# headless Chrome up by hand. Same lifecycle as blob-shot.sh — reuses servers
# that are already listening, stops only the ones it started.
#
# THE EXIT CODE IS THE POINT and is propagated verbatim: 0 the renderer agrees
# with the field, 1 it shows a hole the field does not have, 2 the check could
# not run. Do not let the trap swallow it.
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lab-servers.sh
. scripts/lab-servers.sh
trap lab_servers_down EXIT
lab_servers_up

# `set -e` would abort here on the meaningful non-zero exits (1 and 2) before
# we could report them, so the failure is captured rather than inherited.
rc=0
node_modules/.bin/tsx scripts/blob-render-check.ts "$@" || rc=$?
exit "$rc"
