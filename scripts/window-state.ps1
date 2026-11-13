param([string]$IdentityPath)
$ErrorActionPreference='Stop'
$monitorIdentityPath=$IdentityPath
. (Join-Path $PSScriptRoot 'windows-session.ps1')
. (Join-Path $PSScriptRoot 'window-activation.ps1')
. (Join-Path $PSScriptRoot 'codex-native-activation.ps1')
$identity=Get-Content -LiteralPath $monitorIdentityPath -Raw | ConvertFrom-Json
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MikuWindowState { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
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
  $lastVisible=$null;$lastUnresponsive=$null
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
      $package=@(Get-AppxPackage -Name OpenAI.Codex)
      if((!$pinned -or !$process.HasExited) -and $package.Count -eq 1 -and [IO.Path]::GetFullPath((Join-Path $package[0].InstallLocation 'app/ChatGPT.exe')) -eq [IO.Path]::GetFullPath($identity.appPath)){Invoke-CodexNativeActivation -Package @{packageFamily=$package[0].PackageFamilyName} -OnlyIfForeground $handle}
     }catch{[Console]::Error.WriteLine('NATIVE_RESTORE_ACTIVATION_FAILED')}
    }
    if(-not $unresponsive){$wasIconic=$iconic}
    if($null -eq $lastVisible -or $lastVisible -ne $visible -or -not [object]::Equals($lastUnresponsive,$unresponsive)){
      @{visible=$visible;unresponsive=$unresponsive}|ConvertTo-Json -Compress
      $lastVisible=$visible;$lastUnresponsive=$unresponsive
    }
    Start-Sleep -Seconds 1
  }
}finally{$process.Dispose()}
