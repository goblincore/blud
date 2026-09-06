import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const driver = join(repo, 'scripts/zombie-normal-gradient-check.mjs');

test('verdict writes an offline incomplete summary and exits nonzero when prerequisites are missing', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'zombie-ng-verdict-'));
  const evidenceDir = join(fixture, 'docs/dev-notes/2026-09-05-zombie-analytic-normals');
  const outDir = join(fixture, 'out');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, 'gates.json'), `${JSON.stringify({
    version: 1,
    reference: 'pass',
    gpuKernel: 'pass',
    intact: 'deferred',
    wounds: 'pending',
    visualEvidence: 'pending',
    timing: 'pending',
    ownerLook: 'pending',
    evidence: [{ commit: 'prior', command: 'kernel', artifact: 'kernel.json', reason: 'passed' }],
  }, null, 2)}\n`);

  const result = spawnSync(process.execPath, [driver, '--phase', 'verdict', '--out', outDir, '--vite', '1', '--cdp', '1'], {
    cwd: fixture,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VERDICT INCOMPLETE/);
  assert.doesNotMatch(result.stderr, /fetch failed|ECONNREFUSED/);

  const summary = JSON.parse(readFileSync(join(outDir, 'summary.json'), 'utf8'));
  assert.deepEqual(Object.keys(summary), ['commit', 'gates', 'scenes', 'timings', 'coverage', 'woundEvidence', 'appearance', 'artifacts', 'conclusion']);
  assert.equal(summary.commit, execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim());
  assert.equal(summary.conclusion, 'incomplete');
  assert.equal(summary.gates.reference, 'pass');
  assert.equal(summary.gates.gpuKernel, 'pass');
  assert.equal(summary.gates.intact, 'deferred');
  assert.equal(summary.gates.wounds, 'skipped-by-gate');
  assert.equal(summary.gates.visualEvidence, 'skipped-by-gate');
  assert.equal(summary.gates.timing, 'skipped-by-gate');
  assert.equal(summary.gates.ownerLook, 'pending');
  assert.equal(summary.timings.measurements, null);
  assert.equal(summary.coverage.measurements, null);
  assert.deepEqual(summary.artifacts.images, []);
  assert.equal(summary.artifacts.reel, null);

  const gates = JSON.parse(readFileSync(join(evidenceDir, 'gates.json'), 'utf8'));
  assert.equal(gates.reference, 'pass');
  assert.equal(gates.gpuKernel, 'pass');
  assert.equal(gates.intact, 'deferred');
  assert.equal(gates.wounds, 'skipped-by-gate');
  assert.equal(gates.visualEvidence, 'skipped-by-gate');
  assert.equal(gates.timing, 'skipped-by-gate');
  assert.equal(gates.ownerLook, 'pending');
  assert.equal(gates.evidence.length, 2);
  assert.match(gates.evidence[1].reason, /zero real gameplay GPU samples/i);
});

test('offline verdict preserves partial real GPU evidence without claiming zero gameplay samples', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'zombie-ng-partial-'));
  const evidenceDir = join(fixture, 'docs/dev-notes/2026-09-05-zombie-analytic-normals');
  const outDir = join(fixture, 'out');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir,'gates.json'),JSON.stringify({version:1,reference:'pass',gpuKernel:'pass',intact:'deferred',wounds:'skipped-by-gate',visualEvidence:'skipped-by-gate',timing:'skipped-by-gate',ownerLook:'pending',evidence:[]}));
  writeFileSync(join(evidenceDir,'intact.json'),JSON.stringify({gpuExecuted:true,sceneComparisons:6,numericResults:[{name:'head',depthChanged:0,anatomy:{head:{analyticFraction:.83}}}],firstRunFailure:'mixed closeup coverage failed',correctedValidation:'blocked by load guard',diagnosticImages:['head-eligibility.png'],motionFrames:24,beautyValid:false}));
  const result=spawnSync(process.execPath,[driver,'--phase','verdict','--out',outDir,'--vite','1','--cdp','1'],{cwd:fixture,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.doesNotMatch(result.stderr,/zero real gameplay GPU samples|fetch failed|ECONNREFUSED/i);
  assert.match(result.stderr,/6 real gameplay/);
  const summary=JSON.parse(readFileSync(join(outDir,'summary.json'),'utf8'));
  assert.equal(summary.coverage.status,'partial');
  assert.equal(summary.coverage.measurements[0].name,'head');
  assert.equal(summary.scenes.find(s=>s.name==='intact-head-and-torso').status,'partial');
  assert.equal(summary.timings.measurements,null);
  assert.equal(summary.artifacts.reel,null);
  assert.equal(summary.conclusion,'incomplete');
});

