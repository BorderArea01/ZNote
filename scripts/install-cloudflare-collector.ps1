param([string]$DataDirectory='',[string]$TaskName='ZNote-Cloudflare-Collector')
$ErrorActionPreference='Stop'
$cloudflareRoot=Split-Path -Parent $PSScriptRoot
if(-not $DataDirectory){$DataDirectory=Join-Path $cloudflareRoot 'data/cloudflare-collector'}
$DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
if(-not(Test-Path -LiteralPath (Join-Path $DataDirectory 'config.json'))){throw 'Configure the remote inbox before installing the collector.'}
if(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue){throw 'Collector task already exists; inspect it before changing its lifecycle.'}
$cloudflareUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$cloudflareNode=(Get-Command node -ErrorAction Stop).Source
$cloudflareHost=Join-Path $env:WINDIR 'System32/conhost.exe'
$cloudflarePowershell=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
$cloudflareArguments='--headless "{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -NodePath "{2}" -DataDirectory "{3}"' -f $cloudflarePowershell,(Join-Path $PSScriptRoot 'run-cloudflare-hidden.ps1'),$cloudflareNode,$DataDirectory
$cloudflareAction=New-ScheduledTaskAction -Execute $cloudflareHost -Argument $cloudflareArguments -WorkingDirectory $cloudflareRoot
$cloudflareTriggers=@((New-ScheduledTaskTrigger -AtLogOn -User $cloudflareUser),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)))
$cloudflareSettings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$cloudflarePrincipal=New-ScheduledTaskPrincipal -UserId $cloudflareUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $cloudflareAction -Trigger $cloudflareTriggers -Settings $cloudflareSettings -Principal $cloudflarePrincipal -Description 'Pulls link-only capture jobs from the private Cloudflare inbox; no inbound listener.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Installed and started $TaskName"
