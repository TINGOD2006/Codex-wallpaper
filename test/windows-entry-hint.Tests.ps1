$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/companion-hosts.ps1')
. (Join-Path $PSScriptRoot '../scripts/codex-entry-hint.ps1')
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/entry-hint-'+[guid]::NewGuid().ToString('N'));$hintPath=Join-Path $root 'entry-host.json';$created=[DateTime]::UtcNow.AddMinutes(-1)
$appPath=Join-Path $env:ProgramFiles 'WindowsApps/OpenAI.Codex_99.1.2.3_x64__2p2nqsd0c76g0/app/ChatGPT.exe'
$package=@{id='codex-desktop';appPath=$appPath;appVersion='99.1.2.3';packageFamily='OpenAI.Codex_2p2nqsd0c76g0'}
$script:rows=@([pscustomobject]@{ProcessId=424242;ExecutablePath=$appPath;CreationDate=$created;CommandLine='ChatGPT.exe --remote-debugging-port=0'});$script:queries=0
function Get-CimInstance {param($ClassName,$Filter)$script:queries++;return $script:rows}
Write-CodexHostHint -HintPath $hintPath -Package $package -ProcessId 424242 -StartTime $created.Ticks.ToString()
$saved=[IO.File]::ReadAllText($hintPath)|ConvertFrom-Json;$now=[DateTime]::UtcNow.AddSeconds(1)
$result=Get-CodexHostHint -HintPath $hintPath -Now $now
if(-not $result -or $result.process.pid -ne 424242 -or $script:queries -ne 1){throw 'Fresh verified hint was not accepted with one process query'}
Write-CodexHostHint -HintPath $hintPath -Package $package -ProcessId 424242 -StartTime $created.Ticks.ToString() -CheckedAt $now.AddMinutes(-10)
if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Rewriting a hint extended stale package authority'}
$saved|ConvertTo-Json|Set-Content -LiteralPath $hintPath -Encoding utf8
$count=$script:queries;if(Get-CodexHostHint -HintPath $hintPath -Now $now.AddMinutes(6)){throw 'Expired hint accepted'};if($script:queries -ne $count){throw 'Expired hint performed unnecessary process discovery'}
$original=$script:rows[0];$wrong=$original.PSObject.Copy();$wrong.CreationDate=$created.AddSeconds(1);$script:rows=@($wrong)
if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Reused PID accepted'}
$wrong=$original.PSObject.Copy();$wrong.CommandLine+=' --user-data-dir=C:\OwnedFixture';$script:rows=@($wrong)
if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Isolated profile accepted as native root'}
$second=$original.PSObject.Copy();$second.ProcessId=424243;$script:rows=@($original,$second)
if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Ambiguous roots accepted'}
$second.ExecutablePath=$appPath.Replace('99.1.2.3','99.1.2.4');$script:rows=@($original,$second)
if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Version transition skipped authoritative discovery'}
$script:rows=@($original)
foreach($field in @('appPath','packageFamily','appVersion')){
 $bad=$saved.PSObject.Copy();$bad.$field=if($field -eq 'appPath'){'C:\Users\OwnedFixture\ChatGPT.exe'}else{'unexpected'}
 $bad|ConvertTo-Json|Set-Content -LiteralPath $hintPath -Encoding utf8
 if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw ('Wrong trusted identity accepted: '+$field)}
}
foreach($text in @('{bad',('x'*9000))){[IO.File]::WriteAllText($hintPath,$text);if(Get-CodexHostHint -HintPath $hintPath -Now $now){throw 'Malformed hint accepted'}}
'PASS: one-query reuse, expiry, version transition, PID reuse, isolated/ambiguous roots and forged/corrupt identity rejection'
