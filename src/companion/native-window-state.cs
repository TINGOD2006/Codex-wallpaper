using System;
using System.Runtime.InteropServices;
public static class MikuWindowState {
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
 [StructLayout(LayoutKind.Sequential)]
 struct GuiThreadInfo {
  public int Size,Flags;
  public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret;
  public int Left,Top,Right,Bottom;
 }
 public static bool IsMoving(IntPtr window,int expectedPid) {
  uint pid;
  uint thread=GetWindowThreadProcessId(window,out pid);
  if(thread==0||pid!=expectedPid)return false;
  var info=new GuiThreadInfo{Size=Marshal.SizeOf<GuiThreadInfo>()};
  return GetGUIThreadInfo(thread,ref info)&&(info.Flags&2)!=0&&info.MoveSize==window;
 }
}