test('offline verdict preserves historical failure and corrected valid images without stale unexecuted claims', () => {
  const fixture=mkdtempSync(join(tmpdir(),'zombie-ng-corrected-'));
  const evidenceDir=join(fixture,'docs/dev-notes/2026-09-05-zombie-analytic-normals'),outDir=join(fixture,'out');
  mkdirSync(evidenceDir,{recursive:true});
  writeFileSync(join(evidenceDir,'gates.json'),JSON.stringify({version:1,reference:'pass',gpuKernel:'pass',intact:'pass',wounds:'skipped-by-gate',evidence:[]}));
  const runs=[{artifact:'first.json',passed:false,beautyValid:false},{artifact:'corrected.json',passed:false,beautyValid:true}];
  writeFileSync(join(evidenceDir,'intact.json'),JSON.stringify({gpuExecuted:true,sceneComparisons:13,numericResults:[{name:'mixed-wounded'}],firstRunFailure:'mixed closeup coverage failed',correctedValidation:'7 corrected comparisons ran; mixed coverage failed',beautyValid:true,motionValid:true,motionFrames:24,motionArtifactDirectory:'owner-review',runs}));
  const result=spawnSync(process.execPath,[driver,'--phase','verdict','--out',outDir,'--cdp','1'],{cwd:fixture,encoding:'utf8'});
  assert.equal(result.status,1);
  const summary=JSON.parse(readFileSync(join(outDir,'summary.json'),'utf8'));
  assert.doesNotMatch(JSON.stringify(summary),/corrected validation has not run|corrected intact reel has not run|beauty was contaminated/);
  assert.deepEqual(summary.artifacts.runs,runs);
  assert.equal(summary.scenes.find(s=>s.name==='walking-and-flashlight-motion').status,'technical-visual-evidence');
  assert.equal(summary.artifacts.reel,'owner-review');
  assert.equal(summary.gates.ownerLook,'pending');
  assert.equal(summary.scenes.find(s=>s.name==='intact-head-and-torso').status,'pass');
  assert.doesNotMatch(JSON.stringify(summary),/intact validation is deferred/);
});

