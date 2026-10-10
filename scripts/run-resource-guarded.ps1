param(
  [Parameter(Mandatory=$true)][string[]]$NodeArguments,
  [Parameter(Mandatory=$true)][string]$LogName
)
$ErrorActionPreference='Stop'
$workspacePath=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$logDirectory=Join-Path $workspacePath 'artifacts/albums'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
if($LogName -notmatch '^[a-zA-Z0-9_-]+$'){throw 'Invalid log name'}
$stdoutPath=Join-Path $logDirectory ($LogName+'.log')
$stderrPath=Join-Path $logDirectory ($LogName+'.errors.log')
function Assert-Resources {
  $gameProcesses=@(Get-Process -ErrorAction Stop | Where-Object {$_.ProcessName -eq 'NRC-Win64-Shipping' -or $_.MainWindowTitle -like '*洛克王国*'})
  if($gameProcesses.Count){throw '洛克王国正在运行，禁止启动或继续本任务。'}
  $availableMemory=(Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).FreePhysicalMemory/1024
  if($availableMemory -lt 1024){throw '可用内存不足 1 GB，已停止本任务。'}
}
Assert-Resources
$nodePath=(Get-Command node -ErrorAction Stop).Source
$taskStarted=Get-Date
$taskProcess=Start-Process -FilePath $nodePath -ArgumentList $NodeArguments -WorkingDirectory $workspacePath -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$taskCreation=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskProcess.Id)).CreationDate
function Stop-OwnedTree {
  $processRecords=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  # A PID can be reused after exit. Never stop a later, unrelated process.
  if(-not $taskCreation -or -not ($processRecords | Where-Object {$_.ProcessId -eq $taskProcess.Id -and $_.CreationDate -eq $taskCreation})){return}
  $ownedIds=[Collections.Generic.HashSet[uint32]]::new()
  [void]$ownedIds.Add([uint32]$taskProcess.Id)
  do {
    $added=$false
    foreach($record in $processRecords){if($ownedIds.Contains([uint32]$record.ParentProcessId) -and $record.CreationDate -ge $taskStarted -and $ownedIds.Add([uint32]$record.ProcessId)){$added=$true}}
  } while($added)
  foreach($record in $processRecords | Where-Object {$ownedIds.Contains([uint32]$_.ProcessId)} | Sort-Object CreationDate -Descending){
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$record.ProcessId)
    if($current -and $current.CreationDate -eq $record.CreationDate){Stop-Process -Id $record.ProcessId -Force -ErrorAction SilentlyContinue}
  }
}
try {
  while(-not $taskProcess.HasExited){Assert-Resources;Start-Sleep -Milliseconds 400;$taskProcess.Refresh()}
  $taskProcess.WaitForExit()
  Get-Content -LiteralPath $stdoutPath -Tail 40
  Get-Content -LiteralPath $stderrPath -Tail 15
  if($taskProcess.ExitCode -ne 0){throw ('Node task failed: '+$taskProcess.ExitCode)}
} catch { Stop-OwnedTree;throw }
