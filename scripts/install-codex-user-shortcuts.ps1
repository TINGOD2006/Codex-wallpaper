param([switch]$Restore)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
. (Join-Path $PSScriptRoot 'codex-user-shortcuts.ps1')
$root=Get-CompanionInstallRoot
if([IO.Path]::GetFullPath((Split-Path $PSScriptRoot)) -ne (Join-Path $root 'app')){throw 'Run the installed shortcut installer'}
$packages=@(Get-AppxPackage -Name OpenAI.Codex)
if($packages.Count -ne 1){throw 'Official Codex package unavailable'}
Sync-CodexUserShortcuts -CanonicalPath (Join-Path $root 'data/entry-assets/Codex.lnk') -BackupRoot (Join-Path $root 'data/shortcut-backups/user-entries') -Folders @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs')) -OfficialInstallLocation $packages[0].InstallLocation -PackageFamilyName $packages[0].PackageFamilyName -Restore:$Restore
