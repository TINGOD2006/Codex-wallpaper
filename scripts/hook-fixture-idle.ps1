param([Parameter(Mandatory)][string]$FixtureRoot)
$ErrorActionPreference='Stop'
$base=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.state/original-hook'))
$fixture=[IO.Path]::GetFullPath($FixtureRoot)
if((Split-Path $fixture) -ne $base -or (Split-Path $fixture -Leaf) -notmatch '^[a-f0-9-]{36}$'){throw 'HOOK_FIXTURE_UNSAFE'}
$running=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($fixture+'\',[StringComparison]::OrdinalIgnoreCase)})
if($running.Count){throw 'HOOK_FIXTURE_ALREADY_RUNNING'}
[Console]::WriteLine('idle')
