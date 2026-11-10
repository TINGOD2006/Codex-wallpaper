param(
  [ValidateSet('Verify','Close','Show')][string]$Operation,
  [string]$IdentityPath
)
$ErrorActionPreference = 'Stop'
function Write-ThemeState {
  param([string]$Path, $Value)
  $temporary = $Path + '.' + [guid]::NewGuid().ToString() + '.tmp'
  try {
    $Value | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temporary -Encoding utf8
    [IO.File]::Move($temporary,$Path,$true)
  } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
function Test-ThemeIdentity {
  param($Identity, $Process, [object[]]$Listeners = @(), [switch]$RequirePort)
  if ($null -eq $Process -or $Identity.mode -notin @('Isolated','Existing')) { return $false }
  if ([int]$Process.ProcessId -ne [int]$Identity.pid) { return $false }
  if ([IO.Path]::GetFullPath($Process.ExecutablePath) -ne [IO.Path]::GetFullPath($Identity.appPath)) { return $false }
  if (([datetime]$Process.CreationDate).ToUniversalTime().Ticks.ToString() -ne [string]$Identity.startTime) { return $false }
  if (-not $Process.CommandLine -or -not $Process.CommandLine.Contains('--remote-debugging-port=0')) { return $false }
  if ($Identity.mode -eq 'Isolated' -and (-not $Identity.profilePath -or -not $Process.CommandLine.Contains([string]$Identity.profilePath))) { return $false }
  if ($RequirePort) {
    if ($Listeners.Count -ne 1) { return $false }
    $bound = $Listeners[0]
    if ($bound.LocalAddress -ne '127.0.0.1' -or [int]$bound.LocalPort -ne [int]$Identity.port -or [int]$bound.OwningProcess -ne [int]$Identity.pid -or $bound.RemotePort -ne 0 -or $bound.RemoteAddress -notin @('0.0.0.0','::')) { return $false }
  }
  return $true
}
function Get-ThemeNativeListeners {
  if(-not ('CodexWallpaperTcp' -as [type])){
    $source=Join-Path $PSScriptRoot '../src/companion/native-tcp.cs';$assembly=Join-Path $PSScriptRoot '../assets/native/CodexWallpaperTcp.dll';$ready=$false
    try{$build=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../assets/native/tcp-build.json') -Raw|ConvertFrom-Json;$ready=$build.schemaVersion -eq 1 -and (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() -eq $build.sourceSha256 -and (Get-FileHash -LiteralPath $assembly).Hash.ToLowerInvariant() -eq $build.assemblySha256}catch{}
    if($ready){Add-Type -Path $assembly}else{Add-Type -Path $source}
  }
  [CodexWallpaperTcp]::Snapshot()
}
function Get-ThemeBoundEndpoints {
  param([int]$OwningProcess,[int]$LocalPort)
  # Read a fresh native owner-PID table without starting the slower CIM network
  # provider. Keep the provider fallback for systems that cannot use IP Helper.
  try{$rows=@(Get-ThemeNativeListeners)}catch{
    $query=@{RemotePort=0;ErrorAction='SilentlyContinue'}
    if($PSBoundParameters.ContainsKey('OwningProcess')){$query.OwningProcess=$OwningProcess}
    if($PSBoundParameters.ContainsKey('LocalPort')){$query.LocalPort=$LocalPort}
    $rows=@(Get-NetTCPConnection @query)
  }
  $byProcess=$PSBoundParameters.ContainsKey('OwningProcess');$byPort=$PSBoundParameters.ContainsKey('LocalPort')
  @($rows|Where-Object {$_.RemotePort -eq 0 -and $_.RemoteAddress -in @('0.0.0.0','::') -and (-not $byProcess -or [int]$_.OwningProcess -eq $OwningProcess) -and (-not $byPort -or [int]$_.LocalPort -eq $LocalPort)})
}
function Get-ThemePackage {
  param([string]$AppPath)
  $packages = @(Get-AppxPackage -Name OpenAI.Codex)
  if ($packages.Count -ne 1) { throw '找不到唯一的官方 OpenAI.Codex 安裝套件。' }
  $package = $packages[0]
  $officialPath = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
  if ($AppPath -and [IO.Path]::GetFullPath($AppPath) -ne [IO.Path]::GetFullPath($officialPath)) { throw '指定的 AppPath 與官方安裝套件不符。' }
  if (-not (Test-Path -LiteralPath $officialPath -PathType Leaf)) { throw '官方桌面程式不存在。' }
  return @{appPath=$officialPath;appVersion=$package.Version.ToString()}
}
function Get-ThemeProcess {
  param([int]$ProcessId)
  return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
}
function Confirm-ThemeSession {
  param($Identity, [switch]$RequirePort)
  $process = Get-ThemeProcess $Identity.pid
  $listeners = @()
  if ($RequirePort) { $listeners = @(Get-ThemeBoundEndpoints -LocalPort $Identity.port) }
  if (-not (Test-ThemeIdentity $Identity $process $listeners -RequirePort:$RequirePort)) { throw '工作階段程序或除錯連接埠身分不符，已拒絕操作。' }
}
function Show-ThemeDesktop {
  param($Identity)
  Confirm-ThemeSession $Identity -RequirePort
  if($Identity.mode -eq 'Existing'){
    . (Join-Path $PSScriptRoot 'codex-native-activation.ps1')
    . (Join-Path $PSScriptRoot 'window-activation.ps1')
    $window=[CodexWindowActivation]::Find([int]$Identity.pid)
    for($attempt=0;$window -eq [IntPtr]::Zero -and $attempt -lt 150;$attempt++){Start-Sleep -Milliseconds 100;$window=[CodexWindowActivation]::Find([int]$Identity.pid)}
    if(-not [CodexWindowActivation]::ValidMain($window,[int]$Identity.pid)){throw '無法唯一核對 Codex 主視窗；未另開程序。'}
    $package=@(Get-AppxPackage -Name OpenAI.Codex)
    if($package.Count -ne 1 -or [IO.Path]::GetFullPath((Join-Path $package[0].InstallLocation 'app/ChatGPT.exe')) -ne [IO.Path]::GetFullPath($Identity.appPath)){throw 'Official activation identity changed'}
    Invoke-CodexNativeActivation -Package @{packageFamily=$package[0].PackageFamilyName}
    # Cosmetic metadata is applied once per verified window/script version, not on every click.
    $metadataFile=Join-Path $Identity.runDirectory 'taskbar-applied.json'
    $stamp=[string](Get-Item -LiteralPath (Join-Path $PSScriptRoot 'codex-taskbar-identity.ps1')).LastWriteTimeUtc.Ticks
    $expected=@{pid=$Identity.pid;startTime=$Identity.startTime;window=$window.ToInt64().ToString();scriptStamp=$stamp}
    $cached=$null;try{$cached=Get-Content -LiteralPath $metadataFile -Raw|ConvertFrom-Json}catch{}
    if(-not $cached -or $cached.pid -ne $expected.pid -or $cached.startTime -ne $expected.startTime -or $cached.window -ne $expected.window -or $cached.scriptStamp -ne $stamp){
      try{& (Join-Path $PSScriptRoot 'codex-taskbar-identity.ps1') -IdentityPath (Join-Path $Identity.runDirectory 'session.json') -Action Apply | Out-Null;Write-ThemeState $metadataFile $expected}catch{[Console]::Error.WriteLine('TASKBAR_IDENTITY_UNAVAILABLE')}
    }
    return
  }
  $parameters = @{FilePath=$Identity.appPath;WindowStyle='Hidden';PassThru=$true;RedirectStandardOutput=(Join-Path $Identity.runDirectory 'show.stdout.log');RedirectStandardError=(Join-Path $Identity.runDirectory 'show.stderr.log')}
  if ($Identity.mode -eq 'Isolated') {
    $parameters.ArgumentList = @(('"--user-data-dir={0}"' -f $Identity.profilePath))
    $parameters.Environment = @{CODEX_ELECTRON_USER_DATA_PATH=$Identity.profilePath;CODEX_HOME=(Join-Path (Split-Path $Identity.profilePath) 'agent-home')}
  }
  # The official single-instance handler restores the existing window, then exits.
  $activation = Start-Process @parameters
  if (-not $activation.WaitForExit(5000)) { throw '顯示視窗的請求尚未完成，請從工作列切換至隔離視窗。' }
}
function Close-ThemeDesktop {
  param($Identity)
  if ($null -eq (Get-ThemeProcess $Identity.pid)) { return @{stopped=$true;alreadyExited=$true} }
  Confirm-ThemeSession $Identity
  & taskkill.exe /PID $Identity.pid /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '無法結束受管理的桌面程式。' }
  for ($i=0;$i -lt 20;$i++) {
    if ($null -eq (Get-ThemeProcess $Identity.pid) -and @(Get-ThemeBoundEndpoints -LocalPort $Identity.port).Count -eq 0) { return @{stopped=$true;debuggingPortClosed=$true} }
    Start-Sleep -Milliseconds 100
  }
  throw '程序或除錯連接埠尚未確認關閉。'
}
function Start-ThemeDesktop {
  param([ValidateSet('Isolated','Existing')][string]$Mode, [string]$StateRoot, [string]$AppPath)
  $package = Get-ThemePackage $AppPath
  if ($Mode -eq 'Existing') {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" | Where-Object { $_.ExecutablePath -eq $package.appPath })
    if ($running.Count) { throw '請先手動完全結束原本的 ChatGPT／Codex 桌面程式，再用此入口啟動；工具不會強制關閉目前聊天。' }
  }
  $sessionId = [guid]::NewGuid().ToString()
  $runDirectory = Join-Path $StateRoot "runs\$sessionId"
  New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
  $arguments = @('--remote-debugging-address=127.0.0.1','--remote-debugging-port=0')
  $environment = @{}
  $profilePath = $null
  if ($Mode -eq 'Isolated') {
    $profilePath = [IO.Path]::GetFullPath((Join-Path $StateRoot 'isolated\profile'))
    $agentPath = [IO.Path]::GetFullPath((Join-Path $StateRoot 'isolated\agent-home'))
    New-Item -ItemType Directory -Path $profilePath,$agentPath -Force | Out-Null
    $environment['CODEX_ELECTRON_USER_DATA_PATH'] = $profilePath
    $environment['CODEX_HOME'] = $agentPath
    $arguments += '"--user-data-dir=' + $profilePath + '"'
  }
  $parameters = @{FilePath=$package.appPath;ArgumentList=$arguments;PassThru=$true;WindowStyle='Hidden';RedirectStandardOutput=(Join-Path $runDirectory 'desktop.stdout.log');RedirectStandardError=(Join-Path $runDirectory 'desktop.stderr.log')}
  if ($environment.Count) { $parameters.Environment = $environment }
  $child = Start-Process @parameters
  $process = Get-ThemeProcess $child.Id
  if ($null -eq $process) { throw '桌面程式在建立工作階段前已退出。' }
  $identity = @{sessionId=$sessionId;pid=$child.Id;startTime=$process.CreationDate.ToUniversalTime().Ticks.ToString();appPath=$package.appPath;appVersion=$package.appVersion;mode=$Mode;profilePath=$profilePath;port=0;runDirectory=$runDirectory}
  try {
    for ($attempt=0;$attempt -lt 50;$attempt++) {
      if ($null -eq (Get-ThemeProcess $child.Id)) { throw '桌面程式在初始化時退出；請查看 .state/runs 中的啟動紀錄。' }
      $listeners = @(Get-ThemeBoundEndpoints -OwningProcess $child.Id)
      foreach ($listener in $listeners) {
        if ($listener.LocalAddress -ne '127.0.0.1') { continue }
        try {
          $response = Invoke-RestMethod -Uri "http://127.0.0.1:$($listener.LocalPort)/json/version" -TimeoutSec 1
          if ($response.webSocketDebuggerUrl) {
            $identity.port = [int]$listener.LocalPort
            Confirm-ThemeSession $identity -RequirePort
            return $identity
          }
        } catch { if ($identity.port -gt 0) { throw } }
      }
      Start-Sleep -Milliseconds 200
    }
    throw '等待本機除錯入口逾時。'
  } catch {
    $reason = $_
    Close-ThemeDesktop $identity | Out-Null
    throw $reason
  }
}
if ($MyInvocation.InvocationName -ne '.' -and $Operation) {
  $identity = Get-Content -LiteralPath $IdentityPath -Raw | ConvertFrom-Json
  if ($Operation -eq 'Verify') { Confirm-ThemeSession $identity -RequirePort; @{verified=$true} | ConvertTo-Json -Compress }
  elseif ($Operation -eq 'Show') { Show-ThemeDesktop $identity; @{shown=$true} | ConvertTo-Json -Compress }
  else { Close-ThemeDesktop $identity | ConvertTo-Json -Compress }
}
