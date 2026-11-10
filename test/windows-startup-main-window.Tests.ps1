$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/window-activation.ps1')
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1')
Initialize-CaptionTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class ElectronStartupFixture {
 delegate IntPtr Procedure(IntPtr h,uint m,IntPtr w,IntPtr l);static Procedure callback=DefWindowProc;
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct ClassInfo {public uint size,style;public Procedure procedure;public int extraClass,extraWindow;public IntPtr module,icon,cursor,brush;public string menu,name;public IntPtr smallIcon;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern ushort RegisterClassEx(ref ClassInfo info);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr CreateWindowEx(uint ex,string name,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr module,IntPtr args);
 [DllImport("user32.dll")]static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string name);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool DestroyWindow(IntPtr h);
 public static IntPtr Make(string name,string title,uint ex) {var module=GetModuleHandle(null);var info=new ClassInfo {size=(uint)Marshal.SizeOf<ClassInfo>(),procedure=callback,module=module,name=name};RegisterClassEx(ref info);return CreateWindowEx(ex,name,title,0x00CF0000,100,100,700,420,IntPtr.Zero,IntPtr.Zero,module,IntPtr.Zero);}
}
'@
$aux=[ElectronStartupFixture]::Make('Chrome_WidgetWin_0','',0x100)
$main=[IntPtr]::Zero
try{
 if($aux -eq [IntPtr]::Zero){throw 'Fixture window creation failed'}
 # Reproduce the cold-start interval: only an invisible internal helper exists.
 if([CodexWindowActivation]::Find($PID) -ne [IntPtr]::Zero){throw 'Selected hidden startup helper as main'}
 if([CodexWindowActivation]::Restore($aux,$PID)){throw 'Explicit restore accepted internal helper'}
 if([ElectronStartupFixture]::IsWindowVisible($aux)){throw 'Startup helper was made visible'}
 # Reproduce the reported state with a previously revealed helper and real shell.
 [void][ElectronStartupFixture]::ShowWindow($aux,5)
 $main=[ElectronStartupFixture]::Make('Chrome_WidgetWin_1','Codex owned startup fixture',0x40000)
 if($main -eq [IntPtr]::Zero){throw 'Main fixture creation failed'}
 [void][ElectronStartupFixture]::ShowWindow($main,5)
 if([CodexWindowActivation]::Find($PID) -ne $main){throw 'Main selection confused by visible blank helper'}
 if([CodexWallpaper.NativeCaption]::IsAppWindow($aux)){throw 'Caption accepted helper'}
 if([CodexWallpaper.NativeCaption]::Layout($aux)){throw 'Caption computed layout for helper'}
 $captionTargets=@([CodexWallpaper.NativeCaption]::Windows($PID))
 if($captionTargets.Count -ne 1 -or $captionTargets[0] -ne $main){throw 'Caption did not exclusively select actual main'}
 if([CodexWindowActivation]::HideStartupAuxiliaries($PID) -ne 1){throw 'Did not recover revealed startup helper'}
 for($i=0;$i -lt 30 -and [ElectronStartupFixture]::IsWindowVisible($aux);$i++){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
 if([ElectronStartupFixture]::IsWindowVisible($aux) -or -not [ElectronStartupFixture]::IsWindowVisible($main)){throw 'Recovered wrong window'}
 if([CodexWindowActivation]::HideStartupAuxiliaries($PID) -ne 0){throw 'Recovery is not idempotent'}
 [void][ElectronStartupFixture]::ShowWindow($main,6)
 if(-not [CodexWindowActivation]::ValidMain($main,$PID)){throw 'Minimized real main excluded'}
 Write-Output 'PASS: cold hidden helper never shown; visible blank helper excluded/recovered; caption selects real main; recovery idempotent; minimized main preserved'
}finally{if($main -ne [IntPtr]::Zero){[void][ElectronStartupFixture]::DestroyWindow($main)};[void][ElectronStartupFixture]::DestroyWindow($aux)}
