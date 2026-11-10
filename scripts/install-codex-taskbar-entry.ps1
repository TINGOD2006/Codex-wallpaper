$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'wallpaper-entry-config.ps1')
$config=Get-WallpaperEntryConfig
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$root=[IO.Path]::GetFullPath((Get-CompanionInstallRoot))
if([IO.Path]::GetFullPath((Split-Path $PSScriptRoot)) -ne (Join-Path $root 'app')){throw 'Run the installed entry installer'}
$package=@(Get-AppxPackage -Name OpenAI.Codex)
if($package.Count -ne 1){throw 'Official Codex package unavailable'}
$appId=$package[0].PackageFamilyName+'!App'
$folder=Join-Path $root 'data/entry-assets'
$link=Join-Path $folder 'Codex.lnk'
$recordPath=Join-Path $folder 'codex-pin-entry.json'
if(Test-Path -LiteralPath $link){
 if((Get-Item -LiteralPath $link).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refuse linked shortcut'}
 if(-not(Test-Path -LiteralPath $recordPath)){throw 'Unowned shortcut exists'}
 $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
 if($record.path -ne $link -or (Get-FileHash -LiteralPath $link).Hash -ne $record.sha256){throw 'Shortcut was modified; preserved'}
 if($record.target -eq $config.target -and $record.arguments -eq $config.arguments -and $record.icon -eq $config.icon -and $record.appId -eq $appId){
  @{path=$link;appId=$appId;verified=$true;unchanged=$true}|ConvertTo-Json -Compress
  return
 }
}
. (Join-Path $PSScriptRoot 'taskbar-properties.ps1')
$temporary=Join-Path $folder ([guid]::NewGuid().ToString()+'.lnk')
$shell=New-Object -ComObject WScript.Shell
try{
 $shortcut=$shell.CreateShortcut($temporary)
 $shortcut.TargetPath=$config.target;$shortcut.Arguments=$config.arguments
 $shortcut.WorkingDirectory=Join-Path $root 'app';$shortcut.WindowStyle=7
 $shortcut.IconLocation=$config.icon;$shortcut.Description='Codex，啟動時自動載入桌布'
 $shortcut.Save()
 foreach($n in @(2,4,3,5)){
  $value=switch($n){2{$config.command}3{$config.icon}4{'Codex'}5{$appId}}
  [CodexTaskbarIdentity]::WriteFile($temporary,$n,$value)
  if([CodexTaskbarIdentity]::ReadFile($temporary,$n) -ne $value){throw 'Shortcut property readback failed'}
 }
 Move-Item -LiteralPath $temporary -Destination $link -Force
 @{path=$link;sha256=(Get-FileHash -LiteralPath $link).Hash;appId=$appId;target=$config.target;arguments=$config.arguments;icon=$config.icon}|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
 @{path=$link;appId=$appId;command=$config.command;verified=$true}|ConvertTo-Json -Compress
}finally{
 if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
