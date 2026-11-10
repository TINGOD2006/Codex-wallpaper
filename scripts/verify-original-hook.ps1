param([ValidateSet('Prepare','RunBaseline','RunProbe','Inspect','Clean')][string]$Action,[Parameter(Mandatory)][string]$FixtureRoot,[string]$SourceRoot)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$productRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$base=Join-Path $productRoot '.state/original-hook'
$fixture=[IO.Path]::GetFullPath($FixtureRoot)
if((Split-Path $fixture) -ne $base -or (Split-Path $fixture -Leaf) -notmatch '^[a-f0-9-]{36}$'){throw 'HOOK_FIXTURE_UNSAFE'}
$driver=Join-Path $productRoot 'test/startup-hook/copy-live.cjs'
function Invoke-CopyCheck([string]$Phase){& node $driver --phase $Phase --fixture $fixture;if($LASTEXITCODE -ne 0){throw 'HOOK_FIXTURE_UNSAFE'}}
if($Action -eq 'Prepare'){
 $packages=@(Get-AppxPackage -Name OpenAI.Codex)
 if($packages.Count -ne 1 -or [IO.Path]::GetFullPath($SourceRoot) -ne (Join-Path $packages[0].InstallLocation 'app')){throw 'HOOK_VERSION_UNSUPPORTED'}
 & node $driver --phase prepare --fixture $fixture --source $SourceRoot
 if($LASTEXITCODE -ne 0){throw 'HOOK_FIXTURE_UNSAFE'}
 Invoke-CopyCheck 'qualify';exit
}
if($Action -eq 'Inspect'){Invoke-CopyCheck 'inspect';exit}
if($Action -eq 'Clean'){
 $running=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($fixture+'\',[StringComparison]::OrdinalIgnoreCase)})
 if($running.Count){throw 'HOOK_FIXTURE_ALREADY_RUNNING'}
 Invoke-CopyCheck 'clean';exit
}
if($Action -eq 'RunProbe'){Invoke-CopyCheck 'check-probe' | Out-Null}else{Invoke-CopyCheck 'check-run' | Out-Null}
$phase=if($Action -eq 'RunProbe'){'probe'}else{'baseline'}
$exe=Join-Path $fixture 'app/ChatGPT.exe'
$envMap=@{CODEX_ELECTRON_USER_DATA_PATH=(Join-Path $fixture 'profile');CODEX_HOME=(Join-Path $fixture 'agent-home');CODEX_WALLPAPER_ROOT=(Join-Path $fixture 'wallpaper');APPDATA=(Join-Path $fixture 'roaming');LOCALAPPDATA=(Join-Path $fixture 'local');TEMP=(Join-Path $fixture 'temp');TMP=(Join-Path $fixture 'temp')}
$arguments=@('--user-data-dir="'+$envMap.CODEX_ELECTRON_USER_DATA_PATH+'"')
$before=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Select-Object ProcessId,CreationDate,ExecutablePath)
if(@($before|Where-Object ExecutablePath -eq $exe).Count){throw 'HOOK_FIXTURE_ALREADY_RUNNING'}
$clock=[Diagnostics.Stopwatch]::StartNew()
$child=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Join-Path $fixture 'app') -Environment $envMap -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture ('logs/'+$phase+'.stdout.log')) -RedirectStandardError (Join-Path $fixture ('logs/'+$phase+'.stderr.log'))
$stamp=@{pid=$child.Id;startTime=$child.StartTime.ToUniversalTime().Ticks.ToString();exe=$exe}
$stamp|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($phase+'-owner.json')) -Encoding utf8
$windowReady=$false;$processes=@()
for($attempt=0;$attempt -lt 100;$attempt++){
 $processes=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object ExecutablePath -eq $exe)
 foreach($candidate in $processes){$p=Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue;if($p -and $p.MainWindowHandle -ne 0){$windowReady=$true;break}}
 if($windowReady -or ($child.HasExited -and $processes.Count -eq 0)){break}
 Start-Sleep -Milliseconds 200
}
$result=@{phase=$phase;passed=$false;reasonCode='HOOK_BASELINE_FAILED';startupMs=$clock.ElapsedMilliseconds;ownedProcessCount=$processes.Count;windowReady=$windowReady;isolatedProfileCreated=(Test-Path -LiteralPath (Join-Path $fixture 'profile/Local State'))}
if($windowReady){
 # Only metadata inspection; no window text, screenshots or chat values.
 $main=@($processes|Where-Object {$_.CommandLine -notmatch '--type='})
 if($main.Count -eq 1 -and $main[0].CommandLine.Contains($envMap.CODEX_ELECTRON_USER_DATA_PATH)){
  $again=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Join-Path $fixture 'app') -Environment $envMap -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'logs/activation.stdout.log') -RedirectStandardError (Join-Path $fixture 'logs/activation.stderr.log')
  $activationExited=$again.WaitForExit(5000)
  $remaining=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type='})
  $result.singleInstance=$activationExited -and $remaining.Count -eq 1 -and $remaining[0].ProcessId -eq $main[0].ProcessId
  $mainProcess=Get-Process -Id $main[0].ProcessId
  if($mainProcess.Path -ne $exe){throw 'HOOK_FIXTURE_UNSAFE'}
  if($phase -eq 'baseline'){
   $result.closeRequested=$mainProcess.CloseMainWindow()
   $result.normalExit=$mainProcess.WaitForExit(5000)
   $result.passed=$result.singleInstance -and $result.normalExit -and $result.isolatedProfileCreated
  }else{
   $result.normalExit=$null
   $eventsFile=Join-Path $fixture 'logs/probe.jsonl'
   for($probeAttempt=0;$probeAttempt -lt 50;$probeAttempt++){
    $events=if(Test-Path -LiteralPath $eventsFile){@(Get-Content -LiteralPath $eventsFile|ForEach-Object {$_|ConvertFrom-Json}|Where-Object pid -eq $main[0].ProcessId)}else{@()}
    if(@($events|Where-Object event -eq 'HOOK_RUNTIME_UNSUPPORTED').Count -or (@($events|Where-Object event -eq 'DOCUMENT_API').Count -and @($events|Where-Object event -eq 'CHILD_API').Count)){break}
    Start-Sleep -Milliseconds 200
   }
   $result.hookRegistered=@($events|Where-Object event -eq 'HOOK_REGISTERED').Count -eq 1
   $result.originalLoadOnce=@($events|Where-Object event -eq 'ORIGINAL_LOAD').Count -eq 1
   $result.originalMain=@($events|Where-Object {$_.event -eq 'ORIGINAL_RETURN' -and $_.originalMain}).Count -eq 1
   $result.windowApi=@($events|Where-Object {$_.event -eq 'WINDOW_API' -and $_.handleSupported -and $_.executeSupported}).Count -ge 1
   $result.documentApi=@($events|Where-Object {$_.event -eq 'DOCUMENT_API' -and $_.root}).Count -ge 1
   $result.httpApi=@($events|Where-Object event -eq 'HTTP_API').Count -eq 1
   $result.childApi=@($events|Where-Object event -eq 'CHILD_API').Count -eq 1
   $result.passed=$result.singleInstance -and $result.isolatedProfileCreated -and $result.hookRegistered -and $result.originalLoadOnce -and $result.originalMain -and $result.windowApi -and $result.documentApi -and $result.httpApi -and $result.childApi
  }
  if($result.passed){$result.reasonCode=$null}
 }
}
$manifest=Get-Content -LiteralPath (Join-Path $fixture 'fixture.json') -Raw|ConvertFrom-Json
$archiveRecord=$manifest.files|Where-Object path -eq 'resources/app.asar'
$result.sourceArchiveUnchanged=(Get-FileHash -LiteralPath (Join-Path $manifest.sourceRoot 'resources/app.asar')).Hash -eq $archiveRecord.sha256
$result.remainingOwnedProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $fixture 'app')+'\',[StringComparison]::OrdinalIgnoreCase)}).Count
$result.passed=$result.passed -and $result.sourceArchiveUnchanged -and ($phase -eq 'probe' -or $result.remainingOwnedProcesses -eq 0)
if(-not $result.passed){$result.reasonCode=if($phase -eq 'probe'){'HOOK_RUNTIME_UNSUPPORTED'}else{'HOOK_BASELINE_FAILED'}}
if($phase -eq 'probe' -and -not $result.passed){
 $stderrFile=Join-Path $fixture 'logs/probe.stderr.log'
 if((Test-Path -LiteralPath $stderrFile) -and (Select-String -LiteralPath $stderrFile -SimpleMatch 'Integrity check failed for asar archive' -Quiet)){$result.reasonCode='HOOK_INTEGRITY_REQUIRED'}
}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $fixture ($phase+'-result.json')) -Encoding utf8
$result|ConvertTo-Json -Compress
