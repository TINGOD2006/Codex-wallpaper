param([Parameter(Mandatory)][string]$IdentityPath,[ValidateSet('Inspect','Apply')][string]$Action='Inspect')
$ErrorActionPreference='Stop'
$taskbarIdentityPath=$IdentityPath
. (Join-Path $PSScriptRoot 'windows-session.ps1')
$identity=Get-Content -LiteralPath $taskbarIdentityPath -Raw|ConvertFrom-Json
if($identity.mode -ne 'Existing'){throw 'Only the verified original host is supported'}
Confirm-ThemeSession $identity -RequirePort
$package=Get-AppxPackage -Name OpenAI.Codex
if(@($package).Count -ne 1 -or [IO.Path]::GetFullPath((Join-Path $package.InstallLocation 'app/ChatGPT.exe')) -ne [IO.Path]::GetFullPath($identity.appPath)){throw 'Official package identity mismatch'}
$appId=$package.PackageFamilyName+'!App'
. (Join-Path $PSScriptRoot 'taskbar-properties.ps1')
. (Join-Path $PSScriptRoot 'wallpaper-entry-config.ps1')
$config=Get-WallpaperEntryConfig
. (Join-Path $PSScriptRoot 'window-activation.ps1')
$window=[CodexWindowActivation]::Find([int]$identity.pid)
for($attempt=0;$window -eq [IntPtr]::Zero -and $attempt -lt 50;$attempt++){Start-Sleep -Milliseconds 100;$window=[CodexWindowActivation]::Find([int]$identity.pid)}
if($window -eq [IntPtr]::Zero){throw 'Verified host has no main window'}
$before=[CodexTaskbarIdentity]::Read($window,5)
if($Action -eq 'Apply'){
 Confirm-ThemeSession $identity -RequirePort
 [void][CodexWindowActivation]::HideStartupAuxiliaries([int]$identity.pid)
 $changed=$false
 foreach($number in @(2,4,3)){
  $text=switch($number){2{$config.command}4{'Codex'}3{$config.icon}}
  if([CodexTaskbarIdentity]::Read($window,$number) -ne $text){[CodexTaskbarIdentity]::Write($window,$number,$text);$changed=$true}
 }
 if($changed -or $before -ne $appId){[CodexTaskbarIdentity]::Write($window,5,$appId)}
}
$after=[CodexTaskbarIdentity]::Read($window,5)
@{relaunchCommand=[CodexTaskbarIdentity]::Read($window,2);relaunchName=[CodexTaskbarIdentity]::Read($window,4);relaunchIcon=[CodexTaskbarIdentity]::Read($window,3);pid=$identity.pid;officialAppId=$appId;before=$before;after=$after;matchesOfficial=($after -eq $appId)}|ConvertTo-Json -Compress
