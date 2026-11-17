$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/entry-feedback-'+[guid]::NewGuid().ToString('N'));$scripts=Join-Path $root 'app/scripts';New-Item -ItemType Directory -Path $scripts -Force|Out-Null
foreach($name in @('ensure-codex-visible.ps1','codex-entry-hint.ps1')){Copy-Item -LiteralPath (Join-Path $project ('scripts/'+$name)) -Destination (Join-Path $scripts $name)}
@'
function Get-CompanionPackages {param($HostId)$context.events.Add('package');@{appPath='C:\OwnedFixture\ChatGPT.exe';appVersion='99.1.2.3';packageFamily='OwnedFixture_test'}}
function Get-CompanionSnapshot {param($Packages)@{processes=$context.roots;appPath=$context.current.ExecutablePath}}
function Find-CompanionHostCandidates {param($Package,$Processes)if($Processes.Count -eq 1 -and $Processes[0].ExecutablePath -eq $Package.appPath){$context.roots}}
function Select-CompanionRootCandidates {param($Candidates)$Candidates}
'@|Set-Content -LiteralPath (Join-Path $scripts 'companion-hosts.ps1') -Encoding utf8
function Get-CimInstance {param($ClassName,$Filter)if($Filter -like 'ProcessId=*'){return $context.current};return $context.raw}
function Start-Process {
 param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
 if($FilePath -ne 'C:\OwnedFixture\ChatGPT.exe' -or ($ArgumentList -join ',') -ne '--remote-debugging-address=127.0.0.1,--remote-debugging-port=0'){
  throw 'Cold entry did not request the loopback endpoint on its verified host'
 }
 $context.events.Add('native')
 [pscustomobject]@{Id=123456;StartTime=[DateTime]::UtcNow}
}
function Invoke-CodexNativeActivation {
 param($Package,[int]$ExpectedProcessId)
 if($Package.packageFamily -notin @('OwnedFixture_test','OpenAI.Codex_2p2nqsd0c76g0') -or $ExpectedProcessId -ne 123456){throw 'Unexpected native activation target'}
 $context.events.Add('activate')
}
$created=[DateTime]::UtcNow;$current=[pscustomobject]@{ProcessId=123456;CreationDate=$created;ExecutablePath='C:\OwnedFixture\ChatGPT.exe';CommandLine='ChatGPT.exe --remote-debugging-port=0'}
$context=[pscustomobject]@{events=[Collections.Generic.List[string]]::new();roots=@();raw=@();current=$current}
$callback={$context.events.Add('animation')};$entry=Join-Path $scripts 'ensure-codex-visible.ps1'
& $entry -UseHostHint -OnColdStart $callback
if(($context.events -join ',') -ne 'animation,package,native'){throw 'Cold feedback did not precede package lookup exactly once'}
$context.events.Clear();& $entry -UseHostHint -ExistingOnly -OnColdStart $callback
if(($context.events -join ',') -ne 'package'){throw 'Duplicate existing-only entry launched or animated an absent host'}
$context.events.Clear();$context.raw=@($current);$context.roots=@(@{pid=123456;startTime=$created.ToUniversalTime().Ticks.ToString();managed=$true})
& $entry -UseHostHint -OnColdStart $callback
if(($context.events -join ',') -ne 'package,activate'){throw 'Existing host received cold feedback'}
# A concurrent native start after the early probe is reused, never duplicated.
$context.events.Clear();$context.raw=@();& $entry -UseHostHint -OnColdStart $callback
if(($context.events -join ',') -ne 'animation,package,activate'){throw 'Concurrent native start was not reused'}
$context.events.Clear();$context.raw=@($current);$context.current=$null
& $entry -UseHostHint -OnColdStart $callback
if(($context.events -join ',') -ne 'package,activate'){throw 'A closing process blocked the explicit shortcut'}
$context.events.Clear();& $entry -UseHostHint -ExistingOnly -OnColdStart $callback
if(($context.events -join ',') -ne 'package'){throw 'A stale existing-only entry tried to reopen the host'}

. (Join-Path $scripts 'codex-entry-hint.ps1')
$hintApp=Join-Path $env:ProgramFiles 'WindowsApps/OpenAI.Codex_99.1.2.3_x64__2p2nqsd0c76g0/app/ChatGPT.exe'
$hintPackage=@{appPath=$hintApp;appVersion='99.1.2.3';packageFamily='OpenAI.Codex_2p2nqsd0c76g0'}
$hintProcess=$current.PSObject.Copy();$hintProcess.ExecutablePath=$hintApp;$context.raw=@($hintProcess)
Write-CodexHostHint -HintPath (Join-Path $root 'runtime/entry-host.json') -Package $hintPackage -ProcessId 123456 -StartTime $context.roots[0].startTime
$context.events.Clear();& $entry -UseHostHint -OnColdStart $callback -OnExistingWindow {param($usedHint)if(-not $usedHint){throw 'Valid hint was skipped'};$context.events.Add('hint')}
if(($context.events -join ',') -ne 'activate,hint'){throw 'The hint path bypassed the managed native activation'}
'PASS: cold feedback, existing-only absence, requested activation while closing, and native activation through the verified hint'
