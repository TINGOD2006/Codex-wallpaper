$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$companionLauncher=Join-Path (Get-CompanionInstallRoot) 'app/scripts/start-companion.ps1'
if(-not(Test-Path -LiteralPath $companionLauncher)){throw '請先執行安裝獨立桌布插件.cmd。'}
& $companionLauncher -Action Show
