param([string]$InstallRoot,[switch]$SkipPlugin,[switch]$NoShortcuts)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
if(-not $InstallRoot){$InstallRoot=Get-CompanionInstallRoot}
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\');$app=Join-Path $root 'app'
if([IO.Path]::GetFileName($root) -notin @('CodexWallpaper','.codex-wallpaper') -or -not(Test-Path -LiteralPath (Join-Path $app 'install-manifest.json'))){throw 'Not an owned CodexWallpaper installation'}
$node=(Get-Command node).Source
$status=& $node (Join-Path $app 'src/companion/command.cjs') status --root $root 2>$null
if($LASTEXITCODE -eq 0){$result=& $node (Join-Path $app 'src/companion/command.cjs') exit --root $root 2>$null;if($LASTEXITCODE -ne 0){throw 'Restore/shutdown was not confirmed'};Start-Sleep -Milliseconds 500}
if(-not $SkipPlugin){$codex=Get-CompanionCodexCli;& $codex plugin remove 'codex-wallpaper-control@codex-wallpaper-local'|Out-Null;if($LASTEXITCODE -ne 0){throw 'Plugin removal was not confirmed'}}
if(-not $NoShortcuts){$shell=New-Object -ComObject WScript.Shell;foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){$file=Join-Path $folder 'Codex Wallpaper.lnk';if(Test-Path -LiteralPath $file){$shortcut=$shell.CreateShortcut($file);if($shortcut.Arguments.Contains($root)){Remove-Item -LiteralPath $file}}}}
$retired=[IO.Path]::GetFullPath((Join-Path $root ('app.uninstalled-'+[guid]::NewGuid().ToString())))
if(-not $app.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $retired.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Uninstall target outside root'}
Move-Item -LiteralPath $app -Destination $retired
@{uninstalled=$true;dataPreserved=$true;retiredAppDirectory=$retired}|ConvertTo-Json -Compress
