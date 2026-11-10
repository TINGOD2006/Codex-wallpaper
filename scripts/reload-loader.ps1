param([string]$ProjectRoot=(Split-Path $PSScriptRoot))
$ErrorActionPreference='Stop'
$node=(Get-Command node).Source
& $node (Join-Path $ProjectRoot 'src/companion/command.cjs') reconnect
if($LASTEXITCODE -ne 0){throw '獨立管理器尚未運行；未操作任何原版程序。'}
