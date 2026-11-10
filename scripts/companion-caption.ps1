param([Parameter(Mandatory)][string]$DescriptorPath,[string]$FixtureHostPath,[string]$TestCommandsPath)
$ErrorActionPreference='Stop'
if($TestCommandsPath -and -not $FixtureHostPath){throw 'Test commands require an owned fixture host'}
. (Join-Path $PSScriptRoot 'caption-types.ps1')
. (Join-Path $PSScriptRoot 'boot-visibility.ps1')
Initialize-CaptionTypes
[void][CodexWallpaper.NativeCaption]::SetProcessDpiAwarenessContext([IntPtr](-4))
[void][CodexWallpaper.NativeCaption]::SetThreadDpiAwarenessContext([IntPtr](-4))
[Windows.Forms.Application]::EnableVisualStyles()
$descriptor=Get-Content -LiteralPath $DescriptorPath -Raw|ConvertFrom-Json
if($descriptor.host -ne '127.0.0.1' -or $descriptor.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid manager descriptor'}
& (Join-Path $PSScriptRoot 'companion-security.ps1') -Operation Verify -ManagerPid $descriptor.pid -StartTime $descriptor.startTime -ExpectedEntry $descriptor.entryFile -ExpectedNode $descriptor.nodePath|Out-Null
$script:address='http://127.0.0.1:'+$descriptor.port
$script:http=[Net.Http.HttpClient]::new();$script:http.Timeout=[TimeSpan]::FromSeconds(10);$script:http.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$descriptor.token)
$script:clientId=[guid]::NewGuid().ToString();$script:sequence=0;$script:pendingHost=$null;$script:pendingLink=$null;$script:target=$null;$script:targetWindow=[IntPtr]::Zero;$script:lastState=$null;$script:wantsOpen=$false;$script:failures=0;$script:tick=0;$script:web=$null;$script:webTask=$null;$script:configured=$false;$script:sidebarUrl=$null;$script:uiError=$null;$script:lastStatus='';$script:lastScale=0;$script:lastTest='';$script:testScriptTask=$null;$script:testScriptResult=$null
$runtimeRoot=Split-Path $DescriptorPath
$script:animationActive=$false
$statusPath=Join-Path $runtimeRoot 'caption-status.json'
$script:buttonForm=[CodexWallpaper.CaptionButtonForm]::new();$buttonForm.FormBorderStyle='None';$buttonForm.ShowInTaskbar=$false;$buttonForm.TopMost=$true;$buttonForm.AutoScaleMode='None';$buttonForm.BackColor=[Drawing.Color]::FromArgb(32,34,38)
$script:button=[Windows.Forms.Button]::new();$button.Dock='Fill';$button.Text='◈ Wallpaper';$button.AccessibleName='Wallpaper 桌布設定';$button.FlatStyle='Flat';$button.FlatAppearance.BorderColor=[Drawing.Color]::FromArgb(78,85,98);$button.BackColor=$buttonForm.BackColor;$button.ForeColor=[Drawing.Color]::FromArgb(225,231,240);$button.Cursor=[Windows.Forms.Cursors]::Hand;$button.TabStop=$false;$buttonForm.Controls.Add($button)
$button.FlatAppearance.BorderSize=0;$button.FlatAppearance.MouseOverBackColor=[Drawing.Color]::FromArgb(43,47,55)
function New-CaptionShape([int]$Width,[int]$Height){$path=[Drawing.Drawing2D.GraphicsPath]::new();$d=[Math]::Max(1,$Height-1);$path.AddArc(0,0,$d,$d,90,180);$path.AddArc($Width-$d-1,0,$d,$d,270,180);$path.CloseFigure();return $path}
$button.add_Paint({param($sender,$e);if($sender.Width -lt 2 -or $sender.Height -lt 2){return};$path=New-CaptionShape $sender.Width $sender.Height;$pen=[Drawing.Pen]::new([Drawing.Color]::FromArgb(78,85,98),[single]1);try{$e.Graphics.SmoothingMode='AntiAlias';$e.Graphics.DrawPath($pen,$path)}finally{$path.Dispose();$pen.Dispose()}})
$script:regionSize=''
$script:presentation=$null;$script:presentationRepairs=0
$script:tip=[Windows.Forms.ToolTip]::new();$tip.SetToolTip($button,'Wallpaper 桌布設定')
$script:sidebar=[CodexWallpaper.SidebarForm]::new();$sidebar.FormBorderStyle='None';$sidebar.ShowInTaskbar=$false;$sidebar.TopMost=$true;$sidebar.AutoScaleMode='None';$sidebar.BackColor=[Drawing.Color]::FromArgb(25,27,32);$sidebar.Text='Wallpaper 設定';$sidebar.KeyPreview=$true
$loading=[Windows.Forms.Label]::new();$loading.Dock='Fill';$loading.TextAlign='MiddleCenter';$loading.Text='正在開啟 Wallpaper…';$loading.ForeColor=[Drawing.Color]::White;$sidebar.Controls.Add($loading)
$sidebar.add_FormClosing({param($sender,$eventArgs);$eventArgs.Cancel=$true;$script:wantsOpen=$false;$sidebar.Hide()})
$sidebar.add_KeyDown({param($sender,$eventArgs);if($eventArgs.KeyCode -eq 'Escape'){$script:wantsOpen=$false;$sidebar.Hide()}})
function Send-CaptionRequest([string]$Action){$script:sequence++;$json=@{requestId=$script:clientId+'-'+$script:sequence;action=$Action;payload=@{}}|ConvertTo-Json -Compress;$content=[Net.Http.StringContent]::new($json,[Text.Encoding]::UTF8,'application/json');return $script:http.PostAsync($script:address+'/api/command',$content)}
function Read-CaptionReply($Task){$response=$Task.GetAwaiter().GetResult();try{$reply=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json;if(-not $response.IsSuccessStatusCode -or -not $reply.ok -or $reply.state.instanceId -ne $descriptor.instanceId){throw 'Manager connection changed'};return $reply}finally{$response.Dispose()}}
function Initialize-CaptionBrowser {
 if($script:web){return}
 $sdk=Join-Path $PSScriptRoot '../assets/webview2';$manifest=Get-Content -LiteralPath (Join-Path $sdk 'sdk.json') -Raw|ConvertFrom-Json
 foreach($file in $manifest.files){if($file.path -notin @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','LICENSE.txt') -or (Get-FileHash -LiteralPath (Join-Path $sdk $file.path)).Hash -ne $file.sha256){throw 'WebView2 component integrity mismatch'}}
 [void][Reflection.Assembly]::LoadFrom((Join-Path $sdk 'Microsoft.Web.WebView2.Core.dll'));[void][Reflection.Assembly]::LoadFrom((Join-Path $sdk 'Microsoft.Web.WebView2.WinForms.dll'))
 [void][Runtime.InteropServices.NativeLibrary]::Load((Join-Path $sdk 'WebView2Loader.dll'))
 $script:web=[Microsoft.Web.WebView2.WinForms.WebView2]::new();$web.Dock='Fill';$web.DefaultBackgroundColor=$sidebar.BackColor;$properties=[Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties]::new();$properties.UserDataFolder=Join-Path $runtimeRoot 'caption-browser';$web.CreationProperties=$properties;$sidebar.Controls.Add($web);$web.BringToFront();$web.CreateControl();$script:webTask=$web.EnsureCoreWebView2Async()
}
function Open-CaptionSidebar {
 if(Test-WallpaperBootActive -RuntimeRoot $runtimeRoot -ProjectRoot (Split-Path $PSScriptRoot)){$buttonForm.Hide();$sidebar.Hide();return}
 if($script:uiError){[void][Windows.Forms.MessageBox]::Show('側欄無法開啟，請從系統匣查看管理器。','Codex Wallpaper');return}
 $script:wantsOpen=-not $script:wantsOpen
 if(-not $script:wantsOpen){$sidebar.Hide();return}
 $layout=[CodexWallpaper.NativeCaption]::Layout($script:targetWindow);if($layout){$sidebar.SetBounds($layout.Sidebar.Left,$layout.Sidebar.Top,$layout.Sidebar.Width,$layout.Sidebar.Height)}
 if($script:targetWindow -ne [IntPtr]::Zero -and $script:target -and [CodexWallpaper.NativeCaption]::VerifyHost($script:target.pid,$script:target.startTime,$script:target.appPath)){$sidebar.Show();$sidebar.Activate()}
 try{Initialize-CaptionBrowser;if($script:configured){[void]$web.CoreWebView2.ExecuteScriptAsync('(()=>{const p=document.getElementById("codex-wallpaper-panel");if(p?.hidden)document.getElementById("codex-wallpaper-button").click()})()')}elseif(-not $script:pendingLink){$script:pendingLink=Send-CaptionRequest 'sidebar-link'}}catch{$script:uiError='RUNTIME_MISSING';$sidebar.Hide();$script:wantsOpen=$false;[void][Windows.Forms.MessageBox]::Show('缺少可用的 WebView2 控制元件或執行環境，請從系統匣查看管理器。','Codex Wallpaper')}
}
$button.add_Click({Open-CaptionSidebar})
function Publish-CaptionStatus([string]$State,$Layout){
 $value=@{state=$State;error=$script:uiError;sidebarVisible=$sidebar.Visible;buttonVisible=[bool]($buttonForm.IsHandleCreated -and [CodexWallpaper.NativeCaption]::IsWindowVisible($buttonForm.Handle));animationActive=$script:animationActive;initialized=$script:configured;layoutSource=[CodexWallpaper.NativeCaption]::LayoutSource;instanceId=$descriptor.instanceId;helperPid=$PID}
 if($script:presentation){$value.presentation=@{visible=$script:presentation.Visible;topMost=$script:presentation.TopMost;hitConfirmed=$script:presentation.HitConfirmed;repairs=$script:presentationRepairs}}
 if($Layout){$value.button=@{x=$Layout.Button.Left;y=$Layout.Button.Top;width=$Layout.Button.Width;height=$Layout.Button.Height};$value.nativeButtonsLeft=$Layout.NativeButtons.Left;$value.sidebar=@{x=$Layout.Sidebar.Left;y=$Layout.Sidebar.Top;width=$Layout.Sidebar.Width;height=$Layout.Sidebar.Height};if($TestCommandsPath){$value.hostRect=@{left=$Layout.Host.Left;top=$Layout.Host.Top;right=$Layout.Host.Right;bottom=$Layout.Host.Bottom};$value.scale=$Layout.Scale}}
 if($script:target){$value.hostVersion=$script:target.appVersion;$value.hostPid=$script:target.pid};if($TestCommandsPath){$value.testResult=$script:testScriptResult;$value.verifiedHost=$script:verifiedHost;$value.windowCount=$script:windowCount}
 $json=$value|ConvertTo-Json -Depth 5 -Compress;$changed=$json -ne $script:lastStatus;$now=[DateTime]::UtcNow
 if(-not $changed -and $script:lastHeartbeat -and ($now-$script:lastHeartbeat).TotalSeconds -lt 3){return}
 $script:lastHeartbeat=$now;$script:lastStatus=$json
 try{$value.observedAt=$now.ToString('o');$temporary=$statusPath+'.tmp';[IO.File]::WriteAllText($temporary,($value|ConvertTo-Json -Depth 5 -Compress));[IO.File]::Move($temporary,$statusPath,$true)}catch{}
 [Console]::WriteLine((@{state=$State;error=$script:uiError}|ConvertTo-Json -Compress))
}
$timer=[Windows.Forms.Timer]::new();$timer.Interval=200
$timer.add_Tick({
 try{
  $stopFile=Join-Path $runtimeRoot 'caption-stop';if((Test-Path -LiteralPath $stopFile) -and [IO.File]::ReadAllText($stopFile) -eq $descriptor.instanceId){$timer.Stop();[Windows.Forms.Application]::ExitThread();return}
  if($script:uiError -eq 'CAPTION_BOUNDS_UNAVAILABLE'){$script:uiError=$null}
  $script:tick++
  if($script:pendingHost -and $script:pendingHost.IsCompleted){$reply=Read-CaptionReply $script:pendingHost;$script:pendingHost=$null;$script:target=if($FixtureHostPath){Get-Content -LiteralPath $FixtureHostPath -Raw|ConvertFrom-Json}else{$reply.result.host};$script:lastState=$reply.state;$script:failures=0;$tip.SetToolTip($button,('Wallpaper 桌布設定'+$(if($reply.state.error.message){'：'+$reply.state.error.message}else{''})))}
  if(-not $script:pendingHost -and ($script:tick%10 -eq 1)){$script:pendingHost=Send-CaptionRequest 'caption-host'}
  if($script:pendingLink -and $script:pendingLink.IsCompleted){$reply=Read-CaptionReply $script:pendingLink;$script:pendingLink=$null;$url=[uri]$reply.result.url;if($url.GetLeftPart([UriPartial]::Authority) -ne $script:address -or $url.AbsolutePath -ne '/sidebar' -or $url.Fragment -notmatch '^#[a-f0-9]{48}$'){throw 'Invalid sidebar address'};$script:sidebarUrl=$url.AbsoluteUri}
  if($script:webTask -and $script:webTask.IsCompleted -and -not $script:configured){$webTask.GetAwaiter().GetResult();$web.CoreWebView2.Settings.AreDevToolsEnabled=$false;$web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=$false;$web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled=$false
   $web.CoreWebView2.add_NavigationStarting({param($sender,$e);$u=[uri]$e.Uri;if($u.AbsoluteUri -ne 'about:blank' -and ($u.GetLeftPart([UriPartial]::Authority) -ne $script:address -or $u.AbsolutePath -ne '/sidebar')){$e.Cancel=$true}})
   $web.CoreWebView2.add_NewWindowRequested({param($sender,$e);$e.Handled=$true})
   $web.CoreWebView2.add_WebMessageReceived({param($sender,$e);if($e.Source -eq $script:address+'/sidebar'){$message=$e.WebMessageAsJson|ConvertFrom-Json;if($message.type -eq 'close-sidebar'){$script:wantsOpen=$false;$sidebar.Hide()}}})
   $script:configured=$true
  }
  if($script:configured -and $script:sidebarUrl){$web.CoreWebView2.Navigate($script:sidebarUrl);$script:sidebarUrl=$null}
  if($script:testScriptTask -and $script:testScriptTask.IsCompleted){$script:testScriptResult=$script:testScriptTask.GetAwaiter().GetResult();$script:testScriptTask=$null;$script:lastStatus=''}
  if($TestCommandsPath -and (Test-Path -LiteralPath $TestCommandsPath)){$command=Get-Content -LiteralPath $TestCommandsPath -Raw|ConvertFrom-Json;if($command.id -ne $script:lastTest){$script:lastTest=$command.id;switch($command.action){'open'{Open-CaptionSidebar};'inspect'{if($script:configured){$script:testScriptTask=$web.CoreWebView2.ExecuteScriptAsync('JSON.stringify({tabs:[...document.querySelectorAll("[role=tab]")].map(n=>n.textContent),hidden:document.getElementById("codex-wallpaper-panel")?.hidden,hostStatus:document.querySelector(".cw-host-state")?.textContent,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})')}};'close'{$script:wantsOpen=$false;$sidebar.Hide()};'drop-layer'{[void][CodexWallpaper.NativeCaption]::SetWindowPos($buttonForm.Handle,[IntPtr]::new(-2),0,0,0,0,0x213)};'exit'{$timer.Stop();[Windows.Forms.Application]::ExitThread()}}}}
  $script:animationActive=Test-WallpaperBootActive -RuntimeRoot $runtimeRoot -ProjectRoot (Split-Path $PSScriptRoot)
  if($script:animationActive){$buttonForm.Hide();$sidebar.Hide();$script:presentation=$null;$script:verifiedHost=$false;$script:windowCount=0;Publish-CaptionStatus 'hidden' $null;return}
  $layout=$null;$visible=$false;$script:presentation=$null;$script:windowCount=0;$script:verifiedHost=$script:target -and [CodexWallpaper.NativeCaption]::VerifyHost($script:target.pid,$script:target.startTime,$script:target.appPath)
  if($script:verifiedHost){
   $windows=@([CodexWallpaper.NativeCaption]::Windows($script:target.pid));$script:windowCount=$windows.Count;$foreground=[CodexWallpaper.NativeCaption]::GetAncestor([CodexWallpaper.NativeCaption]::GetForegroundWindow(),2)
   if($windows -contains $foreground){$script:targetWindow=$foreground}elseif($windows -notcontains $script:targetWindow){$script:targetWindow=if($windows.Count -eq 1){$windows[0]}else{[IntPtr]::Zero}}
   if($script:targetWindow -ne [IntPtr]::Zero -and ($FixtureHostPath -or $foreground -eq $script:targetWindow -or $foreground -eq $sidebar.Handle)){$layout=[CodexWallpaper.NativeCaption]::Layout($script:targetWindow);$visible=$null -ne $layout}
  }
  if($visible){
   if($script:lastScale -ne $layout.Scale){$oldFont=$button.Font;$button.Font=[Drawing.Font]::new('Segoe UI',[single](13*$layout.Scale),[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel);if($script:lastScale -gt 0){$oldFont.Dispose()};$script:lastScale=$layout.Scale}
   $buttonBounds=[Drawing.Rectangle]::new($layout.Button.Left,$layout.Button.Top,$layout.Button.Width,$layout.Button.Height);if($buttonForm.Bounds -ne $buttonBounds){$buttonForm.Bounds=$buttonBounds};if(-not $buttonForm.Visible){$buttonForm.Show()}
   $sizeKey=[string]$layout.Button.Width+':'+$layout.Button.Height;if($sizeKey -ne $script:regionSize){$shape=New-CaptionShape $layout.Button.Width $layout.Button.Height;try{$previous=$buttonForm.Region;$buttonForm.Region=[Drawing.Region]::new($shape);if($previous){$previous.Dispose()};$script:regionSize=$sizeKey}finally{$shape.Dispose()}}
   $script:presentation=[CodexWallpaper.NativeCaption]::Present($buttonForm.Handle,$layout.Button,$script:targetWindow,$sidebar.Handle,[bool]$FixtureHostPath)
   if($script:presentation.Repaired){$script:presentationRepairs++;$buttonForm.Invalidate($true)}
   if($script:wantsOpen){$sidebarBounds=[Drawing.Rectangle]::new($layout.Sidebar.Left,$layout.Sidebar.Top,$layout.Sidebar.Width,$layout.Sidebar.Height);if($sidebar.Bounds -ne $sidebarBounds){$sidebar.Bounds=$sidebarBounds};if(-not $sidebar.Visible){$sidebar.Show()};[void][CodexWallpaper.NativeCaption]::Present($sidebar.Handle,$layout.Sidebar,$script:targetWindow,$sidebar.Handle,[bool]$FixtureHostPath)}
  }else{$buttonForm.Hide();$sidebar.Hide()}
  $state=if($script:uiError){'error'}elseif($visible -and $script:presentation.Visible -and $script:presentation.TopMost -and $script:presentation.HitConfirmed){'ready'}elseif($visible){'starting'}elseif([CodexWallpaper.NativeCaption]::IsProbing($script:targetWindow)){'starting'}elseif($script:target -and -not $layout -and $script:targetWindow -ne [IntPtr]::Zero -and $foreground -eq $script:targetWindow -and -not [CodexWallpaper.NativeCaption]::IsIconic($script:targetWindow)){'unsupported'}else{'hidden'}
  if($state -eq 'unsupported'){$script:uiError='CAPTION_BOUNDS_UNAVAILABLE'}elseif($script:uiError -eq 'CAPTION_BOUNDS_UNAVAILABLE'){$script:uiError=$null}
  Publish-CaptionStatus $state $layout
 }catch{[Console]::Error.WriteLine($_.Exception.GetType().Name+': '+$_.Exception.Message);$script:pendingHost=$null;$script:pendingLink=$null;$script:failures++;$buttonForm.Hide();$sidebar.Hide();if($script:failures -ge 3){$script:uiError='RUNTIME_MISSING';Publish-CaptionStatus 'error' $null;$timer.Stop();[Windows.Forms.Application]::ExitThread()}}
})
try{$timer.Start();[Windows.Forms.Application]::Run()}finally{$timer.Stop();$timer.Dispose();$buttonForm.Dispose();$sidebar.Dispose();$tip.Dispose();$http.Dispose()}
