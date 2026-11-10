param([switch]$Restore)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
$root=[IO.Path]::GetFullPath((Get-CompanionInstallRoot))
$app=Join-Path $root 'app'
if([IO.Path]::GetFullPath((Split-Path $PSScriptRoot)) -ne $app){throw '請從已安裝的 Wallpaper 目錄執行。'}
$entry=Join-Path $app 'scripts/launch-wallpaper.ps1'
$legacy=Join-Path $app 'scripts/start-companion.ps1'
$records=Join-Path $root 'data/shortcut-backups'
$changed=$false
$packages=@(Get-AppxPackage -Name OpenAI.Codex)
$icon=$null
if(-not $Restore -and $packages.Count -eq 1){
 $sourceIcon=Join-Path $packages[0].InstallLocation 'app/resources/icon-chatgpt.ico'
 if(Test-Path -LiteralPath $sourceIcon){
  $iconDirectory=Join-Path $root 'data/entry-assets'
  New-Item -ItemType Directory -Path $iconDirectory -Force|Out-Null
  $icon=Join-Path $iconDirectory 'codex.ico'
  if(-not(Test-Path -LiteralPath $icon) -or (Get-FileHash -LiteralPath $icon).Hash -ne (Get-FileHash -LiteralPath $sourceIcon).Hash){Copy-Item -LiteralPath $sourceIcon -Destination $icon -Force}
 }
}
$shell=New-Object -ComObject WScript.Shell
try{
 foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
  $link=[IO.Path]::GetFullPath((Join-Path $folder 'Codex Wallpaper.lnk'))
  $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($link.ToLowerInvariant())))
  $recordPath=Join-Path $records ($key+'.json');$backup=Join-Path $records ($key+'.lnk')
  if($Restore){
   if(-not(Test-Path -LiteralPath $recordPath)){continue}
   $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
   if($record.path -ne $link -or -not(Test-Path -LiteralPath $link) -or (Get-FileHash -LiteralPath $link).Hash -ne $record.installedHash){throw '捷徑已變更，未覆寫。'}
   if($record.existed){if((Get-FileHash -LiteralPath $backup).Hash -ne $record.originalHash){throw '捷徑備份不符。'};Copy-Item -LiteralPath $backup -Destination $link -Force}else{Remove-Item -LiteralPath $link}
   $changed=$true;Write-Output ('Restored: '+$link);continue
  }
  if(-not(Test-Path -LiteralPath $entry)){throw '缺少啟動器。'}
  $existed=Test-Path -LiteralPath $link
  if($existed){
   if((Get-Item -LiteralPath $link).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '不修改連結檔案。'}
   $old=$shell.CreateShortcut($link)
   if(-not($old.Arguments.Contains($legacy) -or $old.Arguments.Contains($entry))){throw '同名捷徑屬於其他程式，未修改。'}
  }
  New-Item -ItemType Directory -Path $records -Force|Out-Null
  if(Test-Path -LiteralPath $recordPath){
   $record=Get-Content -LiteralPath $recordPath -Raw|ConvertFrom-Json
   if($record.path -ne $link -or -not $existed -or (Get-FileHash -LiteralPath $link).Hash -ne $record.installedHash){throw '已有捷徑備份且入口不同，未覆寫。'}
   if($icon){
    $current=$shell.CreateShortcut($link)
    if($current.IconLocation -ne ($icon+',0')){
     $current.IconLocation=$icon+',0';$current.Save()
     $record.installedHash=(Get-FileHash -LiteralPath $link).Hash
     $record|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
     $changed=$true;Write-Output ('Refreshed official icon: '+$link);continue
    }
   }
   Write-Output ('Already installed: '+$link);continue
  }
  $originalHash=$null
  if($existed){$originalHash=(Get-FileHash -LiteralPath $link).Hash;Copy-Item -LiteralPath $link -Destination $backup}
  $temporary=Join-Path $folder ('Codex-Wallpaper-'+[guid]::NewGuid().ToString()+'.lnk')
  $shortcut=$shell.CreateShortcut($temporary)
  $shortcut.TargetPath=(Get-Command pwsh -ErrorAction Stop).Source
  $shortcut.Arguments='-NoProfile -WindowStyle Hidden -File "'+$entry+'"'
  $shortcut.WorkingDirectory=$app;$shortcut.WindowStyle=7
  $shortcut.Description='開啟 Codex 與 Wallpaper；設定位於右上角側欄'
  if($icon){$shortcut.IconLocation=$icon+',0'}
  $shortcut.Save()
  $installedHash=(Get-FileHash -LiteralPath $temporary).Hash
  # Record the original before publishing the replacement; never replace another app's entry.
  @{schemaVersion=1;path=$link;existed=$existed;originalHash=$originalHash;installedHash=$installedHash}|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
  Move-Item -LiteralPath $temporary -Destination $link -Force
  $changed=$true
  Write-Output ('Installed: '+$link)
 }
 if(-not ('WallpaperShortcutNotifications' -as [type])){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class WallpaperShortcutNotifications{[DllImport("shell32.dll")]public static extern void SHChangeNotify(int e,uint f,IntPtr a,IntPtr b);}'}
 if($changed){[WallpaperShortcutNotifications]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)}
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
