param([ValidateSet('imageVideo','folder','presetOpen','presetSave')][string]$Action,[int]$OwnerProcessId=0)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Windows.Forms;
public sealed class WallpaperDialogOwner : IWin32Window {
  public IntPtr Handle { get; private set; }
  public WallpaperDialogOwner(IntPtr handle) { Handle = handle; }
}
'@ -ReferencedAssemblies System.Windows.Forms
if($Action -eq 'folder'){$dialog=[Windows.Forms.FolderBrowserDialog]::new();$dialog.Description='選擇 Wallpaper 桌布資料夾'}
elseif($Action -eq 'presetSave'){$dialog=[Windows.Forms.SaveFileDialog]::new();$dialog.Filter='Wallpaper 預設 (*.json)|*.json';$dialog.FileName='CodexWallpaper.json'}
else{$dialog=[Windows.Forms.OpenFileDialog]::new();$dialog.Filter=if($Action -eq 'presetOpen'){'Wallpaper 預設 (*.json)|*.json'}else{'圖片與影片|*.png;*.jpg;*.jpeg;*.webp;*.mp4;*.webm;*.m4v;*.mov;*.mkv;*.ogv'}}
try{
  $ownerHandle=[IntPtr]::Zero
  if($OwnerProcessId -gt 0){try{$ownerHandle=(Get-Process -Id $OwnerProcessId -ErrorAction Stop).MainWindowHandle}catch{}}
  $result=if($ownerHandle -ne [IntPtr]::Zero){$dialog.ShowDialog([WallpaperDialogOwner]::new($ownerHandle))}else{$dialog.ShowDialog()}
  if($result -ne [Windows.Forms.DialogResult]::OK){@{cancelled=$true}|ConvertTo-Json -Compress}
  else{$selected=if($Action -eq 'folder'){$dialog.SelectedPath}else{$dialog.FileName};@{cancelled=$false;path=$selected}|ConvertTo-Json -Compress}
}finally{$dialog.Dispose()}
