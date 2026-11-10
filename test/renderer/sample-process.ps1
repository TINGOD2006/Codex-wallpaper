param([int]$RendererRoot,[int]$ReceiverRoot,[string]$ReadyFile,[int]$Seconds=16)
$ErrorActionPreference='Stop'
function TreeIds([int]$RootId,$Inventory){
  $set=[System.Collections.Generic.HashSet[int]]::new();[void]$set.Add($RootId)
  do{$changed=$false;foreach($item in $Inventory){if($set.Contains([int]$item.ParentProcessId)-and $set.Add([int]$item.ProcessId)){$changed=$true}}}while($changed)
  return @($set)
}
function Sample($Ids){
  $cpu=0.0;$bytes=0L;foreach($id in $Ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){$cpu+=$p.TotalProcessorTime.TotalSeconds;$bytes+=$p.WorkingSet64}}
  return @{cpu=$cpu;bytes=$bytes}
}
$inventory=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId
$renderIds=TreeIds $RendererRoot $inventory;$receiveIds=TreeIds $ReceiverRoot $inventory
$first=Sample $renderIds;$hostFirst=Sample $receiveIds;$watch=[Diagnostics.Stopwatch]::StartNew();$samples=@();$hostSamples=@()
[IO.File]::WriteAllText($ReadyFile,'ready')
while($watch.Elapsed.TotalSeconds -lt $Seconds){Start-Sleep -Milliseconds 1000;$samples+=Sample $renderIds;$hostSamples+=Sample $receiveIds}
$last=$samples[-1];$hostLast=$hostSamples[-1]
@{durationSeconds=$watch.Elapsed.TotalSeconds;renderer=@{cpuSeconds=$last.cpu-$first.cpu;workingSetBytes=($samples.bytes|Measure-Object -Average).Average;processCount=$renderIds.Count};receiver=@{cpuSeconds=$hostLast.cpu-$hostFirst.cpu;workingSetBytes=($hostSamples.bytes|Measure-Object -Average).Average;processCount=$receiveIds.Count}} | ConvertTo-Json -Compress -Depth 5
