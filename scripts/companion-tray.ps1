param([Parameter(Mandatory)][string]$DescriptorPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$descriptor=Get-Content -LiteralPath $DescriptorPath -Raw|ConvertFrom-Json
if($descriptor.host -ne '127.0.0.1' -or $descriptor.token -notmatch '^[a-f0-9]{64}$'){throw 'Invalid manager descriptor'}
$script:companionAddress='http://127.0.0.1:'+$descriptor.port
$script:companionHttp=[Net.Http.HttpClient]::new();$script:companionHttp.Timeout=[TimeSpan]::FromSeconds(60)
$script:companionHttp.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$descriptor.token)
$script:companionClientId=[guid]::NewGuid().ToString();$script:companionSequence=0;$script:companionLastState=$null;$script:companionPending=$null;$script:companionPoll=$null;$script:companionTick=0;$script:companionFailures=0;$script:companionLastError=''
$notify=[Windows.Forms.NotifyIcon]::new();$notify.Icon=[Drawing.SystemIcons]::Information;$notify.Text='Codex Wallpaper';$notify.Visible=$true
function Send-CompanionTrayCommand([string]$Action,[hashtable]$Payload=@{}){
 if($script:companionPending){return}
 $script:companionSequence++
 $json=@{requestId=$script:companionClientId+'-'+$script:companionSequence;action=$Action;payload=$Payload}|ConvertTo-Json -Depth 6 -Compress
 $content=[Net.Http.StringContent]::new($json,[Text.Encoding]::UTF8,'application/json')
 $script:companionPending=$script:companionHttp.PostAsync($script:companionAddress+'/api/command',$content)
}
function Update-CompanionTray($State){
 $script:companionLastState=$State
 $labels=@{idle='等待宿主';'needs-launch'='需要由管理器啟動';connecting='正在連線';checking='正在檢查';active='已套用';partial='部分區域可用';paused='已暫停播放';disabled='已停用';incompatible='不相容';error='發生錯誤';offline='管理器離線'}
 $label='Codex Wallpaper：'+$labels[[string]$State.phase];$notify.Text=$label.Substring(0,[Math]::Min(63,$label.Length))
 $notify.Icon=if($State.phase -in @('error','incompatible')){[Drawing.SystemIcons]::Error}elseif($State.phase -eq 'needs-launch'){[Drawing.SystemIcons]::Warning}else{[Drawing.SystemIcons]::Information}
 if($State.error.code -and $State.error.code -ne $script:companionLastError){$notify.BalloonTipTitle='Codex Wallpaper';$notify.BalloonTipText=[string]$State.error.message;$notify.ShowBalloonTip(4000)}
 $script:companionLastError=[string]$State.error.code
}
$menu=[Windows.Forms.ContextMenuStrip]::new()
$show=$menu.Items.Add('顯示管理器');$show.add_Click({Send-CompanionTrayCommand 'show-window'})
$toggle=$menu.Items.Add('啟用／停用');$toggle.add_Click({Send-CompanionTrayCommand 'set-enabled' @{enabled=(-not $script:companionLastState.desired.enabled)}})
$retry=$menu.Items.Add('重新偵測');$retry.add_Click({Send-CompanionTrayCommand 'reconnect'})
$wait=$menu.Items.Add('正常退出後自動接回');$wait.add_Click({Send-CompanionTrayCommand 'wait-for-exit-and-launch' @{hostId='codex-desktop'}})
$exitItem=$menu.Items.Add('退出管理器');$exitItem.add_Click({Send-CompanionTrayCommand 'exit'})
$notify.ContextMenuStrip=$menu;$notify.add_DoubleClick({Send-CompanionTrayCommand 'show-window'})
$timer=[Windows.Forms.Timer]::new();$timer.Interval=500
$timer.add_Tick({
 try{
  if($script:companionPending -and $script:companionPending.IsCompleted){$result=$script:companionPending.GetAwaiter().GetResult();$reply=$result.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json;$script:companionPending=$null;if($reply.state){Update-CompanionTray $reply.state};if(-not $reply.ok){[void][Windows.Forms.MessageBox]::Show([string]$reply.error.message,'Codex Wallpaper')}}
  if($script:companionPoll -and $script:companionPoll.IsCompleted){$result=$script:companionPoll.GetAwaiter().GetResult();$reply=$result.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json;$script:companionPoll=$null;if($reply.state.instanceId -ne $descriptor.instanceId){throw 'Manager changed'};Update-CompanionTray $reply.state;$script:companionFailures=0}
  $script:companionTick++;if(-not $script:companionPoll -and $script:companionTick%4 -eq 0){$script:companionPoll=$script:companionHttp.GetAsync($script:companionAddress+'/api/status')}
 }catch{$script:companionPending=$null;$script:companionPoll=$null;$script:companionFailures++;if($script:companionFailures -ge 3){$timer.Stop();$notify.Visible=$false;[Windows.Forms.Application]::ExitThread()}}
})
try{$timer.Start();[Windows.Forms.Application]::Run()}finally{$timer.Stop();$timer.Dispose();$notify.Dispose();$menu.Dispose();$script:companionHttp.Dispose()}
