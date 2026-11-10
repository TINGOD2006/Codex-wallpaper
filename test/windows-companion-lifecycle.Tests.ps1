$ErrorActionPreference='Stop'
$source=Split-Path $PSScriptRoot
$testRoot=Join-Path $source ('.state/lifecycle-'+[guid]::NewGuid().ToString())
$app=Join-Path $testRoot 'CodexWallpaper/app'
New-Item -ItemType Directory -Path $app -Force|Out-Null
foreach($folder in @('src','scripts','assets')){Copy-Item -LiteralPath (Join-Path $source $folder) -Destination $app -Recurse}
foreach($name in @('package.json','wallpaper.defaults.json')){Copy-Item -LiteralPath (Join-Path $source $name) -Destination $app}
$pwsh=(Get-Process -Id $PID).Path
$helper=Join-Path $app 'scripts/windows-independent.ps1'
$bootstrap=Join-Path $testRoot 'bootstrap.ps1'
$parent=Join-Path $testRoot 'parent.ps1'
$identityFile=Join-Path $testRoot 'worker.json'
$testEscaped=$testRoot.Replace("'","''")
$appEscaped=$app.Replace("'","''")
@"
`$env:CODEX_WALLPAPER_ROOT=Join-Path '$testEscaped' 'CodexWallpaper'
& '$appEscaped/scripts/companion-worker.ps1' -Headless
"@|Set-Content -LiteralPath $bootstrap -Encoding utf8
@"
. '$($helper.Replace("'","''"))'
Start-ThemeIndependentProcess -PowerShellPath '$($pwsh.Replace("'","''"))' -ScriptPath '$($bootstrap.Replace("'","''"))' -WorkingDirectory '$testEscaped' | ConvertTo-Json | Set-Content -LiteralPath '$($identityFile.Replace("'","''"))'
"@|Set-Content -LiteralPath $parent -Encoding utf8
$caller=Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile','-File',('"{0}"' -f $parent)) -WindowStyle Hidden -PassThru
if(-not $caller.WaitForExit(15000) -or $caller.ExitCode -ne 0){throw 'Parent bootstrap failed'}
$savedCompanionRoot=$env:CODEX_WALLPAPER_ROOT
try{
 $env:CODEX_WALLPAPER_ROOT=Join-Path $testRoot 'CodexWallpaper'
 $node=(Get-Command node).Source;$command=Join-Path $app 'src/companion/command.cjs';$ready=$false
 for($attempt=0;$attempt -lt 80;$attempt++){
  $reply=& $node $command status 2>$null
  if($LASTEXITCODE -eq 0){$state=($reply|ConvertFrom-Json).state;$ready=$true;break}
  Start-Sleep -Milliseconds 250
 }
 if(-not $ready){throw 'Companion failed to become available after parent exit'}
 if($state.observed.applied){throw 'Unconnected fixture falsely reported applied'}
 $shutdown=& $node $command exit 2>$null
 if($LASTEXITCODE -ne 0){throw 'Own manager shutdown failed'}
 $descriptor=Join-Path $testRoot 'CodexWallpaper/runtime/manager.json'
 for($attempt=0;$attempt -lt 40 -and (Test-Path -LiteralPath $descriptor);$attempt++){Start-Sleep -Milliseconds 100}
 if(Test-Path -LiteralPath $descriptor){throw 'Manager descriptor survived shutdown'}
 Write-Output 'PASS: parent exits, independent manager remains queryable, no false applied state, authenticated shutdown removes descriptor'
}finally{$env:CODEX_WALLPAPER_ROOT=$savedCompanionRoot}
