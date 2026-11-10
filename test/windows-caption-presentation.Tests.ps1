$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1');Initialize-CaptionTypes
[void][CodexWallpaper.NativeCaption]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class CaptionPresentationProbe {
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]public static extern IntPtr Style(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]public static extern IntPtr GetKeyboardLayout(uint thread);
}
'@
$hostForm=[CodexWallpaper.CaptionButtonForm]::new();$hostForm.FormBorderStyle='None';$hostForm.Text='Owned caption visibility host';$hostForm.SetBounds(100,100,900,640);$hostForm.TopMost=$true
$overlay=[CodexWallpaper.CaptionButtonForm]::new();$overlay.FormBorderStyle='None';$overlay.SetBounds(660,150,138,35);$overlay.TopMost=$true
$cover=[CodexWallpaper.CaptionButtonForm]::new();$cover.FormBorderStyle='None';$cover.SetBounds(660,150,138,35);$cover.TopMost=$true
foreach($form in @($hostForm,$overlay,$cover)){$form.AutoScaleMode='None'}
$rect=[CodexWallpaper.CaptionRect]::new();$rect.Left=660;$rect.Top=150;$rect.Right=798;$rect.Bottom=185
$foreground=[CaptionPresentationProbe]::GetForegroundWindow();$ownerPid=[uint32]0;$thread=[CaptionPresentationProbe]::GetWindowThreadProcessId($foreground,[ref]$ownerPid);$keyboard=[CaptionPresentationProbe]::GetKeyboardLayout($thread)
try{
 $hostForm.Show();$overlay.Show();[Windows.Forms.Application]::DoEvents()
 for($i=0;$i -lt 30;$i++){
  [void][CodexWallpaper.NativeCaption]::SetWindowPos($overlay.Handle,[IntPtr]::new(-2),0,0,0,0,0x213)
  [void][CodexWallpaper.NativeCaption]::SetWindowPos($hostForm.Handle,[IntPtr]::new(-1),100,100,900,640,0x250)
  if(-not $overlay.TopMost -or ([CaptionPresentationProbe]::Style($overlay.Handle,-20).ToInt64() -band 8)){throw 'Fixture did not reproduce a stale managed TopMost property'}
  $proof=[CodexWallpaper.NativeCaption]::Present($overlay.Handle,$rect,$hostForm.Handle,[IntPtr]::Zero,$true)
  if(-not $proof.Repaired -or -not $proof.Visible -or -not $proof.TopMost -or -not $proof.HitConfirmed){throw ('A native TOPMOST loss left the caption behind its host: '+($proof|ConvertTo-Json -Compress)+' host='+$hostForm.Handle.ToInt64()+' overlay='+$overlay.Handle.ToInt64())}
  [Windows.Forms.Application]::DoEvents()
  if([CaptionPresentationProbe]::GetForegroundWindow() -ne $foreground -or [CaptionPresentationProbe]::GetKeyboardLayout($thread) -ne $keyboard){throw 'Presentation recovery changed foreground or keyboard layout'}
 }
 $steady=[CodexWallpaper.NativeCaption]::Present($overlay.Handle,$rect,$hostForm.Handle,[IntPtr]::Zero,$true)
 if($steady.Repaired -or -not $steady.HitConfirmed){throw 'Healthy presentation repeatedly changes z-order'}
 $cover.Show();[Windows.Forms.Application]::DoEvents();[void][CodexWallpaper.NativeCaption]::SetWindowPos($cover.Handle,[IntPtr]::new(-1),$rect.Left,$rect.Top,$rect.Width,$rect.Height,0x250)
 $blocked=[CodexWallpaper.NativeCaption]::Present($overlay.Handle,$rect,$hostForm.Handle,[IntPtr]::Zero,$true)
 if($blocked.HitConfirmed -or $blocked.Repaired -or $blocked.HitRoot -ne $cover.Handle.ToInt64()){throw ('Presentation covered an unrelated popup or falsely confirmed visibility: '+($blocked|ConvertTo-Json -Compress)+' expected cover='+$cover.Handle.ToInt64())}
 $cover.Hide();$background=[CodexWallpaper.NativeCaption]::Present($overlay.Handle,$rect,$hostForm.Handle,[IntPtr]::Zero)
 if($foreground -ne $hostForm.Handle -and ($background.Visible -or $background.Repaired)){throw 'Inactive host repaired its overlay above the foreground application'}
 @{pass=$true;nativeTopmostLossRecoveries=30;actualHitConfirmed=$true;foregroundPreserved=$true;keyboardLayoutPreserved=$true;foreignPopupPreserved=$true;healthyCyclesDoNotReorder=$true}|ConvertTo-Json
}finally{$cover.Dispose();$overlay.Dispose();$hostForm.Dispose()}
