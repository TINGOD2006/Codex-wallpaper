param([ValidateSet('Scan','Watch')][string]$Operation='Scan',[string]$RuntimeRoot)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'codex-entry-hint.ps1')

function Get-CompanionProcessVersion {
 param($Package,[string]$AppPath)
 if(-not $AppPath){return}
 if($AppPath -eq $Package.appPath){return $Package.appVersion}
 # A Store update can register a new path while the old executable is still
 # mapped. Require the same official Codex family and a protected versioned
 # WindowsApps path for both executables. The process path comes from CIM.
 if($Package.id -eq 'codex-desktop' -and $Package.packageFamily -eq 'OpenAI.Codex_2p2nqsd0c76g0' -and $Package.appVersion -and
    (Get-CodexHintVersion $Package.appPath) -eq $Package.appVersion){
  return Get-CodexHintVersion $AppPath
 }
}

function Find-CompanionHostCandidates {
 param($Package,[object[]]$Processes)
 foreach($candidate in $Processes){
  if(-not $candidate.CommandLine -or $candidate.CommandLine -match '--type=|--user-data-dir='){continue}
  $version=Get-CompanionProcessVersion -Package $Package -AppPath $candidate.ExecutablePath
  if(-not $version){continue}
  @{
   pid=[int]$candidate.ProcessId
   startTime=$candidate.CreationDate.ToUniversalTime().Ticks.ToString()
   managed=$candidate.CommandLine.Contains('--remote-debugging-port=0')
   appPath=$candidate.ExecutablePath
   appVersion=$version
  }
 }
}
function Get-CompanionPackages {
 param([ValidateSet('codex-desktop','chatgpt-desktop')][string]$HostId)
 foreach($item in @(@{name='OpenAI.Codex';id='codex-desktop';kind='codex-desktop'},@{name='OpenAI.ChatGPT-Desktop';id='chatgpt-desktop';kind='chatgpt-native'})){
  if($HostId -and $item.id -ne $HostId){continue}
  foreach($installed in @(Get-AppxPackage -Name $item.name)){
   $executable=Join-Path $installed.InstallLocation 'app/ChatGPT.exe'
   if(-not(Test-Path -LiteralPath $executable -PathType Leaf)){$executable=Join-Path $installed.InstallLocation 'ChatGPT.exe'}
   if(Test-Path -LiteralPath $executable -PathType Leaf){@{id=$item.id;kind=$item.kind;packageFamily=$installed.PackageFamilyName;appPath=$executable;appVersion=$installed.Version.ToString();installed=$true}}
  }
 }
}
function Select-CompanionLaunchCandidates {
 param([object[]]$Candidates,[long]$StartedTicks,[bool]$ReuseExisting=$false)
 @($Candidates|Where-Object {$_.managed -and ($ReuseExisting -or [long]$_.startTime -ge $StartedTicks)})
}
function Select-CompanionRootCandidates {
 param([object[]]$Candidates,[long]$NowTicks=[DateTime]::UtcNow.Ticks,[scriptblock]$HasWindow)
 if($Candidates.Count -lt 2){return $Candidates}
 $managed=@($Candidates|Where-Object managed)
 if(-not $managed.Count){return $Candidates}
 if(-not $HasWindow){. (Join-Path $PSScriptRoot 'window-activation.ps1');$HasWindow={param($ProcessId)try{[CodexWindowActivation]::Find($ProcessId) -ne [IntPtr]::Zero}catch{$false}}}
 $primary=$managed[0]
 if($managed.Count -gt 1){
  # Native activation forwards the endpoint options too. Keep the established
  # window while a newer, unwindowed process has time to forward and exit.
  $windowed=@($managed|Where-Object {& $HasWindow $_.pid})
  if($windowed.Count -ne 1){return $Candidates}
  $primary=$windowed[0]
 }
 foreach($candidate in $Candidates){
  $age=$NowTicks-[long]$candidate.startTime
  if($candidate.pid -ne $primary.pid -and $age -ge 0 -and $age -lt [TimeSpan]::FromSeconds(5).Ticks -and
     (-not $candidate.managed -or [long]$candidate.startTime -gt [long]$primary.startTime) -and -not (& $HasWindow $candidate.pid)){continue}
  $candidate
 }
}
function Get-CompanionSnapshot {
 param([object[]]$Packages)
 $processes=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'")
 foreach($package in $Packages){
  $result=$package.Clone()
  $roots=@(Select-CompanionRootCandidates -Candidates @(Find-CompanionHostCandidates -Package $package -Processes $processes))
  if($roots.Count -eq 1){
   $result.appPath=$roots[0].appPath
   $result.appVersion=$roots[0].appVersion
  }
  $result.processes=$roots
  $result
 }
}
if($MyInvocation.InvocationName -ne '.'){
 if($Operation -eq 'Watch'){
  if(-not $RuntimeRoot){
   . (Join-Path $PSScriptRoot 'companion-paths.ps1')
   $installRoot=Get-CompanionInstallRoot
   if([IO.Path]::GetFullPath((Split-Path $PSScriptRoot)) -eq (Join-Path $installRoot 'app')){$RuntimeRoot=Join-Path $installRoot 'runtime'}
  }
 }
 $lastHintKey=''
 $packages=@(Get-CompanionPackages);$checked=[datetime]::UtcNow;$lastProcessCount=0
 do{
  $now=[datetime]::UtcNow
  if(($now-$checked).TotalSeconds -ge 30){$packages=@(Get-CompanionPackages);$checked=$now}
  $snapshot=@(Get-CompanionSnapshot -Packages $packages)
  $processCount=@($snapshot.processes).Count
  if($lastProcessCount -gt 0 -and $processCount -eq 0){$packages=@(Get-CompanionPackages);$checked=$now;$snapshot=@(Get-CompanionSnapshot -Packages $packages)}
  $lastProcessCount=@($snapshot.processes).Count
  if($Operation -eq 'Watch' -and $RuntimeRoot){
   $codex=@($snapshot|Where-Object id -eq 'codex-desktop')
   if($codex.Count -eq 1 -and $codex[0].processes.Count -eq 1){
    $native=$codex[0].processes[0];$hintKey=@($codex[0].appPath,$codex[0].appVersion,$native.pid,$native.startTime,$checked.Ticks) -join '|'
    if($hintKey -ne $lastHintKey){Write-CodexHostHint -HintPath (Join-Path $RuntimeRoot 'entry-host.json') -Package $codex[0] -ProcessId $native.pid -StartTime $native.startTime -CheckedAt $checked;$lastHintKey=$hintKey}
   }
  }
  if($Operation -eq 'Scan'){ConvertTo-Json -InputObject $snapshot -Depth 7 -Compress;break}
  @{type='hosts';hosts=$snapshot;sampledAt=$now.ToString('o')}|ConvertTo-Json -Depth 8 -Compress
  Start-Sleep -Seconds 1
 }while($true)
}
