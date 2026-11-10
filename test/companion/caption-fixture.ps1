param([Parameter(Mandatory)][string]$IdentityPath,[Parameter(Mandatory)][string]$CommandsPath)
$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Windows.Forms
Add-Type 'using System;using System.Runtime.InteropServices;public static class CaptionFixtureShow{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")]public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);}'
[void][CaptionFixtureShow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$form=[Windows.Forms.Form]::new();$form.Text='Codex Wallpaper fixture';$form.StartPosition='Manual';$form.Location=[Drawing.Point]::new(100,100);$form.Size=[Drawing.Size]::new(1180,760);$form.TopMost=$true
$label=[Windows.Forms.Label]::new();$label.Text='Owned test window — no account or chat';$label.Dock='Fill';$label.TextAlign='MiddleCenter';$form.Controls.Add($label)
$owned=Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
$native=[Diagnostics.Process]::GetCurrentProcess()
@{pid=$PID;startTime=$owned.CreationDate.ToUniversalTime().Ticks.ToString();appPath=$owned.ExecutablePath;appVersion='fixture';testNativeStamp=$native.StartTime.ToUniversalTime().Ticks.ToString();testNativePath=$native.MainModule.FileName}|ConvertTo-Json|Set-Content -LiteralPath $IdentityPath
$script:last='';$script:shown=$false;$timer=[Windows.Forms.Timer]::new();$timer.Interval=100
$timer.add_Tick({if(-not $script:shown){[void][CaptionFixtureShow]::ShowWindow($form.Handle,8);$script:shown=$true};if(Test-Path -LiteralPath $CommandsPath){try{$c=Get-Content -LiteralPath $CommandsPath -Raw|ConvertFrom-Json;if($c.id -ne $script:last){$script:last=$c.id;switch($c.action){'move'{$form.Location=[Drawing.Point]::new(180,130);$form.Size=[Drawing.Size]::new(1040,700);$form.Activate()};'maximize'{$form.WindowState='Maximized';$form.Activate()};'minimize'{$form.WindowState='Minimized'};'restore'{$form.WindowState='Normal';$form.Activate()};'exit'{$form.Close()}}}}catch{}}})
try{$timer.Start();[Windows.Forms.Application]::Run($form)}finally{$timer.Dispose();$form.Dispose()}
