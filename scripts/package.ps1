param([ValidateSet('Source','Installer','Plugin')][string]$Kind='Source',[string]$OutputPath,[switch]$Replace)
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot));$version=(Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw|ConvertFrom-Json).version
$label=switch($Kind){'Source'{"CodexWallpaper-$version-source.zip"};'Installer'{"CodexWallpaper-$version-installer.zip"};'Plugin'{"codex-wallpaper-control-$version.zip"}}
if(-not $OutputPath){$OutputPath=Join-Path $project ('../outputs/miku-theme/'+$label)}
$destination=[IO.Path]::GetFullPath($OutputPath)
if([IO.Path]::GetExtension($destination) -ne '.zip'){throw 'Output must be a ZIP'}
if(Test-Path -LiteralPath $destination){if(-not $Replace){throw 'Output already exists; use Replace for this generated package'};if((Get-Item -LiteralPath $destination).PSIsContainer){throw 'Output is not a file'};Remove-Item -LiteralPath $destination}
$files=[Collections.Generic.List[string]]::new();$base=$project;$prefix='CodexWallpaper/'
if($Kind -eq 'Installer'){$base=Join-Path $project 'dist/companion';if(-not(Test-Path -LiteralPath (Join-Path $base 'app/install-manifest.json'))){throw 'Run npm run build:companion first'}}
if($Kind -eq 'Plugin'){$base=Join-Path $project 'dist/plugin/codex-wallpaper-control';$prefix='codex-wallpaper-control/';if(-not(Test-Path -LiteralPath (Join-Path $base 'plugin.json'))){throw 'Run npm run build:plugin first'}}
if($Kind -eq 'Source'){
 $listed=& node (Join-Path $PSScriptRoot 'release-files.cjs') list
 if($LASTEXITCODE -ne 0){throw 'Cannot enumerate release files'}
 foreach($name in ($listed|ConvertFrom-Json)){[void]$files.Add([string]$name)}
}else{foreach($file in Get-ChildItem -LiteralPath $base -Recurse -File -Force){[void]$files.Add([IO.Path]::GetRelativePath($base,$file.FullName).Replace('\','/'))}}
Add-Type -AssemblyName System.IO.Compression
[IO.Directory]::CreateDirectory((Split-Path $destination))|Out-Null
$archive=[IO.Compression.ZipFile]::Open($destination,[IO.Compression.ZipArchiveMode]::Create)
try{foreach($relative in ($files|Sort-Object -Unique)){
 if($relative -match '(^|/)(\.state|node_modules|workshop|\.git|data|runtime|profile|cache|tokens|logs)(/|$)' -or $relative -match '\.(pkg|log|tmp|lnk)$'){throw "Private resource rejected: $relative"}
 $file=[IO.Path]::GetFullPath((Join-Path $base $relative));if(-not $file.StartsWith($base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive source outside root'}
 [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file,$prefix+$relative,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
}}finally{$archive.Dispose()}
$check=[IO.Compression.ZipFile]::OpenRead($destination)
try{if($check.Entries.FullName -match '(^|/)(\.state|node_modules|workshop|\.git|data|runtime|profile|cache|tokens|logs)(/|$)|\.(pkg|log|tmp|lnk)$'){throw 'Archive contains private resources'};@{kind=$Kind;file=$destination;entries=$check.Entries.Count;bytes=(Get-Item -LiteralPath $destination).Length;sha256=(Get-FileHash -LiteralPath $destination).Hash}|ConvertTo-Json}finally{$check.Dispose()}
