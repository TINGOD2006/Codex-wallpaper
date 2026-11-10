$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$fixture=Join-Path $project ('.state/endpoint-pending-'+[guid]::NewGuid().ToString('N'));$app=Join-Path $fixture 'app';New-Item -ItemType Directory -Path $app -Force|Out-Null
[IO.File]::WriteAllText((Join-Path $app 'ChatGPT.exe'),'owned test placeholder')
$created=[DateTime]::UtcNow.AddSeconds(-5)
function Get-AppxPackage {param([string]$Name)if($Name -eq 'OpenAI.Codex'){[pscustomobject]@{InstallLocation=$fixture;Version=[version]'99.1.2.3';PackageFamilyName='PendingFixture_test'}}}
function Get-CimInstance {param($ClassName,$Filter)[pscustomobject]@{ProcessId=123456;ExecutablePath=(Join-Path $app 'ChatGPT.exe');CommandLine='ChatGPT.exe --remote-debugging-port=0';CreationDate=$created}}
function Get-NetTCPConnection {param($OwningProcess,$LocalPort,$RemotePort,$ErrorAction)@()}
function Add-Type {param($Path)throw 'Owned native provider unavailable; use empty fixture provider'}
function Start-Process {throw 'Pending endpoint check must not launch a process'}
$reply=& (Join-Path $project 'scripts/companion-launch-host.ps1') -ConnectOnly -StateRoot (Join-Path $fixture 'sessions')|ConvertFrom-Json
if($reply.ok -or $reply.error.code -ne 'HOST_ENDPOINT_PENDING'){throw 'Temporary absence was falsely marked unsupported'}
if(@(Get-ChildItem -LiteralPath $fixture -Recurse -Filter session.json).Count){throw 'Unverified endpoint was reported as connected'}
'PASS: verified native process without an endpoint stays pending, never unsupported or falsely connected'
