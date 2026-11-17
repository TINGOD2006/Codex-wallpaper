$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/companion-hosts.ps1')
$before=[pscustomobject]@{ProcessId=41;CreationDate=[datetime]'2026-10-30T01:00:00Z';ExecutablePath='C:\Official\v1\ChatGPT.exe';CommandLine='ChatGPT.exe'}
$after=[pscustomobject]@{ProcessId=52;CreationDate=[datetime]'2026-10-30T01:01:00Z';ExecutablePath='C:\Official\v2\ChatGPT.exe';CommandLine='ChatGPT.exe --remote-debugging-port=0'}
$package=@{appPath='C:\Official\v2\ChatGPT.exe';appVersion='99.1.2.3'}
$candidates=@(Find-CompanionHostCandidates -Package $package -Processes @($before,$after))
if($candidates.Count -ne 1 -or $candidates[0].pid -ne 52 -or -not $candidates[0].managed){throw 'Stale package path selected'}
$normal=$after.PSObject.Copy();$normal.CommandLine='ChatGPT.exe'
if((Find-CompanionHostCandidates -Package $package -Processes @($normal)).managed){throw 'Normal entry treated as connectable'}
$wrong=$after.PSObject.Copy();$wrong.CreationDate=$after.CreationDate.AddSeconds(1)
if((Find-CompanionHostCandidates -Package $package -Processes @($wrong)).startTime -eq $candidates[0].startTime){throw 'PID reuse not distinguished'}
$later=Find-CompanionHostCandidates -Package $package -Processes @($wrong)
$handoff=@(Select-CompanionLaunchCandidates -Candidates @($candidates[0],$later) -StartedTicks $wrong.CreationDate.ToUniversalTime().Ticks)
if($handoff.Count -ne 1 -or $handoff[0].startTime -ne $later.startTime){throw 'Launch handoff selected an older root'}
$project=Split-Path $PSScriptRoot;$fixture=Join-Path $project ('.state/package-scan-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path (Join-Path $fixture 'app') -Force|Out-Null;[IO.File]::WriteAllText((Join-Path $fixture 'app/ChatGPT.exe'),'owned fixture')
$script:packageRequests=[Collections.Generic.List[string]]::new()
function Get-AppxPackage {param($Name)$script:packageRequests.Add($Name);[pscustomobject]@{InstallLocation=$fixture;Version=[version]'99.1.2.3';PackageFamilyName='OwnedFixture_test'}}
$focused=@(Get-CompanionPackages -HostId 'codex-desktop')
if($focused.Count -ne 1 -or $focused[0].id -ne 'codex-desktop' -or $script:packageRequests.Count -ne 1 -or $script:packageRequests[0] -ne 'OpenAI.Codex'){throw 'Codex entry scanned unrelated packages or lost official metadata'}
$script:packageRequests.Clear();$all=@(Get-CompanionPackages)
if($all.Count -ne 2 -or $script:packageRequests.Count -ne 2){throw 'General discovery lost its other supported package'}

$family='OpenAI.Codex_2p2nqsd0c76g0'
$oldPath=Join-Path $env:ProgramFiles 'WindowsApps/OpenAI.Codex_26.1106.6628.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe'
$registeredPath=Join-Path $env:ProgramFiles 'WindowsApps/OpenAI.Codex_26.1111.2228.0_x64__2p2nqsd0c76g0/app/ChatGPT.exe'
$registered=@{id='codex-desktop';packageFamily=$family;appVersion='26.1111.2228.0';appPath=$registeredPath}
$survivingRoot=$after.PSObject.Copy()
$survivingRoot.ExecutablePath=$oldPath
$wrongPublisher=$survivingRoot.PSObject.Copy()
$wrongPublisher.ExecutablePath=$oldPath.Replace('2p2nqsd0c76g0','badpublisher')
$copyOutsideStore=$survivingRoot.PSObject.Copy()
$copyOutsideStore.ExecutablePath=Join-Path $fixture (Split-Path $oldPath -Leaf)
$child=$survivingRoot.PSObject.Copy()
$child.CommandLine+=' --type=renderer'
$script:updatedWindowsProcesses=@($survivingRoot,$wrongPublisher,$copyOutsideStore,$child)
function Get-CimInstance {param($ClassName,$Filter)$script:updatedWindowsProcesses}
$resolved=Get-CompanionSnapshot -Packages @($registered)
if($resolved.appVersion -ne '26.1106.6628.0' -or $resolved.appPath -ne $oldPath -or
   $resolved.processes.Count -ne 1 -or $resolved.processes[0].pid -ne $survivingRoot.ProcessId -or
   $registered.appPath -ne $registeredPath){throw 'Package refresh did not preserve the actual old process identity'}
$script:updatedWindowsProcesses=@()
$empty=Get-CompanionSnapshot -Packages @($registered)
if($empty.appPath -ne $registeredPath -or $empty.processes.Count){throw 'Fresh launch did not retain the current registration'}
Write-Output 'PASS: running official MSIX survives registration update, foreign paths rejected, next cold launch uses current version'
