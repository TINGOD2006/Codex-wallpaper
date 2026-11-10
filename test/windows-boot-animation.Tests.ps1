$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class BootFullscreenProbe {
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)]public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc callback,IntPtr p);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 public static IntPtr Find(int pid){IntPtr result=IntPtr.Zero;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==pid&&IsWindowVisible(h)){result=h;return false;}return true;},IntPtr.Zero);return result;}
}
'@
[void][BootFullscreenProbe]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$project=Split-Path $PSScriptRoot;$folder=Join-Path $project '.state/boot-integration';$fixtureExe=Join-Path $project '.state/BootWindowFixture.exe'
New-Item -ItemType Directory -Path $folder -Force|Out-Null
foreach($name in @('DragonBoot.exe','startup.mp4')){Copy-Item -LiteralPath (Join-Path $project ('assets/boot-animation/'+$name)) -Destination (Join-Path $folder $name) -Force}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler /nologo /target:winexe /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll ('/out:'+$fixtureExe) (Join-Path $project 'test/fixtures/boot-window.cs')
if($LASTEXITCODE -ne 0){throw 'Owned fixture compilation failed'}
$base=Get-Content -LiteralPath (Join-Path $project 'assets/boot-animation/launcher.json') -Raw|ConvertFrom-Json
$base.ProcessNames=@('BootWindowFixture');$base.ProcessPathContains='.state';$base.Volume=0
$results=@()
foreach($mode in @('complete','escape','timeout','media-failure')){
 $config=$base|ConvertTo-Json -Depth 6|ConvertFrom-Json
 if($mode -eq 'timeout'){$config.MaxWaitSeconds=10;$config.HoldAt=1;$config.TransitionStart=2;$config.TransitionEnd=3}
 if($mode -eq 'media-failure'){$config.Video='invalid.mp4';[IO.File]::WriteAllText((Join-Path $folder 'invalid.mp4'),'not a movie')}
 $config|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $folder 'launcher.json') -Encoding utf8
 $id=[guid]::NewGuid().ToString();$state=Join-Path $folder ($id+'.json');$fixture=$null;$player=$null
 try{
  $readyAfter=if($mode -eq 'complete'){'0'}else{'-1'}
  $fixture=Start-Process -FilePath $fixtureExe -ArgumentList @(('"'+$state+'"'),$id,$readyAfter) -PassThru -WindowStyle Normal
  for($i=0;$i -lt 50 -and -not(Test-Path -LiteralPath $state);$i++){Start-Sleep -Milliseconds 100}
  $arguments=@('--state-file',('"'+$state+'"'),'--launch-id',$id);if($mode -eq 'escape'){$arguments+='--test-escape'}
  $player=Start-Process -FilePath (Join-Path $folder 'DragonBoot.exe') -ArgumentList $arguments -PassThru -WindowStyle Normal
  $fullscreen=$null
  if($mode -eq 'timeout'){
   $handle=[IntPtr]::Zero
   for($n=0;$n -lt 100 -and $handle -eq [IntPtr]::Zero;$n++){Start-Sleep -Milliseconds 25;$handle=[BootFullscreenProbe]::Find($player.Id)}
   if($handle -eq [IntPtr]::Zero){throw 'Player window not found'}
   $rect=[BootFullscreenProbe+Rect]::new();[void][BootFullscreenProbe]::GetWindowRect($handle,[ref]$rect)
   $monitor=[Windows.Forms.Screen]::FromHandle($handle).Bounds
   if($rect.Left -ne $monitor.Left -or $rect.Top -ne $monitor.Top -or $rect.Right -ne $monitor.Right -or $rect.Bottom -ne $monitor.Bottom){throw 'Player does not cover the full monitor including taskbar'}
   $fullscreen=@{width=$rect.Right-$rect.Left;height=$rect.Bottom-$rect.Top;left=$rect.Left;top=$rect.Top}
  }
  if(-not $player.WaitForExit(35000)){throw ('Player hung: '+$mode)}
  $result=Get-Content -LiteralPath ($state+'.result.json') -Raw|ConvertFrom-Json
  $maximized=[BootFullscreenProbe]::IsZoomed([BootFullscreenProbe]::Find($fixture.Id))
  if($mode -eq 'complete' -and (-not $result.completed -or -not $result.maximizeRequested -or -not $maximized -or -not $result.ready -or -not $result.mediaOpened)){throw 'Completed animation did not maximize the verified owned window'}
  if($mode -ne 'complete' -and ($result.completed -or $result.maximizeRequested -or $maximized)){throw 'Skip or failure unexpectedly maximized the owned window'}
  if($mode -eq 'escape' -and (-not $result.mediaOpened -or $result.elapsedMs -gt 10000)){throw 'Escape event did not dismiss loaded video'}
  if($mode -eq 'timeout' -and ($result.elapsedMs -lt 9500 -or $result.elapsedMs -gt 14000 -or $result.ready)){throw 'Timeout budget not honored'}
  if($mode -eq 'media-failure' -and ($result.mediaOpened -or $result.elapsedMs -gt 10000)){throw 'Media failure did not exit promptly'}
  [void]$fixture.CloseMainWindow();[void]$fixture.WaitForExit(5000)
  $hostResult=Get-Content -LiteralPath ($state+'.fixture-result.json') -Raw|ConvertFrom-Json
  if($mode -ne 'complete' -and -not $hostResult.unchangedBounds){throw 'Skipped or failed animation changed host window position or size'}
  $results+=@{mode=$mode;elapsedMs=$result.elapsedMs;mediaOpened=$result.mediaOpened;hostBoundsPreserved=$hostResult.unchangedBounds;maximized=$maximized;fullscreen=$fullscreen}
 }finally{if($player -and -not $player.HasExited){[void]$player.CloseMainWindow();[void]$player.WaitForExit(5000)};if($fixture -and -not $fixture.HasExited){[void]$fixture.CloseMainWindow();[void]$fixture.WaitForExit(5000)}}
}
@{pass=$true;cases=$results}|ConvertTo-Json -Depth 5|Tee-Object -FilePath (Join-Path $project '.state/boot-animation-results.json')
