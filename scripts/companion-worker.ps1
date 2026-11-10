param([switch]$Headless,[switch]$Integrated)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot
$env:MIKU_PWSH=(Get-Process -Id $PID).Path
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$stateRoot=Get-CompanionInstallRoot
$lockKey=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($stateRoot)))
$mutex=[Threading.Mutex]::new($false,'Local\CodexWallpaperCompanion-'+$lockKey);$locked=$false
try{
 try{$locked=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$locked=$true}
 if(-not $locked){return}
 $node=(Get-Command node -ErrorAction Stop).Source
 $logRoot=Join-Path $stateRoot 'logs';New-Item -ItemType Directory -Path $logRoot -Force|Out-Null
 $entry=Join-Path $projectRoot 'src/companion/main.cjs'
 $parameters=@{FilePath=$node;ArgumentList=@(('"{0}"' -f $entry));WindowStyle='Hidden';PassThru=$true;RedirectStandardOutput=(Join-Path $logRoot 'startup.stdout.log');RedirectStandardError=(Join-Path $logRoot 'startup.stderr.log')}
 if($Headless){$parameters.ArgumentList+=@('--headless')}
 if($Integrated){$parameters.ArgumentList+=@('--integrated')}
 $child=Start-Process @parameters;$child.WaitForExit();if($child.ExitCode -ne 0){throw '管理器未能啟動。請檢查Node、PowerShell和Edge，或查看啟動診斷。'}
}catch{if($Headless -or $Integrated){Write-Error $_;exit 1};Add-Type -AssemblyName System.Windows.Forms;[void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Codex Wallpaper 啟動失敗')}finally{if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
