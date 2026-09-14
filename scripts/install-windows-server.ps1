param(
    [string]$TaskName = 'ZNote-Server',
    [string]$DataDirectory = '',
    [ValidateRange(1,65535)][int]$Port = 3741
)
$ErrorActionPreference = 'Stop'
$znoteRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not $DataDirectory) { $DataDirectory = Join-Path $znoteRoot 'data' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $znoteRoot 'dist/index.html'))) { throw 'Run npm run build first.' }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { throw "Task $TaskName already exists; inspect and stop/remove it before reinstalling." }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Stop the existing server on port $Port before installing." }
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$runner = Join-Path $PSScriptRoot 'run-windows-server.mjs'
$arguments = '"{0}" "{1}" {2}' -f $runner, $DataDirectory, $Port
$action = New-ScheduledTaskAction -Execute $nodePath -Argument $arguments -WorkingDirectory $znoteRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
# Periodic activation also recovers an exited launcher. IgnoreNew leaves a
# healthy running instance alone; disable the task before stopping for maintenance.
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $recoveryTrigger) -Principal $principal -Settings $settings -Description 'ZNote local knowledge base; runs independently of terminals and recovers after exit.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Installed and started $TaskName. Logs: $DataDirectory\logs"
