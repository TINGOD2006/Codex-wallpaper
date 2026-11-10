$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot;$root=Join-Path $project '.state/boot-entry-fixture';$app=Join-Path $root 'app';New-Item -ItemType Directory -Path $app -Force|Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe';$exe=Join-Path $app 'ChatGPT.exe'
& $compiler '/nologo' '/target:winexe' '/reference:System.dll' '/reference:System.Windows.Forms.dll' '/reference:System.Drawing.dll' '/reference:System.Web.Extensions.dll' ('/out:'+$exe) (Join-Path $project 'test/fixtures/boot-window.cs')
if($LASTEXITCODE -ne 0){throw 'Fixture compilation failed'}
# Mock only the package inventory. Process/creation time/window checks are real
# and are fenced to this owned executable, never the actual Codex installation.
function Get-AppxPackage {param([string]$Name)if($Name -eq 'OpenAI.Codex'){[pscustomobject]@{InstallLocation=$root;Version=[version]'99.1.2.3';PackageFamilyName='OwnedFixture_test'}}}
$count=[pscustomobject]@{value=0}
$activations=[pscustomobject]@{value=0}
function Invoke-CodexNativeActivation {param($Package)if($Package.packageFamily -ne 'OwnedFixture_test'){throw 'Wrong native activation target'};$activations.value++}
& (Join-Path $project 'scripts/ensure-codex-visible.ps1') -ExistingOnly -OnColdStart {$count.value++}
if($count.value -ne 0 -or $activations.value -ne 0){throw 'Fail-open activation reopened an exited host'}
& (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$count.value++}
if($count.value -ne 1){throw 'Cold entry did not request exactly one animation'}
Start-Sleep -Milliseconds 500
$id=[guid]::NewGuid().ToString();$state=Join-Path $root ($id+'.json')
$fixture=Start-Process -FilePath $exe -ArgumentList @(('"'+$state+'"'),$id,'-1') -PassThru -WindowStyle Normal
try{
 for($n=0;$n -lt 50 -and -not(Test-Path -LiteralPath $state);$n++){Start-Sleep -Milliseconds 100}
 & (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$count.value++}
 if($count.value -ne 1){throw 'Hot entry replayed the animation'}
 if($fixture.HasExited){throw 'Hot entry replaced or closed the native fixture'}
 Add-Type 'using System;using System.Runtime.InteropServices;public static class BootEntryVisibility{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int command);}'
 $fixture.Refresh();$window=$fixture.MainWindowHandle;[void][BootEntryVisibility]::ShowWindow($window,6);Start-Sleep -Milliseconds 200
 & (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$count.value++}
 if($count.value -ne 1){throw 'Restoring a minimized host replayed animation'}
 [void][BootEntryVisibility]::ShowWindow($window,0);Start-Sleep -Milliseconds 200
 & (Join-Path $project 'scripts/ensure-codex-visible.ps1') -OnColdStart {$count.value++}
 if($count.value -ne 1){throw 'Restoring a hidden host replayed animation'}
 if($fixture.HasExited){throw 'Restore entry replaced or closed the native fixture'}
 if($activations.value -ne 3){throw 'Existing visible/minimized/hidden entries did not use the official activation contract'}
 'PASS: cold opens once; visible, minimized and hidden running hosts skip animation and reuse the same process'
}finally{[void]$fixture.CloseMainWindow();[void]$fixture.WaitForExit(5000)}
