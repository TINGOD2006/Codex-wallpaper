param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot
if(-not $OutputDirectory){$OutputDirectory=Join-Path $project 'assets/boot-animation'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $OutputDirectory.StartsWith(([IO.Path]::GetFullPath($project)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Build output must stay in this project'}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$framework=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$arguments=@('/nologo','/target:winexe','/platform:x64','/optimize+',('/win32manifest:'+(Join-Path $project 'src/boot-animation/app.manifest')),('/out:'+(Join-Path $OutputDirectory 'DragonBoot.exe')))
foreach($reference in @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll','System.Drawing.dll','System.Windows.Forms.dll')){$arguments+='/reference:'+$reference}
foreach($reference in @('WindowsBase.dll','PresentationCore.dll','PresentationFramework.dll')){$arguments+='/reference:'+(Join-Path $framework ('WPF/'+$reference))}
$arguments+=Join-Path $project 'src/boot-animation/DragonCodexBoot.cs'
& (Join-Path $framework 'csc.exe') @arguments
if($LASTEXITCODE -ne 0){throw 'Animation compile failed'}
Write-Output (Join-Path $OutputDirectory 'DragonBoot.exe')
