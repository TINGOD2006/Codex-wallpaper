$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Path (Join-Path $PSScriptRoot '../src/companion/native-window-state.cs')
Add-Type -ReferencedAssemblies @([Windows.Forms.Form].Assembly.Location,[System.ComponentModel.Component].Assembly.Location,'System.Threading.Thread.dll') -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public static class WindowMotionFixture {
 [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr w,uint message,IntPtr wParam,IntPtr lParam);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr w,uint message,IntPtr wParam,IntPtr lParam);
 public static bool Observe(IntPtr hwnd,int pid,Func<IntPtr,int,bool> moving) {
  var detected=false;
  var watcher=new Thread(()=>{
   try {
    for(int i=0;i<80;i++){
     if(moving(hwnd,pid)){detected=true;break;}
     Thread.Sleep(15);
    }
   } finally {
    // Cancel only the fixture window's own modal move loop.
    PostMessage(hwnd,0x001F,IntPtr.Zero,IntPtr.Zero);
   }
  });
  watcher.IsBackground=true;
  watcher.Start();
  SendMessage(hwnd,0x0112,new IntPtr(0xF010),IntPtr.Zero);
  watcher.Join(3000);
  return detected;
 }
}
'@
$window=[Windows.Forms.Form]::new()
$window.Text='Wallpaper motion fixture';$window.ShowInTaskbar=$false
try{
 $window.Show();[Windows.Forms.Application]::DoEvents()
 if([MikuWindowState]::IsMoving($window.Handle,$PID)){throw 'An idle window was classified as moving'}
 if(-not [WindowMotionFixture]::Observe($window.Handle,$PID,[MikuWindowState]::IsMoving)){throw 'The native modal move was not detected'}
 if([MikuWindowState]::IsMoving($window.Handle,$PID)){throw 'Motion flag is still set after release'}
 'PASS: native window motion starts and stops on the owned Windows fixture'
}finally{$window.Dispose()}
