[CmdletBinding()]
param([switch]$PrioritizeBuildWhenNoGame)
$ErrorActionPreference='Stop'
if(-not $PrioritizeBuildWhenNoGame){throw 'Use -PrioritizeBuildWhenNoGame; this never permits a game-running build.'}
$workspace=Split-Path -Parent $PSScriptRoot
if(-not $env:JAVA_HOME -or -not $env:ANDROID_HOME){throw 'Set JAVA_HOME and ANDROID_HOME to the existing JDK 21 and SDK 36 before building.'}
$arguments=@(':app:assembleRelease',':app:lintRelease',':app:assembleDebug',':app:assembleDebugAndroidTest','--offline','--no-daemon','--max-workers=1','--no-parallel','--no-configuration-cache','--console=plain','-Dorg.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=256m -Dfile.encoding=UTF-8','-Pkotlin.compiler.execution.strategy=in-process')
$literals=($arguments|ForEach-Object {"'"+$_.Replace("'","''")+"'"}) -join ','
$code="Set-Location -LiteralPath '"+(Join-Path $workspace 'clients/android').Replace("'","''")+"'; & './gradlew.bat' @("+$literals+"); exit `$LASTEXITCODE"
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
& node --max-old-space-size=128 (Join-Path $PSScriptRoot 'run-android-guarded.mjs') -PrioritizeBuildWhenNoGame powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded
if($LASTEXITCODE -ne 0){throw ('Controlled Android build stopped or failed: '+$LASTEXITCODE)}
