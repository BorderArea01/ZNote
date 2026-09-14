import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const moduleUrl = new URL('../server/runtime-diagnostics.js',import.meta.url).href;
const createDir = () => mkdtemp(join(tmpdir(),'znote-diagnostics-'));
const secret = 'TEST_ONLY_ENV_VALUE_MUST_NOT_APPEAR_IN_REPORT';
function launch(dir, code, extraArgs = []) {
  const source = `import {installRuntimeDiagnostics} from ${JSON.stringify(moduleUrl)};
    const d=installRuntimeDiagnostics(${JSON.stringify(dir)},{port:3749,heartbeatMs:20});
    d.begin(); ${code}`;
  const child = spawn(process.execPath,[...extraArgs,'--input-type=module','--eval',source],{
    windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,ZNOTE_DIAGNOSTIC_TEST_SECRET:secret},
  });
  child.stdout.resume(); child.stderr.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'),15000);
  child.done = once(child,'close').then(([code,signal]) => {clearTimeout(timer);return {code,signal};});
  return child;
}
const state = async dir => JSON.parse(await readFile(join(dir,'logs/run-state.json'),'utf8'));
const events = async dir => (await readFile(join(dir,'logs/lifecycle.log'),'utf8')).trim().split('\n').map(JSON.parse);
async function reports(dir) {
  const root = join(dir,'logs/reports');
  return Promise.all((await readdir(root)).map(async name => {
    const text=await readFile(join(root,name),'utf8');
    assert.ok(!text.includes(secret),'Environment secret leaked');
    const report=JSON.parse(text);assert.equal(report.environmentVariables,undefined);return report;
  }));
}

test('runtime diagnostics retain normal output, heartbeat and exit status',async()=>{
  const dir=await createDir();
  assert.equal((await launch(dir,"console.log('normal output');console.error('handled error');setTimeout(()=>process.exit(7),80)").done).code,7);
  const current=await state(dir);assert.equal(current.phase,'exited');assert.equal(current.exitCode,7);assert.ok(current.memory.rss>0);
  assert.match(await readFile(join(dir,'logs/server.stdout.log'),'utf8'),/normal output/);
  assert.match(await readFile(join(dir,'logs/server.stderr.log'),'utf8'),/handled error/);
  assert.equal((await events(dir)).at(-1).code,7);
});

test('uncaught errors and rejected promises still fail and produce reports without environment variables',async()=>{
  for(const code of ["throw new Error('diagnostic crash marker')","Promise.reject(new Error('diagnostic crash marker'))"]){
    const dir=await createDir();assert.notEqual((await launch(dir,code).done).code,0);
    const crash=(await events(dir)).find(e=>e.event==='uncaught_exception');assert.match(crash.stack,/diagnostic crash marker/);
    assert.equal((await state(dir)).exitCode,1);assert.equal((await reports(dir)).length,1);
  }
});

test('a forced stop is identified on the next launch without inventing a cause',async()=>{
  const dir=await createDir(),child=launch(dir,'setInterval(()=>{},1000)');
  for(let i=0;i<200;i++){try{if((await state(dir)).memory)break}catch{}await new Promise(r=>setTimeout(r,20));}
  const before=await state(dir);assert.equal(before.phase,'running');child.kill('SIGKILL');await child.done;
  assert.equal((await launch(dir,'process.exit(0)').done).code,0);
  const event=(await events(dir)).find(e=>e.event==='previous_run_missing_exit');assert.equal(event.previous.pid,child.pid);assert.ok(event.previous.lastSeenAt);assert.ok(event.previous.memory.rss>0);
});

test('native heap exhaustion writes a fatal diagnostic report',async()=>{
  const dir=await createDir();const child=launch(dir,'const held=[];for(;;)held.push(new Array(100000).fill(Math.random()));',['--max-old-space-size=32']);
  assert.notEqual((await child.done).code,0);
  const generated=await reports(dir);assert.equal(generated.length,1);assert.match(generated[0].header.event,/heap|allocation|memory/i);
});
