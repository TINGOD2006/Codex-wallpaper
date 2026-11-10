param([ValidateSet('Show','Close')][string]$Action='Show',[Parameter(Mandatory)][string]$RuntimeRoot,[Parameter(Mandatory)][string]$EdgePath,[string]$Url)
$ErrorActionPreference='Stop'
$browserProfile=[IO.Path]::GetFullPath((Join-Path $RuntimeRoot 'manager-browser'))
function Test-CompanionBrowserProfile([string]$Line){return $Line.Contains(('"--user-data-dir={0}"' -f $browserProfile)) -or $Line.Contains(('--user-data-dir="{0}"' -f $browserProfile)) -or $Line -match ('(?:^|\s)--user-data-dir='+[regex]::Escape($browserProfile)+'(?:\s|$)')}
$roots=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.ExecutablePath -eq $EdgePath -and $_.CommandLine -notmatch '--type=' -and (Test-CompanionBrowserProfile $_.CommandLine)})
if($Action -eq 'Close'){
 foreach($owned in $roots){$again=Get-CimInstance Win32_Process -Filter "ProcessId=$($owned.ProcessId)";if($again -and $again.CreationDate -eq $owned.CreationDate -and $again.ExecutablePath -eq $EdgePath -and (Test-CompanionBrowserProfile $again.CommandLine)){& taskkill.exe /PID $owned.ProcessId /T /F|Out-Null}}
 return
}
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices; public static class CompanionWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}'
foreach($owned in $roots){$desktop=Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue;if($desktop.MainWindowHandle -ne 0){[void][CompanionWindow]::ShowWindow($desktop.MainWindowHandle,9);[void][CompanionWindow]::SetForegroundWindow($desktop.MainWindowHandle);return}}
$address=[uri]$Url
if($address.Scheme -ne 'http' -or $address.Host -ne '127.0.0.1' -or $address.AbsolutePath -ne '/' -or $address.Fragment -notmatch '^#[a-f0-9]{48}$'){throw 'Invalid dashboard address'}
New-Item -ItemType Directory -Path $browserProfile -Force|Out-Null
# This is the interactive manager window requested by the user.
Start-Process -FilePath $EdgePath -ArgumentList @('--no-first-run','--no-default-browser-check',('"--user-data-dir={0}"' -f $browserProfile),('"--app={0}"' -f $Url)) -WindowStyle Normal|Out-Null
