param([ValidateSet('Minimize','Restore','Measure')][string]$Operation)
$ErrorActionPreference='Stop'
$testWindowOperation=$Operation
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $projectRoot 'scripts/windows-session.ps1')
$identity=Get-Content -LiteralPath (Join-Path $projectRoot '.state/session.json') -Raw|ConvertFrom-Json
if($identity.mode -ne 'Isolated'){throw 'This check only operates the owned isolated test window'}
Confirm-ThemeSession $identity -RequirePort
if($testWindowOperation -eq 'Measure'){
 $all=@(Get-CimInstance Win32_Process);$owned=[Collections.Generic.HashSet[int]]::new();[void]$owned.Add([int]$identity.daemonPid)
 do{$added=$false;foreach($p in $all){if($owned.Contains([int]$p.ParentProcessId) -and $owned.Add([int]$p.ProcessId)){$added=$true}}}while($added)
 $processes=@($owned|ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue});$before=($processes|Measure-Object CPU -Sum).Sum;$watch=[Diagnostics.Stopwatch]::StartNew();Start-Sleep -Milliseconds 1500
 $after=@($owned|ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue});$elapsed=$watch.Elapsed.TotalSeconds
 @{processes=$after.Count;workingSetMiB=[Math]::Round(($after|Measure-Object WorkingSet64 -Sum).Sum/1MB,1);cpuPercentOfMachine=[Math]::Round(((($after|Measure-Object CPU -Sum).Sum-$before)/$elapsed/[Environment]::ProcessorCount)*100,1);sampleSeconds=[Math]::Round($elapsed,2)}|ConvertTo-Json -Compress
}else{
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WallpaperTestWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int command); }'
 $handle=(Get-Process -Id $identity.pid).MainWindowHandle;if($handle -eq 0){throw 'No isolated window handle'}
 [void][WallpaperTestWindow]::ShowWindowAsync($handle,$(if($testWindowOperation -eq 'Minimize'){6}else{9}));@{requested=$testWindowOperation}|ConvertTo-Json -Compress
}
