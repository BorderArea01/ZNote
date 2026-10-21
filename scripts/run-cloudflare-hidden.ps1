param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$DataDirectory)
$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot 'WindowsServerLauncher.cs')
$cloudflareHostParent=(Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
if([Diagnostics.Process]::GetProcessById($cloudflareHostParent).ProcessName -ne 'conhost'){throw 'Start the collector through its headless scheduled task.'}
$env:NODE_OPTIONS='--max-old-space-size=128'
exit ([WindowsServerLauncher]::Run(@($NodePath,(Join-Path $PSScriptRoot 'run-cloudflare-collector.mjs'),$DataDirectory,'3741',[string]$cloudflareHostParent)))
