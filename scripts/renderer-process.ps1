param([ValidateSet('Stamp','Verify','Stop')][string]$Operation='Verify',[int]$ProcessId,[string]$ExpectedExecutable,[string]$ProfilePath,[string]$StartTime,[int]$Port)
$ErrorActionPreference='Stop'
function Get-RendererArguments([string]$CommandLine){
 if(-not ('CodexRendererArgs' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class CodexRendererArgs {
 [DllImport("shell32.dll",SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command,out int count);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Parse(string command){int n;var p=CommandLineToArgvW(command,out n);if(p==IntPtr.Zero)throw new InvalidOperationException();try{var a=new string[n];for(int i=0;i<n;i++)a[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(p,i*IntPtr.Size));return a;}finally{LocalFree(p);}}
}
'@}
 [CodexRendererArgs]::Parse($CommandLine)
}
function Test-RendererIdentity($Identity,$Process,[object[]]$Listeners=@(),[switch]$RequirePort){
 if(-not $Process -or -not $Process.ExecutablePath -or -not $Process.CommandLine){return $false}
 if([int]$Process.ProcessId -ne [int]$Identity.pid -or [IO.Path]::GetFullPath($Process.ExecutablePath) -ne [IO.Path]::GetFullPath($Identity.executable) -or ([datetime]$Process.CreationDate).ToUniversalTime().Ticks.ToString() -ne [string]$Identity.startTime){return $false}
 $arguments=@(Get-RendererArguments $Process.CommandLine)
 if(@($arguments|Where-Object {$_ -like '--type=*'}).Count -or '--headless=new' -notin $arguments -or '--remote-debugging-address=127.0.0.1' -notin $arguments -or '--remote-debugging-port=0' -notin $arguments){return $false}
 $profiles=@($arguments|Where-Object {$_ -like '--user-data-dir=*'})
 if($profiles.Count -ne 1 -or [IO.Path]::GetFullPath($profiles[0].Substring(16)) -ne [IO.Path]::GetFullPath($Identity.profile)){return $false}
 if($RequirePort){if($Listeners.Count -ne 1){return $false};$bound=$Listeners[0];if($bound.LocalAddress -ne '127.0.0.1' -or [int]$bound.LocalPort -ne [int]$Identity.port -or [int]$bound.OwningProcess -ne [int]$Identity.pid -or $bound.RemotePort -ne 0 -or $bound.RemoteAddress -notin @('0.0.0.0','::')){return $false}}
 return $true
}
function Get-RendererBoundEndpoints([int]$LocalPort){
 . (Join-Path $PSScriptRoot 'windows-session.ps1')
 @(Get-ThemeBoundEndpoints -LocalPort $LocalPort)
}
if($MyInvocation.InvocationName -ne '.'){
 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
 $record=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
 if(-not $record){if($Operation -eq 'Stop'){@{stopped=$true}|ConvertTo-Json -Compress;exit};throw 'OWNER_MISMATCH'}
 $identity=@{pid=$ProcessId;executable=$ExpectedExecutable;profile=$ProfilePath;startTime=$StartTime;port=$Port}
 if($Operation -eq 'Stamp'){$identity.startTime=$record.CreationDate.ToUniversalTime().Ticks.ToString()}
 $listeners=@();if($Port){$listeners=@(Get-RendererBoundEndpoints -LocalPort $Port)}
 if(-not (Test-RendererIdentity $identity $record $listeners -RequirePort:([bool]$Port))){throw 'OWNER_MISMATCH'}
 if($Operation -eq 'Stop'){& taskkill.exe /PID $ProcessId /T /F|Out-Null;if($LASTEXITCODE -ne 0){throw 'POOL_LOST'};@{stopped=$true}|ConvertTo-Json -Compress}else{$identity|ConvertTo-Json -Compress}
}
