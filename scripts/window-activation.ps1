if(-not ('CodexWindowActivation' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;
public static class CodexWindowActivation {
 delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder c,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowTextLength(IntPtr h);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]static extern IntPtr GetStyle(IntPtr h,int index);
 [DllImport("user32.dll")]static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 public static bool ValidMain(IntPtr h,int pid){
  uint owner;GetWindowThreadProcessId(h,out owner);if(h==IntPtr.Zero||owner!=pid||GetWindow(h,4)!=IntPtr.Zero||GetWindowTextLength(h)==0)return false;
  var name=new StringBuilder(128);GetClassName(h,name,128);long style=GetStyle(h,-20).ToInt64();
  // Electron creates an untitled Chrome_WidgetWin_0 helper before the actual
  // app shell. Showing it creates a second black window and a taskbar entry.
  if(name.ToString()=="Chrome_WidgetWin_0"||(style&0x80)!=0||(!IsWindowVisible(h)&&(style&0x40000)==0))return false;
  Rect box;return IsIconic(h)||(GetWindowRect(h,out box)&&box.Right-box.Left>=240&&box.Bottom-box.Top>=220);
 }
 public static IntPtr Find(int pid){
  using(var process=System.Diagnostics.Process.GetProcessById(pid)){var main=process.MainWindowHandle;if(ValidMain(main,pid))return main;}
  var found=new List<IntPtr>();EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p!=pid)return true;var name=new StringBuilder(128);GetClassName(h,name,128);if(name.ToString().StartsWith("Chrome_WidgetWin_")&&ValidMain(h,pid))found.Add(h);return true;},IntPtr.Zero);return found.Count==1?found[0]:IntPtr.Zero;
 }
 public static int HideStartupAuxiliaries(int pid){
  var main=Find(pid);if(main==IntPtr.Zero||!IsWindowVisible(main))return 0;int hidden=0;
  EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p!=pid||h==main||!IsWindowVisible(h)||GetWindow(h,4)!=IntPtr.Zero||GetWindowTextLength(h)!=0)return true;
   var name=new StringBuilder(128);GetClassName(h,name,128);Rect box;long style=GetStyle(h,-20).ToInt64();
   if(name.ToString()=="Chrome_WidgetWin_0"&&(style&0x40080)==0&&GetWindowRect(h,out box)&&box.Right-box.Left>=240&&box.Bottom-box.Top>=220){ShowWindowAsync(h,0);hidden++;}return true;
  },IntPtr.Zero);return hidden;
 }
 // Restoring an existing host must not synchronously manipulate any other
 // Electron windows. Startup auxiliary cleanup belongs to initial setup.
 public static bool Restore(IntPtr h,int pid){if(!ValidMain(h,pid))return false;if(IsIconic(h))ShowWindowAsync(h,9);else if(!IsWindowVisible(h))ShowWindowAsync(h,5);if(GetForegroundWindow()!=h)SetForegroundWindow(h);return true;}
}
'@}
