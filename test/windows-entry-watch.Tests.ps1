$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/entry-watch-'+[guid]::NewGuid().ToString('N'));$runtime=Join-Path $root 'runtime';New-Item -ItemType Directory -Path $runtime -Force|Out-Null
$install=Join-Path $env:ProgramFiles 'WindowsApps/OpenAI.Codex_99.1.2.3_x64__2p2nqsd0c76g0';$exe=Join-Path $install 'app/ChatGPT.exe';$created=[DateTime]::UtcNow.AddMinutes(-1)
function Get-AppxPackage {param($Name)if($Name -eq 'OpenAI.Codex'){[pscustomobject]@{InstallLocation=$install;Version=[version]'99.1.2.3';PackageFamilyName='OpenAI.Codex_2p2nqsd0c76g0'}}}
function Test-Path {param($LiteralPath,$PathType)if($LiteralPath -eq $exe){return $true};return [IO.File]::Exists($LiteralPath) -or [IO.Directory]::Exists($LiteralPath)}
function Get-CimInstance {param($ClassName,$Filter)[pscustomobject]@{ProcessId=424242;ExecutablePath=$exe;CreationDate=$created;CommandLine='ChatGPT.exe --remote-debugging-port=0'}}
function Start-Sleep {param($Seconds)throw 'Owned watch completed one iteration'}
try{& (Join-Path $project 'scripts/companion-hosts.ps1') -Operation Watch -RuntimeRoot $runtime|Out-Null}catch{if($_.Exception.Message -ne 'Owned watch completed one iteration'){throw}}
$hint=Get-Content -LiteralPath (Join-Path $runtime 'entry-host.json') -Raw|ConvertFrom-Json
if($hint.pid -ne 424242 -or $hint.startTime -ne $created.ToUniversalTime().Ticks.ToString() -or $hint.appVersion -ne '99.1.2.3'){throw 'Existing authoritative watch did not publish the entry hint'}
if(([DateTime]::UtcNow-([DateTimeOffset]$hint.checkedAt).UtcDateTime).TotalSeconds -gt 10){throw 'Watch hint did not retain its package discovery time'}
'PASS: existing host watcher publishes a fresh, scoped hint without a new process or extra discovery'
