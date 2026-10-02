#!/bin/bash
# usage: pose.sh "<overrides>"  -> prints key joint ends (game frame: y up, +z forward)
D=docs/dev-notes/2026-10-01-flat-emergence-lookdev; S=$(dirname "$0"); G=src/lab/sdf-zombie/characters/goblin.blob
npx tsx $D/blob-bones.ts $G $S/b.json $1 >/dev/null
python3 - "$S/b.json" <<'PY'
import json,sys
j=json.load(open(sys.argv[1]))['posed']; h,d,L=j['heads'],j['dirs'],j['lengths']
def end(k): b=k.split('.')[0]; return [round(h[k][i]+d[k][i]*L[b],3) for i in range(3)]
print('hand', end('hand.l'), 'elbow', [round(x,3) for x in h['forearm.l']], 'shoulder', [round(x,3) for x in h['upperarm.l']], 'skull', end('skull'), 'knee', [round(x,3) for x in h['shin.l']], 'ankle', end('shin.l'))
PY
