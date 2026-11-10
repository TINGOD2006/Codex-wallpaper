$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1')
Initialize-CaptionTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public class CaptionFocusProbe {
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern IntPtr GetKeyboardLayout(uint thread);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$hostForm=[Windows.Forms.Form]::new();$hostForm.Text='Owned wallpaper focus test'
$editor=[Windows.Forms.TextBox]::new();$hostForm.Controls.Add($editor)
$button=[CodexWallpaper.CaptionButtonForm]::new();$button.ShowInTaskbar=$false
$sidebar=[CodexWallpaper.SidebarForm]::new();$sidebar.ShowInTaskbar=$false
try{
 $hostForm.Show();$hostForm.Activate();[void][CaptionFocusProbe]::SetForegroundWindow($hostForm.Handle);$editor.Focus() | Out-Null
 [Windows.Forms.Application]::DoEvents()
 $before=[CaptionFocusProbe]::GetForegroundWindow();$beforePid=[uint32]0
 $thread=[CaptionFocusProbe]::GetWindowThreadProcessId($before,[ref]$beforePid)
 $keyboard=[CaptionFocusProbe]::GetKeyboardLayout($thread)
 if($before -ne $hostForm.Handle){throw 'Owned fixture could not get focus for the regression test'}
 for($i=0;$i -lt 50;$i++){
  if($i%5 -eq 0){$button.Hide();$sidebar.Hide()}
  $button.Show();$sidebar.Show()
  [void][CodexWallpaper.NativeCaption]::SetWindowPos($button.Handle,[IntPtr]::Zero,100,100,110,28,0x214)
  [void][CodexWallpaper.NativeCaption]::SetWindowPos($sidebar.Handle,[IntPtr]::Zero,250,100,420,400,0x214)
  [Windows.Forms.Application]::DoEvents()
  $current=[CaptionFocusProbe]::GetForegroundWindow();$currentPid=[uint32]0
  $currentThread=[CaptionFocusProbe]::GetWindowThreadProcessId($current,[ref]$currentPid)
  if($current -ne $before -or $currentThread -ne $thread -or [CaptionFocusProbe]::GetKeyboardLayout($currentThread) -ne $keyboard){throw 'Automatic overlay maintenance changed foreground or keyboard layout'}
  Start-Sleep -Milliseconds 20
 }
 'PASS: 50 automatic show/move cycles preserve foreground thread and keyboard layout'
}finally{$button.Dispose();$sidebar.Dispose();$hostForm.Dispose()}
