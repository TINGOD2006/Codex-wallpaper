$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/entry-feedback-'+[guid]::NewGuid().ToString('N'));$scripts=Join-Path $root 'app/scripts';New-Item -ItemType Directory -Path $scripts -Force|Out-Null
foreach($name in @('ensure-codex-visible.ps1','codex-entry-hint.ps1')){Copy-Item -LiteralPath (Join-Path $project ('scripts/'+$name)) -Destination (Join-Path $scripts $name)}
@'
function Get-CompanionPackages {param($HostId)$context.events.Add('package');@{appPath='C:\OwnedFixture\ChatGPT.exe';appVersion='99.1.2.3';packageFamily='OwnedFixture_test'}}
function Get-CompanionSnapshot {param($Packages)@{processes=$context.roots}}
'@|Set-Content -LiteralPath (Join-Path $scripts 'companion-hosts.ps1') -Encoding utf8
function Get-CimInstance {param($ClassName,$Filter)if($Filter -like 'ProcessId=*'){return $context.current};return $context.raw}
function Start-Process {param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)$context.events.Add('native');[pscustomobject]@{Id=123456;StartTime=[DateTime]::UtcNow}}
function Invoke-CodexNativeActivation {param($Package)if($Package.packageFamily -ne 'OwnedFixture_test'){throw 'Unexpected target'};$context.events.Add('activate')}
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
'PASS: immediate cold feedback, no duplicate animation/host, background reuse and concurrent-start handoff'
