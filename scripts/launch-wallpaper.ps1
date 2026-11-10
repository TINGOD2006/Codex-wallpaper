param([switch]$Quiet)
$ErrorActionPreference='Stop'
$env:MIKU_PWSH=(Get-Process -Id $PID).Path
$launchMutex=$null;$launchLocked=$false
$launchTimer=[Diagnostics.Stopwatch]::StartNew()
$bootAnimation=[pscustomobject]@{value=$null;reason='not-requested';outcome=$null;error=$null}
$entryState=[pscustomobject]@{nativeInvoked=$false;cold=$false;activationAttempted=$false;activationError=$null;hostHintUsed=$false;nativeRequestMs=$null}
function Show-LaunchedCodex {
 if(-not $entryState.cold -or $entryState.activationAttempted){return}
 $entryState.activationAttempted=$true
 try{& (Join-Path $PSScriptRoot 'ensure-codex-visible.ps1') -ExistingOnly -UseHostHint}catch{$entryState.activationError=$_.Exception.Message;Write-Warning ('Codex 原生啟用：'+$_.Exception.Message)}
}
function Write-WallpaperLaunchResult([string]$Result,[string]$Code){
 try{
  $logs=Join-Path (Split-Path $projectRoot) 'logs';New-Item -ItemType Directory -Path $logs -Force|Out-Null
  $record=@{at=[DateTime]::UtcNow.ToString('o');result=$Result;code=$Code;elapsedMs=$launchTimer.ElapsedMilliseconds;nativeRequestMs=$entryState.nativeRequestMs;hostHintUsed=$entryState.hostHintUsed;phase=$state.phase;applied=$state.observed.applied;connected=$state.observed.connected;appVersion=$state.observed.appVersion;animationStarted=!!$bootAnimation.value.playerPid;animationReason=$bootAnimation.reason;animationOutcome=$bootAnimation.outcome;animationError=$bootAnimation.error;animationLaunchId=$bootAnimation.value.launchId;nativeInvoked=$entryState.nativeInvoked;nativeActivationError=$entryState.activationError}
  $record|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $logs 'last-launch.json') -Encoding utf8
  if($bootAnimation.reason -in @('cold-start','start-failed')){$record|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $logs 'last-cold-launch.json') -Encoding utf8}
 }catch{}
}
try {
 $projectRoot=Split-Path $PSScriptRoot
 $command=Join-Path $projectRoot 'src/companion/command.cjs'
 $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant())))
 $launchMutex=[Threading.Mutex]::new($false,'Local\CodexWallpaperLaunch-'+$key)
 try{$launchLocked=$launchMutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$launchLocked=$true}
 if(-not $launchLocked){
  # A second click may still bring back the existing native window. It must
  # never start another host, replay animation or duplicate wallpaper bootstrap.
  try{& (Join-Path $PSScriptRoot 'ensure-codex-visible.ps1') -ExistingOnly -UseHostHint}catch{Write-Warning ('Codex 正在啟動：'+$_.Exception.Message)}
  Write-Output '{"ok":true,"alreadyStarting":true}';return
 }
 # Make the official app visible from the clicked process, without waiting for rendering.
 . (Join-Path $PSScriptRoot 'boot-animation.ps1')
 & (Join-Path $PSScriptRoot 'ensure-codex-visible.ps1') -UseHostHint -OnColdStart {param($reason);$entryState.cold=$true;$bootAnimation.reason=$reason;try{$outcome=$null;$bootAnimation.value=Start-WallpaperBootAnimation -ProjectRoot $projectRoot -Reason ([ref]$outcome);$bootAnimation.outcome=$outcome}catch{$bootAnimation.reason='start-failed';$bootAnimation.error=$_.Exception.Message;Write-Warning '啟動動畫暫不可用，繼續啟動 Codex。'}} -OnExistingWindow {param($HintUsed)if(-not $entryState.cold){$bootAnimation.reason='already-running'};$entryState.hostHintUsed=[bool]$HintUsed}
 $entryState.nativeInvoked=$true
 $entryState.nativeRequestMs=$launchTimer.ElapsedMilliseconds
 $node=(Get-Command node -ErrorAction Stop).Source
 # Establish the wallpaper connection before cosmetic shortcut maintenance.
 $reply=& $node $command launch --settle 2>$null
 if($LASTEXITCODE -ne 0){
  # The waiter returns the launch state using its already verified client.
  # Do not immediately create another Node + PowerShell verifier after startup.
  $reply=& (Join-Path $PSScriptRoot 'start-companion.ps1') -Action Start -Integrated -Quiet -SettleLaunch
 }
 $state=($reply|ConvertFrom-Json).state
 Show-LaunchedCodex
 # Cosmetic shortcut refresh must not rescan the package on every hot launch.
 $refreshFile=Join-Path (Split-Path $projectRoot) 'data/entry-assets/entry-refreshed'
 $refresh=Get-Item -LiteralPath $refreshFile -ErrorAction SilentlyContinue
 $refreshData=$null;try{if($refresh){$refreshData=Get-Content -LiteralPath $refreshFile -Raw|ConvertFrom-Json}}catch{}
 if(-not $refresh -or $refresh.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-24) -or $refresh.LastWriteTimeUtc -lt (Get-Item -LiteralPath $PSCommandPath).LastWriteTimeUtc -or $refreshData.appVersion -ne $state.observed.appVersion){
  # A deliberately preserved legacy link must not prevent the current entry
  # from being maintained, nor make every click repeat a failed refresh.
  foreach($installer in @('install-wallpaper-entry.ps1','install-codex-taskbar-entry.ps1','install-codex-user-shortcuts.ps1')){
   try{& (Join-Path $PSScriptRoot $installer) | Out-Null}catch{Write-Warning ('Codex shortcut refresh ('+$installer+'): '+$_.Exception.Message)}
  }
  try{@{at=[DateTime]::UtcNow.ToString('o');appVersion=$state.observed.appVersion}|ConvertTo-Json|Set-Content -LiteralPath $refreshFile -Encoding utf8}catch{Write-Warning ('Codex refresh marker: '+$_.Exception.Message)}
 }
 # Wallpaper readiness must not gate the original application or open a modal
 # error dialog. The sidebar and diagnostic log retain real connection errors.
 $launchResult=if($state.error -and $state.error.code -notin @('HOST_ENDPOINT_PENDING','HOST_SHELL_PENDING','HOST_IDENTITY_CHANGED','HOST_LAUNCH_FAILED')){'wallpaper-unavailable'}elseif($state.observed.applied -or -not $state.desired.enabled -or -not $state.desired.wallpaperEnabled){'completed'}else{'pending'}
 Write-WallpaperLaunchResult $launchResult $state.error.code
 $reply
}catch{
 if($bootAnimation.value -and (Get-Command Set-WallpaperBootFailure -ErrorAction SilentlyContinue)){Set-WallpaperBootFailure $bootAnimation.value}
 if($entryState.nativeInvoked){Show-LaunchedCodex;Write-WallpaperLaunchResult 'wallpaper-unavailable' 'WALLPAPER_BOOTSTRAP_FAILED';Write-Warning ('Codex 已交由原版啟用，桌布暫不可用：'+$_.Exception.Message);exit 0}
 Write-WallpaperLaunchResult 'failed' 'LAUNCH_FAILED'
 if($launchLocked){$launchMutex.ReleaseMutex();$launchLocked=$false}
 if($Quiet){Write-Error $_}else{Add-Type -AssemblyName System.Windows.Forms;[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Codex Wallpaper')}
 exit 1
}finally{if($launchLocked){$launchMutex.ReleaseMutex()};if($launchMutex){$launchMutex.Dispose()}}
