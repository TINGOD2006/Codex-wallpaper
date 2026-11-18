$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/caption-types.ps1')
Initialize-CaptionTypes
[void][CodexWallpaper.NativeCaption]::SetThreadDpiAwarenessContext([IntPtr](-4))
$project=Split-Path $PSScriptRoot
$scratch=Join-Path $project ('.state/caption-motion-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force|Out-Null
$identityPath=Join-Path $scratch 'host.json'
$commandsPath=Join-Path $scratch 'commands.json'
$fixture=Join-Path $PSScriptRoot 'companion/caption-fixture.ps1'
$arguments=@('-NoProfile','-STA','-File',('"'+$fixture+'"'),'-IdentityPath',('"'+$identityPath+'"'),'-CommandsPath',('"'+$commandsPath+'"'))
$process=Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -WindowStyle Hidden -PassThru
$button=[CodexWallpaper.CaptionButtonForm]::new()
$sidebar=[CodexWallpaper.SidebarForm]::new()
$follower=[CodexWallpaper.CaptionMotionFollower]::new($button,$sidebar,$true)
try{
 $layout=$null
 for($n=0;$n -lt 100 -and -not $layout;$n++){
  if(Test-Path -LiteralPath $identityPath){
   $identity=Get-Content -LiteralPath $identityPath -Raw|ConvertFrom-Json
   if($identity.pid -ne $process.Id){throw 'Unexpected fixture identity'}
   $windows=@([CodexWallpaper.NativeCaption]::Windows($process.Id))
   if($windows.Count -eq 1){$window=$windows[0];$layout=[CodexWallpaper.NativeCaption]::Layout($window)}
  }
  if(-not $layout){Start-Sleep -Milliseconds 50}
 }
 if(-not $layout){throw 'Owned fixture did not expose caption bounds'}
 $button.StartPosition=$sidebar.StartPosition='Manual'
 $button.SetBounds($layout.Button.Left,$layout.Button.Top,$layout.Button.Width,$layout.Button.Height)
 $sidebar.SetBounds($layout.Sidebar.Left,$layout.Sidebar.Top,$layout.Sidebar.Width,$layout.Sidebar.Height)
 $button.Show();$sidebar.Show();[Windows.Forms.Application]::DoEvents()
 $follower.Watch($window)
 $initialButton=$button.Bounds;$initialSidebar=$sidebar.Bounds
 '{"id":"1","action":"translate"}'|Set-Content -LiteralPath $commandsPath
 for($n=0;$n -lt 200;$n++){
  [Windows.Forms.Application]::DoEvents()
  if($button.Left -eq $initialButton.Left+64 -and $sidebar.Left -eq $initialSidebar.Left+64){break}
  Start-Sleep -Milliseconds 10
 }
 if($button.Left -ne $initialButton.Left+64 -or $sidebar.Left -ne $initialSidebar.Left+64){throw 'Native location events did not move the overlays'}
 if($button.Top -ne $initialButton.Top+32 -or $sidebar.Top -ne $initialSidebar.Top+32 -or $button.Size -ne $initialButton.Size -or $sidebar.Size -ne $initialSidebar.Size){throw 'Location tracking changed size or did not apply both axes'}
 'PASS: native window location events move both overlays without polling or resizing them'
}finally{
 $follower.Dispose();$button.Dispose();$sidebar.Dispose()
 if(-not $process.HasExited){'{"id":"2","action":"exit"}'|Set-Content -LiteralPath $commandsPath;[void]$process.WaitForExit(3000)}
 if(-not $process.HasExited){[void]$process.CloseMainWindow();[void]$process.WaitForExit(3000)}
 $process.Dispose()
}
