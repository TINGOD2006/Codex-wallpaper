param([scriptblock]$OnColdStart,[scriptblock]$OnExistingWindow,[switch]$ExistingOnly,[switch]$UseHostHint)
# Runs in the user-clicked launcher, before wallpaper initialization.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-hosts.ps1')
$coldRequested=$false
if($UseHostHint){
 . (Join-Path $PSScriptRoot 'codex-entry-hint.ps1')
 $hintPath=Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'runtime/entry-host.json'
 $hint=Get-CodexHostHint -HintPath $hintPath
 if($hint){try{
  if(-not (Get-Command Invoke-CodexNativeActivation -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'codex-native-activation.ps1')}
  Invoke-CodexNativeActivation -Package $hint.package
  if($OnExistingWindow){& $OnExistingWindow $true}
  return
 }catch{# A stale registration/activation result receives a full rediscovery.
 }}
}
if($UseHostHint -and -not $ExistingOnly -and $OnColdStart){
 # Start visual feedback while the slower package lookup runs. Any existing
 # root conservatively keeps the authoritative hot/cold decision below.
 $earlyCold=$false
 try{$earlyRoots=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine -notmatch '--type=|--user-data-dir='});$earlyCold=$earlyRoots.Count -eq 0}catch{# Optional feedback probe must not block authoritative discovery.
 }
 if($earlyCold){& $OnColdStart 'cold-start';$coldRequested=$true}
}
$packages=@(Get-CompanionPackages -HostId 'codex-desktop')
if($packages.Count -ne 1){throw '找不到唯一的原版 Codex 安裝。'}
$package=$packages[0]
$snapshot=Get-CompanionSnapshot -Packages @($package)
$roots=@($snapshot.processes)
if($roots.Count -eq 0){
 if($ExistingOnly){return}
 if($OnColdStart -and -not $coldRequested){& $OnColdStart 'cold-start'}
 $child=Start-Process -FilePath $package.appPath -ArgumentList @('--remote-debugging-address=127.0.0.1','--remote-debugging-port=0') -WindowStyle Normal -PassThru
 if($UseHostHint){try{Write-CodexHostHint -HintPath $hintPath -Package $package -ProcessId $child.Id -StartTime $child.StartTime.ToUniversalTime().Ticks.ToString()}catch{}}
 # Wallpaper attaches to this official instance; it does not start a second one.
 return
}
if($roots.Count -ne 1){throw '目前有多個原版主程序，請等待啟動完成。'}
$candidate=$roots[0]
$current=Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.pid)"
if(-not $current -or $current.ExecutablePath -ne $package.appPath -or $current.CreationDate.ToUniversalTime().Ticks.ToString() -ne $candidate.startTime){throw 'Codex 視窗程序已變更，請重試。'}
if($OnExistingWindow){& $OnExistingWindow $false}
# Activate the official app contract. Showing its HWND alone can leave the
# native tray/lifecycle state hidden even though Windows paints a restored UI.
if(-not (Get-Command Invoke-CodexNativeActivation -ErrorAction SilentlyContinue)){. (Join-Path $PSScriptRoot 'codex-native-activation.ps1')}
Invoke-CodexNativeActivation -Package $package
if($UseHostHint){Write-CodexHostHint -HintPath $hintPath -Package $package -ProcessId $candidate.pid -StartTime $candidate.startTime}
