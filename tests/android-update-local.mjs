// Guarded opt-in native/network acceptance. Never attaches to an existing device.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const sdk=process.env.ANDROID_HOME;assert.ok(sdk,'Set ANDROID_HOME');
const dir=await mkdtemp(resolve('artifacts/android-update-local-')),adb=join(sdk,'platform-tools/adb.exe'),serial='emulator-5582',avd='znote-update-isolated';
const env={...process.env,ANDROID_AVD_HOME:join(dir,'avd'),JAVA_OPTS:'-Xmx128m'};await mkdir(env.ANDROID_AVD_HOME,{recursive:true});
const exec=promisify(execFile),run=async(c,a,o={})=>(await exec(c,a,{windowsHide:true,env,timeout:60000,maxBuffer:3e6,...o})).stdout;
assert.ok(!(await run(adb,['devices'])).includes(serial),'Test port already in use');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"'no' | & "+quote(join(sdk,'cmdline-tools/latest/bin/avdmanager.bat'))+' create avd -n '+avd+" -k 'system-images;android-30;google_apis;x86_64' --device pixel_2 --path "+quote(join(dir,'device'))]);
let emulator,fixture,log='',fixtureLog='';console.log('Update evidence '+dir);
try{
 emulator=spawn(join(sdk,'emulator/emulator.exe'),['-avd',avd,'-port','5582','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu','swiftshader_indirect','-memory','1024','-cores','1'],{windowsHide:true,env});emulator.stdout.on('data',b=>log+=b);emulator.stderr.on('data',b=>log+=b);
 let booted=false;for(let i=0;i<110;i++){if(emulator.exitCode!==null)throw Error(log.slice(-2000));try{if((await run(adb,['-s',serial,'shell','getprop','sys.boot_completed'],{timeout:5000})).trim()==='1'){booted=true;break;}}catch{}await new Promise(r=>setTimeout(r,1500));}assert.ok(booted,'Emulator boot failed');
 await run(adb,['-s',serial,'shell','input','keyevent','82']);
 const gradle=await readFile('clients/android/app/build.gradle','utf8'),version=/versionName '([^']+)'/.exec(gradle)[1],code=Number(/versionCode (\d+)/.exec(gradle)[1]),beta=Number(/beta\.(\d+)$/.exec(version)[1]);
 await run(adb,['-s',serial,'install',`artifacts/android-beta${beta-1}-release/ZNote-0.10.0-beta.${beta-1}-android.apk`]);
 await run(adb,['-s',serial,'shell','appops','set','io.github.borderarea01.znote','REQUEST_INSTALL_PACKAGES','allow']);
 await run(adb,['-s',serial,'install','-r',`artifacts/android-beta${beta}-release/ZNote-${version}-android.apk`]);
 assert.ok((await run(adb,['-s',serial,'shell','dumpsys','package','io.github.borderarea01.znote'])).includes('versionCode='+code));assert.match(await run(adb,['-s',serial,'shell','appops','get','io.github.borderarea01.znote','REQUEST_INSTALL_PACKAGES']),/allow/);
 await writeFile(join(dir,'original-signature-upgrade.txt'),`Original signed ${code-1} -> ${code}; REQUEST_INSTALL_PACKAGES retained.`);
 await run(adb,['-s',serial,'uninstall','io.github.borderarea01.znote']);
 await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/debug/app-debug.apk']);await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']);
 fixture=spawn(process.execPath,['--max-old-space-size=96','tests/android-update-route-fixture.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});fixture.stdout.on('data',b=>fixtureLog+=b);fixture.stderr.on('data',b=>fixtureLog+=b);await new Promise(r=>setTimeout(r,300));assert.equal(fixture.exitCode,null);
 const flags=['-e','update_routes','true'];if(process.argv.includes('--public'))flags.push('-e','public_updates','true');
 const result=await run(adb,['-s',serial,'shell','am','instrument','-w',...flags,'io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner'],{timeout:180000});await writeFile(join(dir,'result.txt'),result);console.log(result);
 if(process.argv.includes('--public'))await writeFile(join(dir,'update-routes.png'),await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/update-routes.png'],{encoding:'buffer'}));
 assert.match(result,/ZNOTE_UPDATE_ROUTES_PASS/);console.log('ZNOTE_UPDATE_ROUTES_PASS '+dir);
 if(process.argv.includes('--copy')){
  fixture.kill();await new Promise(r=>setTimeout(r,400));
  await run(adb,['-s',serial,'shell','settings','put','global','http_proxy',':0']);
  for(const flavor of await readdir('clients/android/capturefixture/build/outputs/apk')){const folder=join('clients/android/capturefixture/build/outputs/apk',flavor,'debug');for(const file of await readdir(folder))if(file.endsWith('.apk'))await run(adb,['-s',serial,'install',join(folder,file)]);}
  fixture=spawn(process.execPath,['--max-old-space-size=128','tests/android-overlay-fixture.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});fixture.stdout.on('data',b=>fixtureLog+=b);fixture.stderr.on('data',b=>fixtureLog+=b);await new Promise(r=>setTimeout(r,400));
  const copied=await run(adb,['-s',serial,'shell','am','instrument','-w','-e','copy_prompt','true','io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner'],{timeout:160000});await writeFile(join(dir,'copy-result.txt'),copied);console.log(copied);
  for(const file of (await run(adb,['-s',serial,'shell','run-as','io.github.borderarea01.znote','ls','files'])).trim().split(/\s+/).filter(n=>/^copy-[\w-]+\.png$/.test(n)))await writeFile(join(dir,file),await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/'+file],{encoding:'buffer'}));
  assert.match(copied,/ZNOTE_COPY_PROMPT_PASS/);
 }
}finally{
 fixture?.kill();await writeFile(join(dir,'emulator.log'),log);await writeFile(join(dir,'fixture.log'),fixtureLog);
 if(emulator){await writeFile(join(dir,'runtime.log'),await run(adb,['-s',serial,'logcat','-d','-v','threadtime','-s','ZNoteCapture:I','AndroidRuntime:E']).catch(()=>''));await writeFile(join(dir,'capture-diagnostics.log'),await run(adb,['-s',serial,'shell','run-as','io.github.borderarea01.znote','cat','files/capture-diagnostics.log']).catch(()=>''));await run(adb,['-s',serial,'emu','kill'],{timeout:5000}).catch(()=>{});await new Promise(r=>setTimeout(r,500));if(emulator.exitCode===null)emulator.kill();}
}
