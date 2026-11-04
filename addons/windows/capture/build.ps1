param([string]$OutputDirectory=(Join-Path $PSScriptRoot '../../../data/windows-capture'))
$ErrorActionPreference='Stop'
$destination=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
Add-Type -AssemblyName System.Drawing
$bitmap=[Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot '../../../clients/desktop/launcher/icon.png'))
$icon=[Drawing.Icon]::FromHandle($bitmap.GetHicon());$iconStream=[IO.File]::Create((Join-Path $destination 'icon.ico'))
try{$icon.Save($iconStream)}finally{$iconStream.Dispose();$icon.Dispose();$bitmap.Dispose()}
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll "/win32manifest:$PSScriptRoot/App.manifest" "/win32icon:$destination/icon.ico" "/out:$destination/ZNoteCapture.exe" (Join-Path $PSScriptRoot 'CaptureHost.cs')
if($LASTEXITCODE -ne 0){throw 'Windows capture build failed'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'App.config') -Destination (Join-Path $destination 'ZNoteCapture.exe.config') -Force
