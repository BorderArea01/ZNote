import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Launch through Task Scheduler, not spawn({windowsHide:true}): the latter
// conceals precisely the Windows Terminal delegation regression being tested.
test('scheduled headless host creates no desktop terminal and stops its process tree', {
  skip: process.platform !== 'win32', timeout: 45000,
}, async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  const dir = await mkdtemp(resolve('artifacts/headless-task-'));
  const script = join(dir, 'test.ps1');
  const fixture = join(dir, 'fixture.mjs');
  const host = join(dir, 'host.ps1');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  await writeFile(fixture, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(join(dir, 'pid'))},String(process.pid));setInterval(()=>{},1000);`);
  await writeFile(host, `param([string]$NodePath,[string]$Runner,[string]$DataDirectory)
    $ErrorActionPreference='Stop'
    Add-Type -Path ${quote(resolve('scripts/WindowsServerLauncher.cs'))}
    $ownerId=(Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
    exit ([WindowsServerLauncher]::Run(@($NodePath,$Runner,$DataDirectory,'3759',[string]$ownerId)))`);
  await writeFile(script, `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class DesktopProbe {
 delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int size);
 public static string[] Snapshot(){var result=new List<string>();EnumWindows((h,l)=>{var c=new StringBuilder(256);GetClassName(h,c,256);if(IsWindowVisible(h)&&(c.ToString()=="ConsoleWindowClass"||c.ToString().Contains("CASCADIA")))result.Add(h.ToString());return true;},IntPtr.Zero);return result.ToArray();}
}
'@
$taskName='ZNote-Test-Headless-'+[Guid]::NewGuid().ToString('N')
$before=@([DesktopProbe]::Snapshot())
$dataPath=${quote(dir)}
$arguments='--headless "{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -NodePath "{2}" -Runner "{3}" -DataDirectory "{4}"' -f (Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'),${quote(host)},${quote(process.execPath)},${quote(fixture)},$dataPath
$action=New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32/conhost.exe') -Argument $arguments
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$registered=$false
try {
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal | Out-Null
 $registered=$true
 Start-ScheduledTask -TaskName $taskName
 $deadline=(Get-Date).AddSeconds(8)
 while((Get-Date)-lt $deadline){
   foreach($win in [DesktopProbe]::Snapshot()){if($win -notin $before){throw 'Task opened a visible desktop terminal'}}
   Start-Sleep -Milliseconds 50
 }
 $childId=[int](Get-Content (Join-Path $dataPath 'pid'))
 Get-Process -Id $childId -ErrorAction Stop | Out-Null
 Stop-ScheduledTask -TaskName $taskName
 $deadline=(Get-Date).AddSeconds(5)
 while((Get-Process -Id $childId -ErrorAction SilentlyContinue) -and (Get-Date)-lt $deadline){Start-Sleep -Milliseconds 100}
 if(Get-Process -Id $childId -ErrorAction SilentlyContinue){throw 'Task stop orphaned Node'}
 $log=Get-Content (Join-Path $dataPath 'logs/launcher.log') -Raw
 if($log -notmatch 'host_exit'){throw 'Host termination was not logged'}
 'verified' | Set-Content (Join-Path $dataPath 'result')
} finally {
 if($registered){Stop-ScheduledTask -TaskName $taskName;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
}`);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  assert.equal((await once(child, 'exit'))[0], 0, output);
  assert.equal((await readFile(join(dir, 'result'), 'utf8')).trim(), 'verified');
});
