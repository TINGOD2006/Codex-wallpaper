$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$fixture=Join-Path $project '.state/passive-host-fixture';$app=Join-Path $fixture 'app'
New-Item -ItemType Directory -Path $app -Force|Out-Null
# An owned placeholder cannot launch any real application, even on regression.
[IO.File]::WriteAllText((Join-Path $app 'ChatGPT.exe'),'owned passive-connection fixture')
function Get-AppxPackage {param([string]$Name)if($Name -eq 'OpenAI.Codex'){[pscustomobject]@{InstallLocation=$fixture;Version=[version]'99.1.2.3';PackageFamilyName='PassiveFixture_test'}}}
function Get-CimInstance {param($ClassName,$Filter)@()}
$script:starts=0
function Start-Process {$script:starts++;throw 'Passive connector attempted native startup'}
$reply=& (Join-Path $project 'scripts/companion-launch-host.ps1') -ConnectOnly -StateRoot (Join-Path $fixture 'sessions')|ConvertFrom-Json
if($reply.ok -or $reply.error.code -ne 'HOST_IDENTITY_CHANGED'){throw 'Passive absence was not recognized'}
if($script:starts -ne 0){throw 'Passive connector started an application'}
'PASS: passive connector never launches a missing host or bypasses the cold-start animation entry'
