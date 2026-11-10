$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1')
Initialize-CaptionTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public class CaptionStyleProbe {
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr GetStyle(IntPtr window,int index);
 [DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr window,uint command);
}
'@
$hostForm=[Windows.Forms.Form]::new()
try{
foreach($form in @([CodexWallpaper.CaptionButtonForm]::new(),[CodexWallpaper.SidebarForm]::new())){
 try{
  # Toggle the property to force native handle recreation. The class must never
  # let APPWINDOW win over TOOLWINDOW, even if a caller enables the taskbar flag.
  foreach($taskbar in @($false,$true,$false,$true)){
   $form.ShowInTaskbar=$taskbar
   $handle=$form.Handle
   $style=[CaptionStyleProbe]::GetStyle($handle,-20).ToInt64()
   if(($style -band 0x80) -eq 0 -or ($style -band 0x40000) -ne 0){throw "Alt+Tab style violated: $($form.GetType().Name) $style"}
   $form.Show()
   $form.Hide()
  }
 }finally{$form.Dispose()}
}
}finally{$hostForm.Dispose()}
'PASS: caption and sidebar remain tool windows without APPWINDOW after native handle recreation'
