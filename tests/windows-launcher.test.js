import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

test('Windows background launcher has no visible console, preserves exit codes and owns its child lifetime', {skip:process.platform!=='win32',timeout:40000}, async()=>{
  await mkdir(resolve('artifacts'),{recursive:true});
  const dir=await mkdtemp(resolve('artifacts/windows-background-')),data=join(dir,'资料 空格'),source=join(dir,'scripts');await mkdir(data);await mkdir(source);
  const probe=join(dir,'probe.ps1');
  await writeFile(probe,`param([int]$TargetPid,[string]$OutputPath)
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class ConsoleProbe{[DllImport("kernel32.dll",SetLastError=true)]public static extern bool AttachConsole(uint id);[DllImport("kernel32.dll")]public static extern bool FreeConsole();[DllImport("kernel32.dll")]public static extern IntPtr GetConsoleWindow();[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("kernel32.dll")]public static extern uint GetConsoleProcessList(uint[] ids,uint size);}'
    [ConsoleProbe]::FreeConsole() | Out-Null
    $attached=[ConsoleProbe]::AttachConsole($TargetPid)
    $errorCode=[Runtime.InteropServices.Marshal]::GetLastWin32Error()
    $visible=$false;$ids=New-Object uint[] 32;$count=0
    if($attached){$visible=[ConsoleProbe]::IsWindowVisible([ConsoleProbe]::GetConsoleWindow());$count=[ConsoleProbe]::GetConsoleProcessList($ids,32);[ConsoleProbe]::FreeConsole()|Out-Null}
    [IO.File]::WriteAllText($OutputPath, (@{attached=$attached;visible=$visible;processes=@($ids|Select-Object -First $count)}|ConvertTo-Json -Compress))`);
  const script=join(source,'fixture.mjs'),result=join(data,'child.json');
  await writeFile(script,`import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({pid:process.pid,data:process.argv[2]}));
    if(fs.readFileSync(${JSON.stringify(join(data,'mode'))},'utf8')==='exit')process.exit(7);else setInterval(()=>{},1000);`);
  const host=join(dir,'host.ps1');
  await writeFile(host,`param([string]$NodePath,[string]$Runner,[string]$DataDirectory)
    Add-Type -Path '${resolve('scripts/WindowsServerLauncher.cs').replaceAll("'","''")}'
    exit ([WindowsServerLauncher]::Run(@($NodePath,$Runner,$DataDirectory,'3759')))`);
  const start=()=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',host,'-NodePath',process.execPath,'-Runner',script,'-DataDirectory',data],{windowsHide:true,stdio:'ignore'});p.done=once(p,'exit');return p;};
  await writeFile(join(data,'mode'),'exit');const first=start();assert.equal((await first.done)[0],7);
  assert.match(await readFile(join(data,'logs/launcher.log'),'utf8'),/child_exit.*code=7 hex=0x00000007/);
  const firstChild=JSON.parse(await readFile(result,'utf8')).pid;
  await writeFile(join(data,'mode'),'wait');const second=start();
  let child;
  try{
    for(let i=0;i<150;i++){try{child=JSON.parse(await readFile(result,'utf8'));if(child.pid!==firstChild){process.kill(child.pid,0);break}}catch{}await new Promise(r=>setTimeout(r,50));}
    assert.notEqual(child.pid,firstChild,'Second launcher did not start a new child');
    process.kill(child.pid,0);
    const probed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',probe,'-TargetPid',String(child.pid),'-OutputPath',join(data,'console.txt')],{encoding:'utf8',windowsHide:true});
    assert.equal(probed.status,0,probed.stderr);
    const consoleState=JSON.parse(await readFile(join(data,'console.txt'),'utf8'));assert.equal(consoleState.visible,false,'The server must not expose a closeable console window');assert.ok(!consoleState.processes.includes(process.pid),'Service must not share the invoking terminal console');
    second.kill();await second.done;
    for(let i=0;i<100;i++){try{process.kill(child.pid,0)}catch{return}await new Promise(r=>setTimeout(r,30));}
    assert.fail('Forced launcher termination left its Node child alive');
  }finally{if(second.exitCode===null&&second.signalCode===null){second.kill();await second.done;}}
});
