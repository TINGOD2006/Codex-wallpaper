$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot
$installer=Join-Path $project 'scripts/install-companion.ps1'
$payload=Join-Path $project 'dist/companion/app'
$testRoot=Join-Path $project ('.state/install-'+[guid]::NewGuid().ToString())
$installed=Join-Path $testRoot 'CodexWallpaper'
$legacy=Join-Path $testRoot 'legacy';New-Item -ItemType Directory -Path $legacy -Force|Out-Null
$fixture=& node -e "const s=require('./src/wallpaper/schema.cjs').defaults();s.reading.scrim=.37;console.log(JSON.stringify(s))"
Set-Content -LiteralPath (Join-Path $legacy 'user-settings.json') -Value $fixture
$independent=Join-Path $testRoot 'independent/CodexWallpaper'
& (Join-Path $project 'scripts/start-install.ps1') -SourceRoot $payload -InstallRoot $independent -LegacyRoot ([IO.Path]::GetRelativePath((Get-Location).Path,$legacy)) -SkipPlugin -NoShortcuts
if((Get-Content -LiteralPath (Join-Path $independent 'data/user-settings.json') -Raw|ConvertFrom-Json).reading.scrim -ne .37){throw 'Relative legacy root was lost across the independent worker'}
$data=Join-Path $installed 'data';New-Item -ItemType Directory -Path $data -Force|Out-Null
$sentinel='{"keep":"unchanged"}';Set-Content -LiteralPath (Join-Path $data 'sentinel.json') -Value $sentinel
& $installer -SourceRoot $payload -InstallRoot $installed -SkipPlugin -NoShortcuts
if((Get-Content -LiteralPath (Join-Path $data 'sentinel.json') -Raw).Trim() -ne $sentinel){throw 'Data overwritten'}
if(-not(Test-Path -LiteralPath (Join-Path $installed 'app/src/companion/main.cjs'))){throw 'App missing'}
& $installer -SourceRoot $payload -InstallRoot $installed -SkipPlugin -NoShortcuts
if((Get-Content -LiteralPath (Join-Path $data 'sentinel.json') -Raw).Trim() -ne $sentinel){throw 'Update touched data'}
& (Join-Path $project 'scripts/start-install.ps1') -SourceRoot $payload -InstallRoot $installed -SkipPlugin -NoShortcuts
if((Get-Content -LiteralPath (Join-Path $data 'sentinel.json') -Raw).Trim() -ne $sentinel){throw 'Independent update touched data'}
$bad=Join-Path $testRoot 'bad';New-Item -ItemType Directory -Path $bad|Out-Null
$manifest=@{schemaVersion=1;product='CodexWallpaper';version='0.6.0';files=@(@{path='../../escape';bytes=1;sha256=('0'*64)})}|ConvertTo-Json -Depth 5
Set-Content -LiteralPath (Join-Path $bad 'install-manifest.json') -Value $manifest
$rejected=$false;try{& $installer -SourceRoot $bad -InstallRoot $installed -SkipPlugin -NoShortcuts}catch{$rejected=$true}
if(-not $rejected){throw 'Traversal accepted'}
& (Join-Path $project 'scripts/uninstall-companion.ps1') -InstallRoot $installed -SkipPlugin -NoShortcuts
if(Test-Path -LiteralPath (Join-Path $installed 'app')){throw 'Active app survived uninstall'}
if((Get-Content -LiteralPath (Join-Path $data 'sentinel.json') -Raw).Trim() -ne $sentinel){throw 'Uninstall removed data'}
Write-Output 'PASS: installation/update preserve data and reject unsafe manifest paths'
