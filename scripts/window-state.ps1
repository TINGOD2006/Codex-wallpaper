param([string]$IdentityPath)
$ErrorActionPreference='Stop'
$monitorIdentityPath=$IdentityPath
. (Join-Path $PSScriptRoot 'windows-session.ps1')
. (Join-Path $PSScriptRoot 'window-activation.ps1')
. (Join-Path $PSScriptRoot 'codex-native-activation.ps1')
$identity=Get-Content -LiteralPath $monitorIdentityPath -Raw | ConvertFrom-Json
Confirm-ThemeSession $identity
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MikuWindowState { [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$wasIconic=$false
while($true){
  $desktop=Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
  $owned=Get-ThemeProcess $identity.pid
  if(-not $desktop -or -not $owned -or $owned.CreationDate.ToUniversalTime().Ticks.ToString() -ne [string]$identity.startTime){break}
  $handle=[CodexWindowActivation]::Find([int]$identity.pid)
  $iconic=$handle -ne 0 -and [MikuWindowState]::IsIconic($handle)
  $visible=$handle -ne 0 -and [MikuWindowState]::IsWindowVisible($handle) -and -not $iconic
  if($wasIconic -and $visible -and [MikuWindowState]::GetForegroundWindow() -eq $handle){
   try{
    $package=@(Get-AppxPackage -Name OpenAI.Codex)
    if($package.Count -eq 1 -and [IO.Path]::GetFullPath((Join-Path $package[0].InstallLocation 'app/ChatGPT.exe')) -eq [IO.Path]::GetFullPath($identity.appPath)){Invoke-CodexNativeActivation -Package @{packageFamily=$package[0].PackageFamilyName} -OnlyIfForeground $handle}
   }catch{[Console]::Error.WriteLine('NATIVE_RESTORE_ACTIVATION_FAILED')}
  }
  $wasIconic=$iconic
  @{visible=$visible}|ConvertTo-Json -Compress
  Start-Sleep -Seconds 1
}
