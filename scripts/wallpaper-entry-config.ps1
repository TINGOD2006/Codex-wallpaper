function Get-WallpaperEntryConfig {
 . (Join-Path $PSScriptRoot 'companion-paths.ps1')
 $entryRoot=[IO.Path]::GetFullPath((Get-CompanionInstallRoot))
 $launcher=Join-Path $entryRoot 'app/scripts/launch-wallpaper.ps1'
 $icon=Join-Path $entryRoot 'data/entry-assets/codex.ico'
 $powerShell=(Get-Command pwsh -ErrorAction Stop).Source
 if(-not(Test-Path -LiteralPath $launcher) -or -not(Test-Path -LiteralPath $icon)){throw 'Installed wallpaper entry or official icon missing'}
 @{target=$powerShell;arguments='-NoProfile -WindowStyle Hidden -File "'+$launcher+'"';command='"'+$powerShell+'" -NoProfile -WindowStyle Hidden -File "'+$launcher+'"';icon=$icon+',0'}
}
