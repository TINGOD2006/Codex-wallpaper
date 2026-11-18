param([string]$IdentityPath)
$ErrorActionPreference='Stop'
$monitorIdentityPath=$IdentityPath
. (Join-Path $PSScriptRoot 'windows-session.ps1')
. (Join-Path $PSScriptRoot 'window-activation.ps1')
. (Join-Path $PSScriptRoot 'codex-native-activation.ps1')
. (Join-Path $PSScriptRoot 'companion-hosts.ps1')
$identity=Get-Content -LiteralPath $monitorIdentityPath -Raw | ConvertFrom-Json
Add-Type -Path (Join-Path $PSScriptRoot '../src/companion/native-window-state.cs')
$process=[Diagnostics.Process]::GetProcessById([int]$identity.pid)
try{
  # Pin the original process before checking its full identity. The handle's signalled
  # state then observes exit even if Windows reuses the PID.
  $pinned=$false
  try{$null=$process.SafeHandle;$pinned=$true}catch{
    # The original CIM check also works when Windows limits process-handle access.
  }
  Confirm-ThemeSession $identity
  $wasIconic=$false
  $lastVisible=$null;$lastUnresponsive=$null;$lastMoving=$false
  while($true){
    if($pinned){
      if($process.HasExited){break}
    }else{
      $owned=Get-ThemeProcess $identity.pid
      if(-not $owned -or $owned.CreationDate.ToUniversalTime().Ticks.ToString() -ne [string]$identity.startTime){break}
    }
    try{$handle=[CodexWindowActivation]::Find($process.Id)}catch{
      if($pinned -and $process.HasExited){break}
      throw
    }
    if($pinned -and $process.HasExited){break}
    $iconic=$handle -ne 0 -and [MikuWindowState]::IsIconic($handle)
    $visible=$handle -ne 0 -and [MikuWindowState]::IsWindowVisible($handle) -and -not $iconic
    $unresponsive=if($handle -ne 0){[MikuWindowState]::IsHungAppWindow($handle)}else{$null}
    if($wasIconic -and $visible -and -not $unresponsive -and [MikuWindowState]::GetForegroundWindow() -eq $handle){
     try{
      $packages=@(Get-CompanionPackages -HostId 'codex-desktop')
      if((!$pinned -or !$process.HasExited) -and $packages.Count -eq 1 -and (Get-CompanionProcessVersion -Package $packages[0] -AppPath $identity.appPath)){Invoke-CodexNativeActivation -Package $packages[0] -OnlyIfForeground $handle}
     }catch{[Console]::Error.WriteLine('NATIVE_RESTORE_ACTIVATION_FAILED')}
    }
    if(-not $unresponsive){$wasIconic=$iconic}
    $moving=$visible -and -not $unresponsive -and [MikuWindowState]::IsMoving($handle,$process.Id)
    if($null -eq $lastVisible -or $lastVisible -ne $visible -or $lastMoving -ne $moving -or -not [object]::Equals($lastUnresponsive,$unresponsive)){
      @{visible=$visible;unresponsive=$unresponsive;moving=$moving}|ConvertTo-Json -Compress
      $lastVisible=$visible;$lastUnresponsive=$unresponsive
      $lastMoving=$moving
    }
    if(-not $visible -or $unresponsive){Start-Sleep -Seconds 1;continue}
    # Reuse the verified HWND between slower discovery and visibility checks.
    $until=[Environment]::TickCount64+950
    do{
      Start-Sleep -Milliseconds 65
      $moving=[MikuWindowState]::IsMoving($handle,$process.Id)
      if($lastMoving -ne $moving){
        @{visible=$visible;unresponsive=$unresponsive;moving=$moving}|ConvertTo-Json -Compress
        $lastMoving=$moving
      }
    }while([Environment]::TickCount64 -lt $until)
  }
}finally{$process.Dispose()}
