// Isolated emulator only. Never installs on a USB, Wi-Fi, or pre-existing device.
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
const exec=promisify(execFile),sdk=process.env.ANDROID_HOME,dir=await mkdtemp(resolve('artifacts/android-import-local-')),serial='emulator-5584';assert.ok(sdk);console.log('Emulator evidence '+dir);
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
 await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/debug/app-debug.apk']);
 await run(adb,['-s',serial,'install','clients/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']);
 fixture=spawn(process.execPath,['--max-old-space-size=128','tests/android-connection-import-fixture.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let fixtureLog='';fixture.stdout.on('data',v=>fixtureLog+=v);fixture.stderr.on('data',v=>fixtureLog+=v);
 await new Promise(r=>setTimeout(r,500));
 const result=await run(adb,['-s',serial,'shell','am','instrument','-w','-e','connection_import','true','io.github.borderarea01.znote.test/io.github.borderarea01.znote.SmokeRunner'],{timeout:120000});
 await writeFile(join(dir,'result.txt'),result);await writeFile(join(dir,'fixture.log'),fixtureLog);
 const logs=await run(adb,['-s',serial,'logcat','-d','-v','threadtime','-s','AndroidRuntime:E']);await writeFile(join(dir,'android-runtime.log'),logs);
 if(result.includes('ZNOTE_CONNECTION_IMPORT_PASS')){const png=await run(adb,['-s',serial,'exec-out','run-as','io.github.borderarea01.znote','cat','files/connection-import.png'],{encoding:'buffer'});assert.ok(png.length>1000);await writeFile(join(dir,'connection-import.png'),png);}
 await run(adb,['-s',serial,'pull','/sdcard/Android/data/io.github.borderarea01.znote/files/client-smoke.png',join(dir,'failure.png')]).catch(()=>{});
 assert.ok(result.includes('ZNOTE_CONNECTION_IMPORT_PASS'),result);console.log('ZNOTE_CONNECTION_IMPORT_PASS; evidence '+dir);
}finally{
 fixture?.kill();if(emulator){await run(adb,['-s',serial,'emu','kill'],{timeout:5000}).catch(()=>{});await new Promise(r=>setTimeout(r,1000));if(emulator.exitCode===null)emulator.kill();}
}
