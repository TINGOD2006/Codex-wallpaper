param([ValidateSet('Show','Start','Exit')][string]$Action='Show',[switch]$Integrated,[switch]$Quiet,[switch]$SettleLaunch)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
try{
 if($SettleLaunch -and ($Action -ne 'Start' -or -not $Integrated)){throw 'SettleLaunch requires integrated Start'}
 $node=(Get-Command node -ErrorAction Stop).Source
 $command=Join-Path $projectRoot 'src/companion/command.cjs'
 $operation=switch($Action){'Exit'{'exit'};'Show'{'show-window'};'Start'{'status'}}
 $result=& $node $command $operation 2>$null
 if($LASTEXITCODE -eq 0){
  $existing=$result|ConvertFrom-Json
  if(-not $Integrated -or $existing.state.mode -eq 'integrated' -or $Action -eq 'Exit'){$result;return}
  & $node $command exit 2>$null | Out-Null
  if($LASTEXITCODE -ne 0){throw '無法正常停止舊桌布服務。'}
  $descriptor=Join-Path (Get-CompanionInstallRoot) 'runtime/manager.json'
  for($n=0;$n -lt 80 -and (Test-Path -LiteralPath $descriptor);$n++){Start-Sleep -Milliseconds 100}
  if(Test-Path -LiteralPath $descriptor){throw '舊桌布服務仍在清理，請稍後再試。'}
  Start-Sleep -Milliseconds 500
 }

 if($Action -eq 'Exit'){throw '管理器目前未運行。'}
 $installed=Join-Path (Get-CompanionInstallRoot) 'app'
 if([IO.Path]::GetFullPath($projectRoot) -ne $installed){throw '請先執行獨立管理器安裝入口，再使用此啟動器。'}
 . (Join-Path $PSScriptRoot 'windows-independent.ps1')
 $workerScript=if($Integrated){'companion-integrated-worker.ps1'}else{'companion-worker.ps1'}
 $worker=Start-ThemeIndependentProcess -PowerShellPath (Get-Process -Id $PID).Path -ScriptPath (Join-Path $PSScriptRoot $workerScript) -WorkingDirectory $projectRoot
 # One waiting Node client, not a fresh Node + PowerShell identity check per poll.
 # Keep a single argument as an array: splatting a scalar string expands its
 # characters, turning wait-ready into separate letters on the normal path.
 [string[]]$readyArgs=@('wait-ready');if($SettleLaunch){$readyArgs+=@('--settle-launch')}
 $result=& $node $command @readyArgs 2>$null
 if($LASTEXITCODE -eq 0){if($Action -eq 'Show'){& $node $command show-window}else{$result};return}
 if(-not(Get-CimInstance Win32_Process -Filter "ProcessId=$($worker.pid)")){throw '桌布背景服務在準備完成前退出，請查看啟動診斷。'}
 throw '管理器仍在初始化，請查看狀態視窗或啟動診斷。'
}catch{if($Quiet){throw};Add-Type -AssemblyName System.Windows.Forms;[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Codex Wallpaper');exit 1}
