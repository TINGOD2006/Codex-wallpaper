param([string]$SourceRoot=(Join-Path $PSScriptRoot '../dist/companion/app'),[switch]$SkipPlugin)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$root=Get-CompanionInstallRoot
# Install the same application payload without opening the legacy manager or
# creating its shortcuts. Existing settings and the official app are preserved.
& (Join-Path $PSScriptRoot 'start-install.ps1') -SourceRoot $SourceRoot -InstallRoot $root -NoShortcuts -SkipPlugin:$SkipPlugin
& (Join-Path $root 'app/scripts/install-codex-taskbar-entry.ps1')
& (Join-Path $root 'app/scripts/install-codex-user-shortcuts.ps1')
Write-Output '已安裝整合入口。請使用桌面或開始功能表的 Codex；工作列首次使用需釘選 data/entry-assets/Codex.lnk。'
