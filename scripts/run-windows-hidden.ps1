param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$DataDirectory,
    [ValidateRange(1,65535)][int]$Port = 3741
)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsServerLauncher.cs')
    $runner = Join-Path $PSScriptRoot 'run-windows-server.mjs'
    exit ([WindowsServerLauncher]::Run(@($NodePath, $runner, $DataDirectory, [string]$Port)))
} catch {
    $logs = Join-Path $DataDirectory 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    Add-Content -LiteralPath (Join-Path $logs 'launcher.log') -Value ((Get-Date).ToUniversalTime().ToString('o') + ' launcher_host_failure ' + $_.Exception.Message)
    exit 1
}
