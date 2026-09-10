import { readFileSync } from 'node:fs';
import { parseBlob } from '../../src/lab/sdf-zombie/blob-parse';
import { compileBlob, compileFace } from '../../src/lab/sdf-zombie/blob-compile';
import { buildBody } from '../../src/lab/sdf-zombie/build-body';

const src = readFileSync('src/lab/sdf-zombie/characters/cyberbride.blob', 'utf8');
const doc = parseBlob(src);
const b = buildBody(compileBlob(doc, compileFace(doc)));
console.log('ERRORS:', b.errors.length);
for (const e of b.errors) console.log('  -', e);
console.log('doc keys:', Object.keys(doc).join(','));
console.log('doc.body type:', typeof (doc as any).body, (doc as any).body && Object.keys((doc as any).body));
