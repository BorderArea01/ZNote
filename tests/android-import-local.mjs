// Isolated emulator only. Never installs on a USB, Wi-Fi, or pre-existing device.
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,mkdtemp,writeFile,rm,access} from 'node:fs/promises';import {resolve,join,relative,isAbsolute} from 'node:path';import assert from 'node:assert/strict';
const routes=process.argv.includes('--routes'),overlay=process.argv.includes('--overlay'),exec=promisify(execFile),sdk=process.env.ANDROID_HOME,dir=await mkdtemp(resolve(routes?'artifacts/android-route-local-':overlay?'artifacts/android-overlay-local-':'artifacts/android-import-local-')),serial='emulator-5584';assert.ok(sdk);console.log('Emulator evidence '+dir);
await mkdir(dir,{recursive:true});const adb=join(sdk,'platform-tools/adb.exe'),environment={...process.env,ANDROID_AVD_HOME:join(dir,'avd'),JAVA_OPTS:'-Xmx128m'};await mkdir(environment.ANDROID_AVD_HOME,{recursive:true});
const run=async(command,args,options={})=>(await exec(command,args,{windowsHide:true,env:environment,timeout:60000,maxBuffer:2e6,...options})).stdout;
const devices=await run(adb,['devices']);assert.ok(!devices.includes(serial),'Test port is already in use');
const avd='znote-import-isolated';
const create="& '"+join(sdk,'cmdline-tools/latest/bin/avdmanager.bat').replaceAll("'","''")+"' create avd -n "+avd+" -k 'system-images;android-30;google_apis;x86_64' --device pixel_2 --path '"+join(dir,'device').replaceAll("'","''")+"'";
// avdmanager prompts only about custom hardware for this known stock profile.
await new Promise((done,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',create],{windowsHide:true,env:environment});let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);child.stdin.end('no\n');child.on('error',reject);child.on('exit',code=>code===0?done():reject(Error(output)));});
let emulator,fixture;
try{
 emulator=spawn(join(sdk,'emulator/emulator.exe'),['-avd',avd,'-port','5584','-no-window','-no-audio','-no-boot-anim','-no-snapshot','-gpu','swiftshader_indirect','-memory','1024','-cores','1'],{windowsHide:true,env:environment});
 let emuLog='';emulator.stdout.on('data',v=>emuLog+=v);emulator.stderr.on('data',v=>emuLog+=v);emulator.on('exit',code=>console.log('Owned emulator exited '+code));
 const deadline=Date.now()+210000;let booted=false;while(Date.now()<deadline){if(emulator.exitCode!==null)throw Error('Emulator exited: '+emuLog.slice(-3000));try{if((await run(adb,['-s',serial,'shell','getprop','sys.boot_completed'],{timeout:5000})).trim()==='1'){booted=true;break;}}catch{}await new Promise(r=>setTimeout(r,2000));}
 await writeFile(join(dir,'emulator.log'),emuLog);assert.ok(booted,'Emulator did not boot');
 await run(adb,['-s',serial,'shell','input','keyevent','82']);
 const signedRoutes=routes&&await access('artifacts/android-beta23-release/ZNote-0.10.0-beta.23-android.apk').then(()=>true,()=>false);
 if(overlay||signedRoutes){
  await run(adb,['-s',serial,'install',signedRoutes?'artifacts/android-beta22-release/ZNote-0.10.0-beta.22-android.apk':'artifacts/android-beta21-release/ZNote-0.10.0-beta.21-android.apk']);
  await run(adb,['-s',serial,'shell','appops','set','io.github.borderarea01.znote','REQUEST_INSTALL_PACKAGES','allow']);
  await run(adb,['-s',serial,'install','-r',signedRoutes?'artifacts/android-beta23-release/ZNote-0.10.0-beta.23-android.apk':'artifacts/android-beta22-release/ZNote-0.10.0-beta.22-android.apk']);
  const installed=await run(adb,['-s',serial,'shell','dumpsys','package','io.github.borderarea01.znote']);assert.match(installed,signedRoutes?/versionCode=10023/:/versionCode=10022/);const permission=await run(adb,['-s',serial,'shell','appops','get','io.github.borderarea01.znote','REQUEST_INSTALL_PACKAGES']);assert.match(permission,/allow/);await writeFile(join(dir,'release-upgrade.txt'),signedRoutes?'beta.22 → beta.23 installed in place; original signing identity, versionCode 10023 and installer app-op retained.':'beta.21 → beta.22 installed in place; versionCode 10022 and existing installer app-op retained.');
  await run(adb,['-s',serial,'uninstall','io.github.borderarea01.znote']);
 }
 await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/debug/app-debug.apk']);
 await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']);
 fixture=spawn(process.execPath,['--max-old-space-size=128',routes?'tests/android-route-fixture.mjs':overlay?'tests/android-overlay-fixture.mjs':'tests/android-connection-import-fixture.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let fixtureLog='';fixture.stdout.on('data',v=>fixtureLog+=v);fixture.stderr.on('data',v=>fixtureLog+=v);
 await new Promise(r=>setTimeout(r,500));
 const result=await run(adb,['-s',serial,'shell','am','instrument','-w','-e',routes?'connection_routes':overlay?'overlay_design':'connection_import','true','io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner'],{timeout:150000});
 await writeFile(join(dir,'result.txt'),result);await writeFile(join(dir,'fixture.log'),fixtureLog);
 const logs=await run(adb,['-s',serial,'logcat','-d','-v','threadtime','-s','AndroidRuntime:E']);await writeFile(join(dir,'android-runtime.log'),logs);
 if(routes)await writeFile(join(dir,'webview-console.log'),await run(adb,['-s',serial,'logcat','-d','-v','threadtime','-s','chromium:I','cr_WebView:I','ZNoteWeb:E']));
 if(overlay){
  const names=await run(adb,['-s',serial,'shell','run-as','io.github.borderarea01.znote','ls','files']);
  for(const name of names.trim().split(/\s+/).filter(n=>/^overlay-[\w-]+\.png$/.test(n))){const png=await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/'+name],{encoding:'buffer'});await writeFile(join(dir,name),png);}
  assert.ok(result.includes('ZNOTE_OVERLAY_SMOKE_PASS'),result);console.log('ZNOTE_OVERLAY_SMOKE_PASS; evidence '+dir);
 }
 if(routes){
 assert.ok(result.includes('ZNOTE_ANDROID_ROUTE_PASS'),result);
 const stats=await(await fetch('http://127.0.0.1:3842/test/control?mode=stats')).json();await writeFile(join(dir,'routing-stats.json'),JSON.stringify(stats,null,2));assert.equal(stats.credentialLeaks,0);assert.equal(stats.localSubmissions,1);assert.equal(stats.remoteSubmissions,1);assert.equal(stats.items,1);
 assert.ok(result.includes('ZNOTE_ANDROID_ROUTE_PASS'),result);const png=await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/route-smoke.png'],{encoding:'buffer'});await writeFile(join(dir,'route-smoke.png'),png);console.log('ZNOTE_ANDROID_ROUTE_PASS; evidence '+dir);
 }
 if(!overlay&&!routes){
 if(result.includes('ZNOTE_CONNECTION_IMPORT_PASS')){const png=await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/connection-import.png'],{encoding:'buffer'});assert.ok(png.length>1000);await writeFile(join(dir,'connection-import.png'),png);}
 await run(adb,['-s',serial,'pull','/sdcard/Android/data/io.github.borderarea01.znote/files/client-smoke.png',join(dir,'failure.png')]).catch(()=>{});
 assert.ok(result.includes('ZNOTE_CONNECTION_IMPORT_PASS'),result);console.log('ZNOTE_CONNECTION_IMPORT_PASS; evidence '+dir);
 }
}finally{
 fixture?.kill();if(emulator){await run(adb,['-s',serial,'emu','kill'],{timeout:5000}).catch(()=>{});await new Promise(r=>setTimeout(r,1000));if(emulator.exitCode===null)emulator.kill();}
 if(routes){
   const root=resolve('artifacts'),target=resolve(dir,'device'),rel=relative(root,target);
   assert.ok(rel.startsWith('android-route-local-')&&!rel.startsWith('..')&&!isAbsolute(rel)&&target.endsWith('device'),'Unsafe emulator cleanup');
   await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:300}).catch(e=>console.log('Test device cleanup pending: '+e.code));
 }
}
