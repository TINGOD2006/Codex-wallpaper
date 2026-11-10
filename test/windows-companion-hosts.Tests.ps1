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
Write-Output 'PASS: versioned paths, normal launch and process creation identity'
