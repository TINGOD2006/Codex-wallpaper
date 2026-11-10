using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;

namespace CodexWallpaper {
 public class CaptionButtonForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle=(p.ExStyle&~0x00040000)|0x08000080;return p; } }
 }
 public class SidebarForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { var p=base.CreateParams;p.ExStyle=(p.ExStyle&~0x00040000)|0x80;return p; } }
 }
 [StructLayout(LayoutKind.Sequential)] public struct CaptionRect { public int Left,Top,Right,Bottom; public int Width { get {return Right-Left;} } public int Height {get{return Bottom-Top;}} }
 public class CaptionLayout { public CaptionRect Host,NativeButtons,Button,Sidebar;public double Scale; }
 public class CaptionPresentation {public bool Visible,TopMost,HitConfirmed,Repaired;public long HitRoot;}
 public static class NativeCaption {
  class AccessibleResult {public IntPtr Window;public int Width,Height,Dpi;public CaptionRect Relative;}
  static AccessibleResult cached;static Task<AccessibleResult> probe;static IntPtr probeWindow;static DateTime probeAt,nextProbe;
  static AccessibleResult layoutCache;static long layoutStyle;static bool layoutZoomed;static IntPtr titleWindow;static DateTime nextTitleProbe;
  public static string LayoutSource="none";public static int TitleQueries,LayoutCacheHits;
  public static string ProbeStatus="idle";
  public static int[] ProbeMetrics=new int[0];
  delegate bool EnumProc(IntPtr h,IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f,IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out CaptionRect r);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,System.Text.StringBuilder name,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
  [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowStyle(IntPtr h,int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [StructLayout(LayoutKind.Sequential)] struct HitPoint {public int X,Y;}
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(HitPoint point);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out CaptionRect value,int bytes);
  [DllImport("dwmapi.dll",EntryPoint="DwmGetWindowAttribute")] static extern int DwmInt(IntPtr h,int attribute,out int value,int bytes);
  [StructLayout(LayoutKind.Sequential)] struct TitleInfo {public uint cbSize;public CaptionRect rect;[MarshalAs(UnmanagedType.ByValArray,SizeConst=6)]public uint[] states;[MarshalAs(UnmanagedType.ByValArray,SizeConst=6)]public CaptionRect[] rectangles;}
  [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendTitleInfo(IntPtr h,uint message,IntPtr wParam,ref TitleInfo info,uint flags,uint timeout,out UIntPtr result);
  public static bool VerifyHost(int pid,string stamp,string path) {try{using(var p=Process.GetProcessById(pid)){return p.MainModule.FileName.Equals(path,StringComparison.OrdinalIgnoreCase)&&Math.Abs(p.StartTime.ToUniversalTime().Ticks-long.Parse(stamp))<10;}}catch{return false;}}
  public static bool IsAppWindow(IntPtr h) {if(h==IntPtr.Zero||GetWindow(h,4)!=IntPtr.Zero||GetWindowTextLength(h)==0||(GetWindowStyle(h,-20).ToInt64()&0x80)!=0)return false;var name=new System.Text.StringBuilder(128);GetClassName(h,name,128);return name.ToString()!="Chrome_WidgetWin_0";}
  public static IntPtr[] Windows(int pid) {var result=new List<IntPtr>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id!=pid||!IsAppWindow(h)||!IsWindowVisible(h)||IsIconic(h))return true;CaptionRect r;double scale=Math.Max(96,GetDpiForWindow(h))/96.0;if(GetWindowRect(h,out r)&&r.Width>=240*scale&&r.Height>=220*scale)result.Add(h);return true;},IntPtr.Zero);return result.ToArray();}
  public static CaptionLayout Calculate(CaptionRect host,CaptionRect buttons,double scale) {
   if(scale<0.5||scale>4||host.Width<240*scale||host.Height<220*scale||buttons.Width<30*scale||buttons.Height<12*scale||buttons.Height>80*scale||buttons.Left<host.Width/2||buttons.Right>host.Width+2*scale||buttons.Top<0)return null;
   int width=(int)Math.Round(110*scale),height=(int)Math.Min(Math.Round(28*scale),buttons.Height),gap=(int)Math.Round(6*scale);
   int left=host.Left+buttons.Left-width-gap,top=host.Top+buttons.Top+(buttons.Height-height)/2;
   if(left<host.Left+24*scale)return null;
   int inset=(int)Math.Round(12*scale),panelWidth=(int)Math.Min(Math.Round(420*scale),host.Width-2*inset),panelTop=host.Top+buttons.Bottom+(int)Math.Round(8*scale);
   return new CaptionLayout {Host=host,NativeButtons=new CaptionRect{Left=host.Left+buttons.Left,Top=host.Top+buttons.Top,Right=host.Left+buttons.Right,Bottom=host.Top+buttons.Bottom},Button=new CaptionRect{Left=left,Top=top,Right=left+width,Bottom=top+height},Sidebar=new CaptionRect{Left=host.Right-inset-panelWidth,Top=panelTop,Right=host.Right-inset,Bottom=host.Bottom-inset},Scale=scale};
  }
  public static CaptionPresentation Present(IntPtr overlay,CaptionRect bounds,IntPtr host,IntPtr sidebar,bool fixture=false) {
   var proof=new CaptionPresentation();var foreground=GetAncestor(GetForegroundWindow(),2);
   if(overlay==IntPtr.Zero||bounds.Width<=0||bounds.Height<=0||!fixture&&(foreground!=host&&foreground!=sidebar))return proof;
   var point=new HitPoint{X=bounds.Left+bounds.Width/2,Y=bounds.Top+bounds.Height/2};
   var hit=GetAncestor(WindowFromPoint(point),2);CaptionRect actual;bool positioned=GetWindowRect(overlay,out actual)&&actual.Left==bounds.Left&&actual.Top==bounds.Top&&actual.Right==bounds.Right&&actual.Bottom==bounds.Bottom;
   bool topMost=(GetWindowStyle(overlay,-20).ToInt64()&8)!=0,shown=IsWindowVisible(overlay);
   // WinForms' TopMost property can stay true after Windows removes the native
   // TOPMOST bit. NOZORDER moves cannot repair it. Reassert only over our host,
   // never over another app's popup/OSD, and never activate this window.
   if(hit==host||hit==overlay||hit==sidebar){if(!topMost||!shown||!positioned||hit==host)proof.Repaired=SetWindowPos(overlay,new IntPtr(-1),bounds.Left,bounds.Top,bounds.Width,bounds.Height,0x250);}
   else if(!positioned)SetWindowPos(overlay,IntPtr.Zero,bounds.Left,bounds.Top,bounds.Width,bounds.Height,0x214);
   proof.Visible=IsWindowVisible(overlay);proof.TopMost=(GetWindowStyle(overlay,-20).ToInt64()&8)!=0;
   hit=GetAncestor(WindowFromPoint(point),2);proof.HitRoot=hit.ToInt64();proof.HitConfirmed=hit==overlay;
   return proof;
  }
  public static CaptionLayout Layout(IntPtr window) {
   LayoutSource="none";
   if(!IsAppWindow(window)||!IsWindowVisible(window)||IsIconic(window))return null;int cloaked;if(DwmInt(window,14,out cloaked,4)==0&&cloaked!=0)return null;
   CaptionRect host,buttons;if(!GetWindowRect(window,out host))return null;int dpi=(int)GetDpiForWindow(window);double scale=Math.Max(96,dpi)/96.0;
   // A minimize/restore or move does not invalidate a verified relative caption
   // rectangle. Consult it before sending messages or touching accessibility.
   long style=GetWindowStyle(window,-16).ToInt64();bool zoomed=IsZoomed(window);
   if(layoutCache!=null&&layoutCache.Window==window&&layoutCache.Width==host.Width&&layoutCache.Height==host.Height&&layoutCache.Dpi==dpi&&layoutStyle==style&&layoutZoomed==zoomed){LayoutCacheHits++;LayoutSource="cache";return Calculate(host,layoutCache.Relative,scale);}
   if(IsHungAppWindow(window)){LayoutSource="host-busy";return null;}
   var value=DwmGetWindowAttribute(window,5,out buttons,Marshal.SizeOf<CaptionRect>())==0?Calculate(host,buttons,scale):null;
   if(value!=null)return RememberLayout(window,host,dpi,style,zoomed,value,"dwm");
   value=CachedAccessibleLayout(window,host,scale);
   if(value!=null)return RememberLayout(window,host,dpi,style,zoomed,value,"accessibility");
   if(titleWindow!=window||DateTime.UtcNow>=nextTitleProbe){
    titleWindow=window;nextTitleProbe=DateTime.UtcNow.AddSeconds(1);TitleQueries++;
    var info=new TitleInfo{cbSize=(uint)Marshal.SizeOf<TitleInfo>(),states=new uint[6],rectangles=new CaptionRect[6]};
    UIntPtr result;if(SendTitleInfo(window,0x033F,IntPtr.Zero,ref info,2,40,out result)!=IntPtr.Zero&&(info.states[2]&0x8001)==0){var r=info.rectangles[2];var title=Calculate(host,new CaptionRect{Left=r.Left-host.Left,Right=r.Right-host.Left,Top=r.Top-host.Top,Bottom=r.Bottom-host.Top},scale);if(title!=null)return RememberLayout(window,host,dpi,style,zoomed,title,"titlebar");}
   }
   value=AccessibleLayout(window,host,scale);
   return value==null?null:RememberLayout(window,host,dpi,style,zoomed,value,"accessibility");
  }
  static CaptionLayout RememberLayout(IntPtr window,CaptionRect host,int dpi,long style,bool zoomed,CaptionLayout value,string source){layoutCache=new AccessibleResult{Window=window,Width=host.Width,Height=host.Height,Dpi=dpi,Relative=new CaptionRect{Left=value.NativeButtons.Left-host.Left,Top=value.NativeButtons.Top-host.Top,Right=value.NativeButtons.Right-host.Left,Bottom=value.NativeButtons.Bottom-host.Top}};layoutStyle=style;layoutZoomed=zoomed;LayoutSource=source;return value;}
  static AccessibleResult ProbeAccessible(IntPtr window) {
   var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
   try {
    var names=new List<Condition>();foreach(var name in new[]{"最小化","將視窗最小化","Minimize","Minimize window"})names.Add(new PropertyCondition(AutomationElement.NameProperty,name));
    var condition=new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Button),new OrCondition(names.ToArray()));
    ProbeStatus="query";var matches=AutomationElement.FromHandle(window).FindAll(TreeScope.Descendants,condition);ProbeStatus="matches:"+matches.Count;CaptionRect host;if(!GetWindowRect(window,out host))return null;int dpi=(int)GetDpiForWindow(window);double scale=Math.Max(96,dpi)/96.0;CaptionRect selected=new CaptionRect();int count=0;
    foreach(AutomationElement match in matches){var b=match.Current.BoundingRectangle;ProbeMetrics=new[]{host.Left,host.Top,host.Right,host.Bottom,dpi,(int)b.Left,(int)b.Top,(int)b.Width,(int)b.Height};if(b.Width<20*scale||b.Height<12*scale||b.Height>80*scale||b.Left<host.Left+host.Width/2||b.Right>host.Right+2*scale||b.Top<host.Top||b.Bottom>host.Top+80*scale)continue;selected=new CaptionRect{Left=(int)Math.Round(b.Left)-host.Left,Top=(int)Math.Round(b.Top)-host.Top,Right=(int)Math.Round(b.Right)-host.Left,Bottom=(int)Math.Round(b.Bottom)-host.Top};count++;}
    ProbeStatus="valid:"+count;return count==1?new AccessibleResult{Window=window,Width=host.Width,Height=host.Height,Dpi=dpi,Relative=selected}:null;
   }catch(Exception e){ProbeStatus=e.GetType().Name+":"+e.HResult;return null;}finally{if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous);}
  }
  static CaptionLayout CachedAccessibleLayout(IntPtr window,CaptionRect host,double scale) {
   if(probe!=null&&probe.IsCompleted){cached=probe.Status==TaskStatus.RanToCompletion?probe.Result:null;probe=null;}
   if(cached!=null&&cached.Window==window&&cached.Width==host.Width&&cached.Height==host.Height&&cached.Dpi==(int)GetDpiForWindow(window))return Calculate(host,cached.Relative,scale);
   return null;
  }
  static CaptionLayout AccessibleLayout(IntPtr window,CaptionRect host,double scale) {
   var value=CachedAccessibleLayout(window,host,scale);if(value!=null)return value;
   if(probe==null&&DateTime.UtcNow>=nextProbe){probeWindow=window;probeAt=DateTime.UtcNow;nextProbe=probeAt.AddSeconds(1);probe=Task.Run(()=>ProbeAccessible(window));}
   return null;
  }
  public static bool IsProbing(IntPtr window) {return probe!=null&&probeWindow==window&&!probe.IsCompleted&&(DateTime.UtcNow-probeAt).TotalSeconds<3;}
  public static int[] Metrics(IntPtr window) {CaptionRect h,c;GetWindowRect(window,out h);DwmGetWindowAttribute(window,5,out c,Marshal.SizeOf<CaptionRect>());return new[]{h.Left,h.Top,h.Right,h.Bottom,c.Left,c.Top,c.Right,c.Bottom,(int)GetDpiForWindow(window)};}
 }
}
