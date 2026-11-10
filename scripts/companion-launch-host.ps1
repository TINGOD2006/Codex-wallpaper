param([ValidateSet('codex-desktop')][string]$HostId='codex-desktop',[Parameter(Mandatory)][string]$StateRoot,[int]$Generation=1,[switch]$ConnectOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'windows-session.ps1')
. (Join-Path $PSScriptRoot 'companion-hosts.ps1')
function Fail-Launch([string]$Code,[string]$Message){throw [InvalidOperationException]::new($Code+'|'+$Message)}
try{
 $packages=@(Get-CompanionPackages -HostId $HostId)
 if($packages.Count -ne 1){Fail-Launch 'HOST_NOT_FOUND' '找不到唯一的官方宿主安裝。'}
 $package=$packages[0];$existing=@((Get-CompanionSnapshot -Packages @($package)).processes)
 if($existing.Count -gt 1){Fail-Launch 'HOST_IDENTITY_CHANGED' '有多個主程序，無法唯一確認接入目標。'}
 if($existing.Count -eq 1 -and -not $existing[0].managed){Fail-Launch 'HOST_NEEDS_MANAGED_LAUNCH' '請正常完全退出目前視窗，再由管理器開啟。'}
 # Passive reconnects must never race a normal exit and restart Codex without
 # the clicked entry (and its animation). Only the launcher owns native startup.
 if(-not $existing.Count -and $ConnectOnly){Fail-Launch 'HOST_IDENTITY_CHANGED' '原版 Codex 已退出；等待使用者從原入口重新開啟。'}
 $sessionId=[guid]::NewGuid().ToString();$runDirectory=Join-Path ([IO.Path]::GetFullPath($StateRoot)) $sessionId
 New-Item -ItemType Directory -Path $runDirectory -Force|Out-Null
 $started=[datetime]::UtcNow
 if(-not $existing.Count){
  $child=Start-Process -FilePath $package.appPath -ArgumentList @('--remote-debugging-address=127.0.0.1','--remote-debugging-port=0') -WindowStyle Normal -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'host.stdout.log') -RedirectStandardError (Join-Path $runDirectory 'host.stderr.log')
 }
 $deadline=[datetime]::UtcNow.AddSeconds(6);$verifiedRootWithoutEndpoint=$false
 for($attempt=0;$attempt -lt 24 -and [datetime]::UtcNow -lt $deadline;$attempt++){
  $roots=@(Get-CompanionSnapshot -Packages @($package));$candidates=@(Select-CompanionLaunchCandidates -Candidates @($roots.processes) -StartedTicks $started.Ticks -ReuseExisting ([bool]$existing.Count))
  if($candidates.Count -gt 1){Fail-Launch 'HOST_IDENTITY_CHANGED' '接入目標不唯一。'}
  if($candidates.Count -eq 1){
   $candidate=$candidates[0]
   $verifiedRootWithoutEndpoint=$true
   $identity=@{sessionId=$sessionId;pid=$candidate.pid;startTime=$candidate.startTime;appPath=$package.appPath;appVersion=$package.appVersion;mode='Existing';profilePath=$null;port=0;runDirectory=$runDirectory;hostId=$HostId;generation=$Generation}
   $valid=@()
   foreach($listener in @(Get-ThemeBoundEndpoints -OwningProcess $candidate.pid)){
    if($listener.LocalAddress -ne '127.0.0.1'){continue}
    try{$version=Invoke-RestMethod -Uri "http://127.0.0.1:$($listener.LocalPort)/json/version" -TimeoutSec 1;if($version.webSocketDebuggerUrl){$valid+=,$listener}}catch{}
   }
   if($valid.Count -eq 1){$identity.port=[int]$valid[0].LocalPort;Confirm-ThemeSession $identity -RequirePort;Write-ThemeState (Join-Path $runDirectory 'session.json') $identity;if(-not $ConnectOnly){Show-ThemeDesktop $identity};@{ok=$true;session=$identity}|ConvertTo-Json -Depth 6 -Compress;exit 0}
  }
  Start-Sleep -Milliseconds 250
 }
 if($verifiedRootWithoutEndpoint){Fail-Launch 'HOST_ENDPOINT_PENDING' 'Codex 已啟動，桌布接入端點尚未就緒，正在背景等待。'}
 Fail-Launch 'HOST_LAUNCH_FAILED' '宿主未能建立經核對的接入端點；未關閉任何宿主程序。'
}catch{
 $detail=@{at=[DateTime]::UtcNow.ToString('o');stage='host-launch';message=$_.Exception.Message}
 try{if($runDirectory){$detail|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $runDirectory 'launch-error.json') -Encoding utf8}}catch{}
 $parts=$_.Exception.Message.Split('|',2);$code=if($parts[0] -match '^HOST_'){$parts[0]}else{'HOST_LAUNCH_FAILED'}
 $message=if($parts.Count -gt 1){$parts[1]}else{'宿主初始化失敗，請重新偵測或查看診斷。'}
 @{ok=$false;error=@{code=$code;message=$message}}|ConvertTo-Json -Compress
}
