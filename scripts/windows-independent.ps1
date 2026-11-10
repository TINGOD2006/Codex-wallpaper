function Start-ThemeIndependentProcess {
  param([string]$PowerShellPath, [string]$ScriptPath, [string]$WorkingDirectory)
  $resolvedRoot = [IO.Path]::GetFullPath($WorkingDirectory).TrimEnd('\') + '\'
  $resolvedScript = [IO.Path]::GetFullPath($ScriptPath)
  if (-not $resolvedScript.StartsWith($resolvedRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($resolvedScript) -ne '.ps1') { throw '獨立程序必須是主題資料夾內的 PowerShell 指令碼。' }
  if (-not (Test-Path -LiteralPath $resolvedScript -PathType Leaf)) { throw '找不到獨立啟動指令碼。' }
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
  # Local WMI creates this worker outside the caller's application process tree.
  # No service, scheduled task or startup registration is installed.
  $commandLine = '"{0}" -NoProfile -WindowStyle Hidden -File "{1}"' -f $PowerShellPath,$resolvedScript
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$commandLine;CurrentDirectory=$WorkingDirectory;ProcessStartupInformation=$startup}
  if ($created.ReturnValue -ne 0) { throw "無法建立獨立主題程序：$($created.ReturnValue)" }
  $worker = Get-CimInstance Win32_Process -Filter "ProcessId = $($created.ProcessId)"
  $caller = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
  if ($null -eq $worker -or $worker.ExecutablePath -ne $PowerShellPath -or -not $worker.CommandLine.Contains($resolvedScript)) { throw '獨立程序身分無法確認。' }
  if ($worker.SessionId -ne $caller.SessionId) { Stop-Process -Id $worker.ProcessId; throw '獨立程序不在目前桌面工作階段，已停止。' }
  return @{pid=[int]$worker.ProcessId;startTime=$worker.CreationDate.ToUniversalTime().Ticks.ToString();parentPid=[int]$worker.ParentProcessId;sessionId=[int]$worker.SessionId;script=$resolvedScript;executable=$PowerShellPath}
}
