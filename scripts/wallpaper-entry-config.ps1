function Get-WallpaperEntryPowerShell {
 $command=Get-Command pwsh -CommandType Application -ErrorAction Stop
 $installed=Join-Path $env:ProgramFiles 'PowerShell/7/pwsh.exe'
 if(Test-Path -LiteralPath $installed -PathType Leaf){return $installed}
 if($command.Source -match '[/\\]OpenAI\.CodexPrimaryRuntime\.'){
  $cached=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
  if(Test-Path -LiteralPath $cached -PathType Leaf){return $cached}
 }
 return $command.Source
}

function Get-WallpaperEntryConfig {
 . (Join-Path $PSScriptRoot 'companion-paths.ps1')
 $entryRoot=[IO.Path]::GetFullPath((Get-CompanionInstallRoot))
 $launcher=Join-Path $entryRoot 'app/scripts/launch-wallpaper.ps1'
 $icon=Join-Path $entryRoot 'data/entry-assets/codex.ico'
 $powerShell=Get-WallpaperEntryPowerShell
 if(-not(Test-Path -LiteralPath $launcher) -or -not(Test-Path -LiteralPath $icon)){throw 'Installed wallpaper entry or official icon missing'}
 @{target=$powerShell;arguments='-NoProfile -WindowStyle Hidden -File "'+$launcher+'"';command='"'+$powerShell+'" -NoProfile -WindowStyle Hidden -File "'+$launcher+'"';icon=$icon+',0'}
}
