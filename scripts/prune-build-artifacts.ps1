[CmdletBinding()]
param([switch]$Apply,[switch]$Intermediates,[string]$CurrentVersion='0.10.0-beta.28',[string]$RollbackVersion='0.10.0-beta.27')
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$artifactRoot=Join-Path $workspace 'artifacts'
# This one project-wide rollback includes both APK and complete source. Never
# turn this into one rollback per platform or per test directory.
if($CurrentVersion -notmatch '^0\.10\.0-beta\.(\d+)$'){throw 'Unsupported current version'};$currentDirectory='android-beta'+$Matches[1]+'-release'
if($RollbackVersion -notmatch '^0\.10\.0-beta\.(\d+)$'){throw 'Unsupported rollback version'};$rollbackDirectory='android-beta'+$Matches[1]+'-release'
$rollback=Join-Path $artifactRoot $rollbackDirectory
$receipt=Get-Content -LiteralPath (Join-Path $rollback 'ANDROID-BUILD-SOURCE.json') -Raw | ConvertFrom-Json
$rollbackApkVersion=if($receipt.apk_version){$receipt.apk_version}else{$RollbackVersion}
if((Get-FileHash -LiteralPath (Join-Path $rollback ('ZNote-'+$rollbackApkVersion+'-android.apk')) -Algorithm SHA256).Hash.ToLower() -ne $receipt.apk_sha256){throw 'Rollback hash mismatch'}
if((Get-FileHash -LiteralPath (Join-Path $rollback ('ZNote-'+$RollbackVersion+'-source.zip')) -Algorithm SHA256).Hash.ToLower() -ne $receipt.source_sha256){throw 'Rollback source hash mismatch'}
if($receipt.android_source_sha256 -and (Get-FileHash -LiteralPath (Join-Path $rollback ('ZNote-'+$rollbackApkVersion+'-source.zip'))).Hash.ToLower() -ne $receipt.android_source_sha256){throw 'Rollback effective Android source mismatch'}
if($receipt.windows_sha256 -and (Get-FileHash -LiteralPath (Join-Path $workspace ('clients/desktop/release/ZNote-'+$RollbackVersion+'-win-x64.exe'))).Hash.ToLower() -ne $receipt.windows_sha256){throw 'Rollback Windows installer mismatch'}
$activeReceipt=Get-Content -LiteralPath (Join-Path (Join-Path $artifactRoot $currentDirectory) 'ANDROID-BUILD-SOURCE.json') -Raw | ConvertFrom-Json
$activeAndroid=if($activeReceipt.apk_version){$activeReceipt.apk_version}else{$CurrentVersion}
$targets=[Collections.Generic.List[string]]::new()
if($Apply -and $Intermediates){
 $current=Join-Path $artifactRoot $currentDirectory
 $verified=Get-Content -LiteralPath (Join-Path $current 'ANDROID-BUILD-SOURCE.json') -Raw | ConvertFrom-Json
 $currentApkVersion=if($verified.apk_version){$verified.apk_version}else{$CurrentVersion}
 if((Get-FileHash -LiteralPath (Join-Path $current ('ZNote-'+$currentApkVersion+'-android.apk'))).Hash.ToLower() -ne $verified.apk_sha256){throw 'Current effective APK is not verified'}
 if((Get-FileHash -LiteralPath (Join-Path $current ('ZNote-'+$CurrentVersion+'-source.zip'))).Hash.ToLower() -ne $verified.source_sha256){throw 'Current source is not verified'}
 if($verified.android_source_sha256 -and (Get-FileHash -LiteralPath (Join-Path $current ('ZNote-'+$currentApkVersion+'-source.zip'))).Hash.ToLower() -ne $verified.android_source_sha256){throw 'Current effective Android source is not verified'}
 if(!$verified.windows_sha256 -or (Get-FileHash -LiteralPath (Join-Path $workspace ('clients/desktop/release/ZNote-'+$CurrentVersion+'-win-x64.exe'))).Hash.ToLower() -ne $verified.windows_sha256){throw 'Current Windows installer is not verified'}
}
foreach($dir in Get-ChildItem -LiteralPath $artifactRoot -Directory){
  if($dir.Name -match '^android-(?:beta\d+|back|overlay|share)-release$' -and $dir.Name -notin @($currentDirectory,$rollbackDirectory)){$targets.Add($dir.FullName)}
  if($dir.Name -match '^release-(?:android-1348|mac-arm-5c19|windows-73fb|v0100|v0931-source)$'){$targets.Add($dir.FullName)}
  if($dir.Name -match '^android-(?:copy|import|overlay|route|glitch)-local(?:-.+)?$'){$device=Join-Path $dir.FullName 'device';if(Test-Path -LiteralPath $device){$targets.Add($device)}}
  if($dir.Name -in @('android-beta12','android-beta5-final-build','mobile-beta6-ci-unsigned')){foreach($file in Get-ChildItem -LiteralPath $dir.FullName -File){if($file.Name -match '\.apk(?:\.idsig)?$'){$targets.Add($file.FullName)}}}
  if($Intermediates -and $dir.Name -match '^build-' -and (Test-Path -LiteralPath (Join-Path $dir.FullName 'index.html')) -and (Test-Path -LiteralPath (Join-Path $dir.FullName 'assets')) -and $dir.Name -ne 'build-glitch'){$targets.Add($dir.FullName)}
}
$downloads=Join-Path $artifactRoot 'remote-access/pages/downloads'
if(Test-Path -LiteralPath $downloads){foreach($file in Get-ChildItem -LiteralPath $downloads -File){if($file.Name -match '^ZNote-(.+)-(?:android\.apk|source\.zip)$' -and $Matches[1] -notin @($CurrentVersion,$RollbackVersion,$activeAndroid)){$targets.Add($file.FullName)}}}
$desktopRelease=Join-Path $workspace 'clients/desktop/release'
if(Test-Path -LiteralPath $desktopRelease){foreach($file in Get-ChildItem -LiteralPath $desktopRelease -File){if($file.Name -match '^ZNote-(.+)-win-x64\.(?:exe|zip)(?:\.blockmap)?$' -and $Matches[1] -notin @($CurrentVersion,$RollbackVersion)){$targets.Add($file.FullName)}}}
if($Intermediates){foreach($relative in @('clients/android/app/build','clients/android/capturefixture/build','clients/android/build','artifacts/build-glitch','clients/desktop/release/win-unpacked','clients/desktop/runtime')){$path=Join-Path $workspace $relative;if(Test-Path -LiteralPath $path){$targets.Add($path)}};foreach($release in @($currentDirectory,$rollbackDirectory)){$unsigned=Join-Path (Join-Path $artifactRoot $release) 'app-release-unsigned.apk';if(Test-Path -LiteralPath $unsigned){$targets.Add($unsigned)}}}
$live=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^(?:emulator|qemu-system-x86_64|java|electron).*\.exe$' -and $_.CommandLine -match [regex]::Escape($workspace)})
if($live.Count){throw 'Project build/emulator/desktop processes must be stopped before pruning'}
foreach($path in $targets){
  $item=Get-Item -LiteralPath $path
  $resolved=[IO.Path]::GetFullPath($item.FullName)
  if(!$resolved.StartsWith($workspace+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $item.LinkType){throw 'Cleanup target escaped workspace or is a link'}
  if($item.PSIsContainer -and @(Get-ChildItem -LiteralPath $resolved -Recurse -Force -Attributes ReparsePoint).Count){throw ('A cleanup target contains a link: '+$resolved)}
  $verb=if($Apply){'Remove '}else{'Would remove '};Write-Output ($verb+$resolved)
  if($Apply){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
