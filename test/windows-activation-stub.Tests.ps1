$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/companion-hosts.ps1')
$now=[DateTime]::UtcNow.Ticks;$old=@{pid=1;startTime=($now-[TimeSpan]::FromMinutes(5).Ticks).ToString();managed=$true};$stub=@{pid=2;startTime=($now-[TimeSpan]::FromSeconds(1).Ticks).ToString();managed=$false}
$roots=@(Select-CompanionRootCandidates -Candidates @($old,$stub) -NowTicks $now -HasWindow {$false})
if($roots.Count -ne 1 -or $roots[0].pid -ne 1){throw 'Transient forwarding process invalidated the managed host'}
if(@(Select-CompanionRootCandidates -Candidates @($old,$stub) -NowTicks $now -HasWindow {$true}).Count -ne 2){throw 'Actual second window was hidden'}
if(@(Select-CompanionRootCandidates -Candidates @($old,$stub) -NowTicks ($now+[TimeSpan]::FromSeconds(6).Ticks) -HasWindow {$false}).Count -ne 2){throw 'Persistent ambiguous process was hidden'}
if(@(Select-CompanionRootCandidates -Candidates @($stub) -NowTicks $now -HasWindow {$false}).Count -ne 1){throw 'The only official root was discarded'}
$secondManaged=$stub.Clone();$secondManaged.managed=$true
if(@(Select-CompanionRootCandidates -Candidates @($old,$secondManaged) -NowTicks $now -HasWindow {$false}).Count -ne 2){throw 'Multiple managed roots were hidden'}
$hasMain={param($id)$id -eq $old.pid}
$roots=@(Select-CompanionRootCandidates -Candidates @($old,$secondManaged) -NowTicks $now -HasWindow $hasMain)
if($roots.Count -ne 1 -or $roots[0].pid -ne $old.pid){throw 'Fresh managed activation forwarder invalidated the established window'}
if(@(Select-CompanionRootCandidates -Candidates @($old,$secondManaged) -NowTicks $now -HasWindow {$true}).Count -ne 2){throw 'Actually windowed managed ambiguity was hidden'}
if(@(Select-CompanionRootCandidates -Candidates @($old,$secondManaged) -NowTicks ($now+[TimeSpan]::FromSeconds(6).Ticks) -HasWindow $hasMain).Count -ne 2){throw 'Persistent managed ambiguity was hidden'}
if(@(Select-CompanionRootCandidates -Candidates @($old,$secondManaged) -NowTicks $now -HasWindow {param($id)$id -eq $secondManaged.pid}).Count -ne 2){throw 'An older unwindowed process was misclassified as forwarding'}
'PASS: short managed and ordinary activation forwarders preserve the established UI; windowed, persistent or unproven ambiguity remains visible'
