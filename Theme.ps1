param(
  [ValidateSet('Start','Apply','Disable','Status','Close')][string]$Action = 'Status',
  [ValidateSet('Isolated','Existing')][string]$Mode = 'Existing',
  [string]$AppPath,
  [string]$BackgroundPath,
  [Nullable[double]]$OverlayOpacity,
  [Nullable[double]]$PositionX
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scripts\windows-session.ps1')
$stateRoot = Join-Path $PSScriptRoot '.state'
$identityPath = Join-Path $stateRoot 'session.json'
$cli = Join-Path $PSScriptRoot 'src\cli.cjs'
$node = (Get-Command node -ErrorAction Stop).Source
$version = & $node -p 'process.versions.node'
if ([int]($version.Split('.')[0]) -lt 24) { throw '需要 Node.js 24 或更新版本。' }
$env:MIKU_PWSH = (Get-Process -Id $PID).Path
if($Mode -eq 'Existing'){
  . (Join-Path $PSScriptRoot 'scripts/companion-paths.ps1')
  $companionRoot=Get-CompanionInstallRoot
  $companionCommand=Join-Path $PSScriptRoot 'src/companion/command.cjs'
  if($Action -eq 'Start'){
    if($PSBoundParameters.ContainsKey('BackgroundPath')){throw '請在獨立管理器的桌布庫匯入圖片；原旗標仍可用於明確的Isolated測試模式。'}
    $installedLauncher=Join-Path $companionRoot 'app/scripts/start-companion.ps1'
    if(-not(Test-Path -LiteralPath $installedLauncher)){throw '請先執行安裝獨立桌布插件.cmd。'}
    & $installedLauncher -Action Show
    $readingArgs=@();if($PSBoundParameters.ContainsKey('OverlayOpacity')){$readingArgs+=@('--scrim',[string][double]$OverlayOpacity)};if($PSBoundParameters.ContainsKey('PositionX')){$readingArgs+=@('--x',[string][double]$PositionX)}
    if($readingArgs.Count){& $node $companionCommand patch-reading @readingArgs;if($LASTEXITCODE -ne 0){throw '閱讀設定更新未確認。'}}
    return
  }
  if($Action -eq 'Status'){$result=& $node $companionCommand status 2>$null;if($LASTEXITCODE -eq 0){$result}else{@{state='offline';enabled=$false;panelReady=$false;reason='獨立管理器未運行，舊狀態不作為目前套用證據。'}|ConvertTo-Json};return}
  if($Action -in @('Apply','Disable')){$arguments=@($companionCommand,'set-enabled');if($Action -eq 'Apply'){$arguments+='--enabled'};& $node @arguments;if($LASTEXITCODE -ne 0){throw '管理器未確認設定變更。'};return}
  if($Action -eq 'Close'){
    $closed=& $node $companionCommand exit 2>$null
    $sessions=Join-Path $companionRoot 'runtime/hosts';$valid=@{}
    if(Test-Path -LiteralPath $sessions){foreach($file in Get-ChildItem -LiteralPath $sessions -Recurse -Filter session.json -File){try{$candidate=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json;Confirm-ThemeSession $candidate -RequirePort;$valid[[string]$candidate.pid]=$candidate}catch{}}}
    if($valid.Count -ne 1){throw '沒有唯一可核對的受管理宿主；未關閉任何原版程序。'}
    Close-ThemeDesktop -Identity (@($valid.Values)[0])|ConvertTo-Json;return
  }
}
function Invoke-ThemeCli {
  param([string[]]$Arguments)
  $output = & $node $cli @Arguments
  if ($LASTEXITCODE -ne 0) { throw "主題操作失敗：$($Arguments[0])" }
  return $output
}
$lockKey = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($PSScriptRoot))))
$mutex = [Threading.Mutex]::new($false,"Local\MikuDesktopTheme-$lockKey")
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw '另一個主題操作仍在進行，請稍後重試。' }
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  if ($Action -eq 'Status') { Invoke-ThemeCli @('status'); return }
  if ($Action -in @('Start','Apply')) {
    $patch = @{}
    if ($PSBoundParameters.ContainsKey('BackgroundPath')) { $patch.backgroundPath = [IO.Path]::GetFullPath($BackgroundPath) }
    if ($PSBoundParameters.ContainsKey('OverlayOpacity')) { $patch.overlayOpacity = [double]$OverlayOpacity }
    if ($PSBoundParameters.ContainsKey('PositionX')) { $patch.positionX = [double]$PositionX }
    if ($patch.Count) {
      $patchFile = Join-Path $stateRoot ('config-patch-' + [guid]::NewGuid().ToString() + '.json')
      try { $patch | ConvertTo-Json | Set-Content -LiteralPath $patchFile -Encoding utf8; Invoke-ThemeCli @('configure',$patchFile) | Out-Null }
      finally { Remove-Item -LiteralPath $patchFile -ErrorAction SilentlyContinue }
    }
    Invoke-ThemeCli @('validate') | Out-Null
  }
  if ($Action -eq 'Start') {
    $identity = $null
    if (Test-Path -LiteralPath $identityPath) {
      $saved = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
      if ($null -ne (Get-ThemeProcess $saved.pid)) {
        Confirm-ThemeSession $saved -RequirePort
        if ($saved.mode -ne $Mode) { throw '已有另一個模式的受管理實例，請先用 Close 關閉它。' }
        $identity = $saved
        if ($saved.daemonPid) {
          $loader = Get-ThemeProcess $saved.daemonPid
          if ($null -ne $loader -and $loader.ExecutablePath -eq $node -and $loader.CreationDate.ToUniversalTime().Ticks.ToString() -eq [string]$saved.daemonStartTime) {
            Show-ThemeDesktop $saved
            Invoke-ThemeCli @('status'); return
          }
        }
      }
    }
    if ($null -eq $identity) {
      $identity = Start-ThemeDesktop -Mode $Mode -StateRoot $stateRoot -AppPath $AppPath
      Write-ThemeState $identityPath $identity
    }
    $loader = Start-Process -FilePath $node -ArgumentList @(('"{0}"' -f $cli),'daemon',('"{0}"' -f $identityPath)) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $identity.runDirectory 'loader.stdout.log') -RedirectStandardError (Join-Path $identity.runDirectory 'loader.stderr.log')
    $loaderInfo = Get-ThemeProcess $loader.Id
    if ($identity -is [hashtable]) { $identity.daemonPid = $loader.Id; $identity.daemonStartTime = $loaderInfo.CreationDate.ToUniversalTime().Ticks.ToString() }
    else { $identity | Add-Member -NotePropertyName daemonPid -NotePropertyValue $loader.Id -Force; $identity | Add-Member -NotePropertyName daemonStartTime -NotePropertyValue $loaderInfo.CreationDate.ToUniversalTime().Ticks.ToString() -Force }
    Write-ThemeState $identityPath $identity
    for ($i=0;$i -lt 60;$i++) {
      $statusPath = Join-Path $stateRoot 'status.json'
      if (Test-Path -LiteralPath $statusPath) {
        $state = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        if ($state.sessionId -eq $identity.sessionId -and $state.daemonPid -eq $loader.Id -and ($state.panelReady -eq $true -or $state.state -in @('unsupported','error'))) { $state | ConvertTo-Json -Depth 12; return }
      }
      if ($loader.HasExited) { throw '主題載入器已退出，請查看 .state/runs 中的紀錄。' }
      Start-Sleep -Milliseconds 250
    }
    throw '主題載入器尚未就緒；請執行 Status 檢查狀態。'
  }
  if (-not (Test-Path -LiteralPath $identityPath)) { throw '沒有受管理的桌面工作階段，請先 Start。' }
  $identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
  if ($Action -eq 'Close') { Close-ThemeDesktop $identity | ConvertTo-Json; return }
  Confirm-ThemeSession $identity -RequirePort
  Invoke-ThemeCli @($Action.ToLowerInvariant())
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