test('offline verdict reports partial wound evidence without claiming full acceptance or timing', () => {
  const fixture=mkdtempSync(join(tmpdir(),'zombie-ng-wound-verdict-'));
  const evidenceDir=join(fixture,'docs/dev-notes/2026-09-05-zombie-analytic-normals'),outDir=join(fixture,'out');
  mkdirSync(evidenceDir,{recursive:true});
  writeFileSync(join(evidenceDir,'gates.json'),JSON.stringify({version:1,reference:'pass',gpuKernel:'pass',intact:'pass',wounds:'deferred',visualEvidence:'skipped-by-gate',timing:'skipped-by-gate',ownerLook:'pending',evidence:[]}));
  writeFileSync(join(evidenceDir,'intact.json'),JSON.stringify({gpuExecuted:true,sceneComparisons:20,numericResults:[{name:'head',depthChanged:0}],beautyValid:true,motionValid:true,motionFrames:24,ownerLookScope:{intact:'pass',fullCandidate:'pending'},runs:[{artifact:'intact-failed.json',passed:false}]}));
  writeFileSync(join(evidenceDir,'wounds.json'),JSON.stringify({
    status:'deferred',gpuExecuted:true,timing:'not measured; Task5 gated',
    reason:'Detached chunk proof and final harness validation remain pending.',
    woundNumerics:Array.from({length:11},(_,index)=>({name:`case-${index}`})),
    sceneComparisons:[
      {name:'torso-after-impact',pieceKey:'body:1',depthChanged:0,fallbackMax:0,angularDegrees:{p99:2.6408748541301628,max:40.37185923534368},woundROI:{wall:{hits:2627,analytic:2074},rim:{hits:11993,analytic:11015}},maxAngleReview:'localized proof reviewed'},
      {name:'detached-chunk-1',pieceKey:'chunk:1',depthChanged:0,fallbackMax:0,total:1283,reasons:{ok:1183},angularDegrees:{p99:5.846497950334507,max:8.913515243743647}},
    ],
    firstReadControl:{legacyToLegacy:{changedFloats:14670,depthChanged:3666,depthMax:.08432507514953613},settledLegacyToHybrid:{depthChanged:0,fallbackMax:0,p99:1.6930036341187737,max:7.610726023748462}},
    events:{'elbow-controlled':[{name:'elbow-slug-sever',source:'actual fireSlug projectile/impact/impulse',before:{wounds:0,pieces:['body:1']},after:{wounds:[{},{}],pieces:['body:1','chunk:1']}}]},
    motion:{'final-events':[{name:'impact-stagger-moving-light',frames:24,source:'every subsequent simulation frame captured in both modes'}]},
    remaining:['Run detached-piece worst-point proof.','Validate final bounded settling and initial impact hooks on real WebGPU.'],
    historicalRuns:[{path:'/tmp/failed/wounds.json',sha256:'abc',archive:'docs/dev-notes/2026-09-05-zombie-analytic-normals/wound-raw/failed.json.gz',note:'failed history'}],
  }));
  const result=spawnSync(process.execPath,[driver,'--phase','verdict','--out',outDir,'--vite','1','--cdp','1'],{cwd:fixture,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.doesNotMatch(result.stderr,/fetch failed|ECONNREFUSED/i);
  const summary=JSON.parse(readFileSync(join(outDir,'summary.json'),'utf8'));
  assert.equal(summary.conclusion,'incomplete');
  assert.equal(summary.gates.intact,'pass');
  assert.equal(summary.gates.wounds,'deferred');
  assert.equal(summary.gates.visualEvidence,'skipped-by-gate');
  assert.equal(summary.gates.timing,'skipped-by-gate');
  assert.equal(summary.gates.ownerLook,'pending');
  assert.equal(summary.coverage.status,'incomplete-wounds-deferred');
  assert.equal(summary.coverage.scope.intactValidation,'complete');
  assert.equal(summary.coverage.scope.fullWoundGameplayValidation,'deferred');
  assert.equal(summary.coverage.wounds[0].woundROI.wall.analytic,2074);
  assert.equal(summary.coverage.wounds[1].pieceKey,'chunk:1');
  assert.equal(summary.scenes.find(scene=>scene.name==='wounded-head-and-torso').status,'partial-evidence-validation-deferred');
  assert.equal(summary.scenes.find(scene=>scene.name==='impact-stagger-sever-sequence').status,'partial-evidence-validation-deferred');
  assert.equal(summary.timings.measurements,null);
  assert.equal(summary.artifacts.wounds,'docs/dev-notes/2026-09-05-zombie-analytic-normals/wounds.json');
  assert.equal(summary.woundEvidence.oracleCases,11);
  assert.equal(summary.woundEvidence.unresolved[0],'Run detached-piece worst-point proof.');
  assert.equal(summary.woundEvidence.firstReadControl.legacyToLegacy.depthChanged,3666);
  assert.equal(summary.appearance.intactOwnerReview,'pass');
  assert.equal(summary.appearance.fullOwnerLook,'pending');
  assert.match(summary.appearance.woundMotionScope,/subsequent simulation frame/i);
  assert.doesNotMatch(JSON.stringify(summary),/speedup|performance pass|full acceptance/i);
});

test('positive verdict checkpoint preserves approved correctness/look and never opens a browser', () => {
  const fixture=mkdtempSync(join(tmpdir(),'zombie-ng-positive-verdict-'));
  const evidenceDir=join(fixture,'docs/dev-notes/2026-09-05-zombie-analytic-normals'),outDir=join(fixture,'out');
  mkdirSync(evidenceDir,{recursive:true});
  writeFileSync(join(evidenceDir,'gates.json'),JSON.stringify({version:1,reference:'pass',gpuKernel:'pass',intact:'pass',wounds:'pass',visualEvidence:'pass',timing:'pending',ownerLook:'pass',evidence:[]}));
  try {
    const result=spawnSync(process.execPath,[driver,'--phase','verdict','--defer-timing','--out',outDir,'--vite','1','--cdp','1'],{cwd:fixture,encoding:'utf8',timeout:5000});
    assert.equal(result.status,1,result.stderr);
    const summary=JSON.parse(readFileSync(join(outDir,'summary.json'),'utf8'));
    assert.equal(summary.conclusion,'incomplete');assert.equal(summary.gates.ownerLook,'pass');assert.equal(summary.gates.wounds,'pass');
    assert.equal(summary.gates.timing,'deferred');assert.equal(summary.timings.browserOpened,false);
    assert.equal(summary.scenes.length,8);assert.ok(summary.scenes.every(s=>s.status==='unmeasured'));
    assert.equal(summary.timings.protocol.shippingShaderOverhead,'unmeasured; no direct current-main control');
    assert.match(summary.provenance.baseCommit,/^[a-f0-9]{40}$/);
    assert.ok(['clean','dirty'].includes(summary.provenance.workingTree));
    assert.match(summary.provenance.sourceSha256['scripts/lib/normal-gradient-performance.mjs'],/^[a-f0-9]{64}$/);
    assert.equal(summary.commit,summary.provenance.workingTree==='dirty'?`dirty working tree based on ${summary.provenance.baseCommit}`:summary.provenance.baseCommit);
    const repeated=spawnSync(process.execPath,[driver,'--phase','verdict','--defer-timing','--out',outDir,'--vite','1','--cdp','1'],{cwd:fixture,encoding:'utf8',timeout:5000});
    assert.equal(repeated.status,1,repeated.stderr);
    const repeatedSummary=JSON.parse(readFileSync(join(outDir,'summary.json'),'utf8'));
    assert.equal(repeatedSummary.gates.evidence.length,summary.gates.evidence.length);

  } finally {rmSync(fixture,{recursive:true,force:true});}
});
