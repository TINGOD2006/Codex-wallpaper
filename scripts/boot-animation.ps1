function Start-WallpaperBootAnimation {
 param([Parameter(Mandatory)][string]$ProjectRoot,[ref]$Reason)
 $ErrorActionPreference='Stop'
 . (Join-Path $PSScriptRoot 'companion-paths.ps1')
 $root=Get-CompanionInstallRoot
 $preference=Join-Path $root 'data/boot-animation.json'
 if(Test-Path -LiteralPath $preference){$saved=Get-Content -LiteralPath $preference -Raw|ConvertFrom-Json;if($saved.enabled -eq $false){if($Reason){$Reason.Value='disabled'};return $null}}
 $assets=Join-Path $ProjectRoot 'assets/boot-animation';$player=Join-Path $assets 'DragonBoot.exe'
 if(-not(Test-Path -LiteralPath $player -PathType Leaf) -or -not(Test-Path -LiteralPath (Join-Path $assets 'startup.mp4') -PathType Leaf)){if($Reason){$Reason.Value='assets-missing'};return $null}
 $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))
 $startLock=[Threading.Mutex]::new($false,'Local\CodexWallpaperBootStart-'+$key);$locked=$false
 try{
 try{$locked=$startLock.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){if($Reason){$Reason.Value='duplicate-request'};return $null}
 $folder=Join-Path $root 'runtime/boot-animation';New-Item -ItemType Directory -Path $folder -Force|Out-Null
 . (Join-Path $PSScriptRoot 'companion-security.ps1');Set-CompanionPrivateAccess $folder
 $lastFile=Join-Path $folder 'last-request.json'
 # Deduplicate a live player, not a time window. A real quit/reopen shortly
 # after a completed animation is a new cold start and must not be suppressed.
 try{
  $last=Get-Content -LiteralPath $lastFile -Raw -ErrorAction Stop|ConvertFrom-Json
  if($last.playerPid -gt 0 -and $last.playerStartTime){$prior=Get-Process -Id $last.playerPid -ErrorAction Stop;if($prior.Path -eq $player -and $prior.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$last.playerStartTime){if($Reason){$Reason.Value='already-requested'};return $null}}
 }catch{}
 $existing=$null;$acquired=$false
 try{$existing=[Threading.Mutex]::OpenExisting('Local\DragonCodexBoot');try{$acquired=$existing.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true};if(-not $acquired){if($Reason){$Reason.Value='already-playing'};return $null}}catch [Threading.WaitHandleCannotBeOpenedException]{}finally{if($existing){if($acquired){$existing.ReleaseMutex()};$existing.Dispose()}}
 $id=[guid]::NewGuid().ToString();$statePath=Join-Path $folder ($id+'.json')
 @{ticks=[DateTime]::UtcNow.Ticks;launchId=$id}|ConvertTo-Json -Compress|Set-Content -LiteralPath $lastFile -Encoding utf8
 @{LaunchId=$id;HostPid=0;HostStartTime='';HostPath='';Ready=$false;Failed=$false}|ConvertTo-Json -Compress|Set-Content -LiteralPath $statePath -Encoding utf8
 $node=(Get-Command node -ErrorAction Stop).Source
 $writer=Join-Path $ProjectRoot 'src/companion/boot-status.cjs'
 $process=Start-Process -FilePath $player -ArgumentList @('--state-file',('"'+$statePath+'"'),'--launch-id',$id) -WorkingDirectory $assets -WindowStyle Normal -PassThru
 $playerStamp='';try{$playerStamp=$process.StartTime.ToUniversalTime().Ticks.ToString()}catch{}
 @{ticks=[DateTime]::UtcNow.Ticks;launchId=$id;playerPid=$process.Id;playerStartTime=$playerStamp}|ConvertTo-Json -Compress|Set-Content -LiteralPath $lastFile -Encoding utf8
 $feed=Start-Process -FilePath $node -ArgumentList @(('"'+$writer+'"'),'--state-file',('"'+$statePath+'"'),'--launch-id',$id,'--player-pid',[string]$process.Id) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
 if($Reason){$Reason.Value='started'};return @{launchId=$id;statePath=$statePath;playerPid=$process.Id;writerPid=$feed.Id}
 }finally{if($locked){$startLock.ReleaseMutex()};$startLock.Dispose()}
}
function Set-WallpaperBootFailure($Context){
 if(-not $Context){return}
 try{$state=Get-Content -LiteralPath $Context.statePath -Raw|ConvertFrom-Json;if($state.LaunchId -ne $Context.launchId){return};$state.Failed=$true;$temporary=$Context.statePath+'.tmp';$state|ConvertTo-Json -Compress|Set-Content -LiteralPath $temporary -Encoding utf8;[IO.File]::Move($temporary,$Context.statePath,$true)}catch{}
}
