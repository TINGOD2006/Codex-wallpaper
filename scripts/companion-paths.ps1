function Get-CompanionInstallRoot {
 if($env:CODEX_WALLPAPER_ROOT){return [IO.Path]::GetFullPath($env:CODEX_WALLPAPER_ROOT)}
 if(-not $env:USERPROFILE){throw 'User profile is unavailable'}
 return [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex-wallpaper'))
}
function Get-CompanionCodexCli {
 $command=Get-Command codex -ErrorAction SilentlyContinue
 if($command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)){return $command.Source}
 $package=Get-AppxPackage -Name OpenAI.Codex|Sort-Object Version -Descending|Select-Object -First 1
 if($package){$candidate=Join-Path $package.InstallLocation 'app/resources/codex.exe';if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}}
 throw 'RUNTIME_MISSING: Cannot locate the installed official Codex CLI'
}
