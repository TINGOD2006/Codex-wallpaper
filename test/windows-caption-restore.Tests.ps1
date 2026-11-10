$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1');Initialize-CaptionTypes
[void][CodexWallpaper.NativeCaption]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
Add-Type -ReferencedAssemblies @([Windows.Forms.Form].Assembly.Location,[Windows.Forms.Message].Assembly.Location,[System.ComponentModel.Component].Assembly.Location,'System.Drawing.Primitives.dll') @'
using System;using System.Windows.Forms;using System.Runtime.InteropServices;
public class CaptionRestoreFixture:Form {
 [StructLayout(LayoutKind.Sequential)]struct R{public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)]struct Info{public uint size;public R rect;[MarshalAs(UnmanagedType.ByValArray,SizeConst=6)]public uint[] states;[MarshalAs(UnmanagedType.ByValArray,SizeConst=6)]public R[] rectangles;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 public int Queries;
 protected override void WndProc(ref Message message){
  if(message.Msg==0x033F){Queries++;R r;GetWindowRect(Handle,out r);var info=new Info{size=(uint)Marshal.SizeOf<Info>(),rect=r,states=new uint[6],rectangles=new R[6]};info.rectangles[2]=new R{Left=r.Right-140,Right=r.Right-94,Top=r.Top+4,Bottom=r.Top+32};Marshal.StructureToPtr(info,message.LParam,false);message.Result=new IntPtr(1);return;}
  base.WndProc(ref message);
 }
}
'@
$form=[CaptionRestoreFixture]::new();$form.FormBorderStyle='None';$form.Text='Owned custom-caption restore fixture';$form.StartPosition='Manual';$form.SetBounds(120,100,1000,640)
try{
 $form.Show();[Windows.Forms.Application]::DoEvents()
 $initial=[CodexWallpaper.NativeCaption]::Layout($form.Handle)
 if(-not $initial -or [CodexWallpaper.NativeCaption]::LayoutSource -ne 'titlebar'){throw 'Custom caption fixture did not exercise titlebar fallback'}
 $queries=$form.Queries;$bounds=$form.Bounds;$watch=[Diagnostics.Stopwatch]::StartNew()
 for($i=0;$i -lt 30;$i++){
  $form.WindowState='Minimized';[Windows.Forms.Application]::DoEvents()
  if([CodexWallpaper.NativeCaption]::Layout($form.Handle)){throw 'Caption attached to minimized fixture'}
  $form.WindowState='Normal';[Windows.Forms.Application]::DoEvents()
  $layout=[CodexWallpaper.NativeCaption]::Layout($form.Handle)
  if(-not $layout -or [CodexWallpaper.NativeCaption]::LayoutSource -ne 'cache'){throw 'Restore did not immediately reuse the verified caption position'}
  if($layout.Button.Left -ne $initial.Button.Left -or $layout.Button.Top -ne $initial.Button.Top){throw 'Restored button changed location'}
 }
 $watch.Stop()
 if($form.Queries -ne $queries){throw 'Restore queried the native caption provider again'}
 if($form.Bounds -ne $bounds){throw 'Restore changed host bounds'}
 $form.Left+=70;$moved=[CodexWallpaper.NativeCaption]::Layout($form.Handle)
 if(-not $moved -or $moved.Button.Left -ne $initial.Button.Left+70 -or $form.Queries -ne $queries){throw 'Move did not reuse relative geometry'}
 $form.Hide();if([CodexWallpaper.NativeCaption]::Layout($form.Handle)){throw 'Caption attached to hidden host'}
 $form.Show();$shown=[CodexWallpaper.NativeCaption]::Layout($form.Handle)
 if(-not $shown -or $form.Queries -ne $queries){throw 'Hidden host restore re-queried provider'}
 @{pass=$true;restoreCycles=30;captionQueries=$form.Queries;cacheHits=[CodexWallpaper.NativeCaption]::LayoutCacheHits;hostBoundsPreserved=$true;elapsedMs=$watch.ElapsedMilliseconds}|ConvertTo-Json
}finally{$form.Dispose()}
