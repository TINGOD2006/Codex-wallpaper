param([string]$SourceRoot=(Join-Path $PSScriptRoot '../dist/companion/app'),[string]$InstallRoot,[string]$LegacyRoot,[switch]$SkipPlugin,[switch]$NoShortcuts,[switch]$StartManager)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
. (Join-Path $PSScriptRoot 'windows-independent.ps1')
if(-not $InstallRoot){$InstallRoot=Get-CompanionInstallRoot}
$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if([IO.Path]::GetFileName($root) -notin @('CodexWallpaper','.codex-wallpaper')){throw 'A dedicated installation root is required'}
$source=[IO.Path]::GetFullPath($SourceRoot)
if($LegacyRoot){$LegacyRoot=[IO.Path]::GetFullPath($LegacyRoot)}
$installer=Join-Path $PSScriptRoot 'install-companion.ps1'
if(-not(Test-Path -LiteralPath (Join-Path $source 'install-manifest.json'))){throw 'Build the installation payload first'}
$job=Join-Path $root ('runtime/install-'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $job -Force|Out-Null
$request=@{SourceRoot=$source;InstallRoot=$root;SkipPlugin=[bool]$SkipPlugin;NoShortcuts=[bool]$NoShortcuts;StartManager=[bool]$StartManager;LegacyRoot=$LegacyRoot}
$request|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $job 'request.json') -Encoding utf8
$worker=Join-Path $job 'install.ps1';$resultFile=Join-Path $job 'result.json'
$installerLiteral=$installer.Replace("'","''");$rootLiteral=$root.Replace("'","''")
# Run outside the packaged host so AppData redirects cannot capture plugin registration or shortcuts.
@"
`$ErrorActionPreference='Stop'
`$env:CODEX_WALLPAPER_ROOT='$rootLiteral'
try {
 `$request=Get-Content -LiteralPath (Join-Path `$PSScriptRoot 'request.json') -Raw|ConvertFrom-Json -AsHashtable
 `$output=& '$installerLiteral' @request
 `$result=@{ok=`$true;output=@(`$output)}
} catch { `$result=@{ok=`$false;message=`$_.Exception.Message} }
`$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path `$PSScriptRoot 'result.json') -Encoding utf8
"@|Set-Content -LiteralPath $worker -Encoding utf8
$identity=Start-ThemeIndependentProcess -PowerShellPath (Get-Process -Id $PID).Path -ScriptPath $worker -WorkingDirectory $job
for($attempt=0;$attempt -lt 480;$attempt++){
 if(Test-Path -LiteralPath $resultFile){$result=Get-Content -LiteralPath $resultFile -Raw|ConvertFrom-Json;if(-not $result.ok){throw $result.message};$result.output;return}
 if(-not(Get-CimInstance Win32_Process -Filter "ProcessId=$($identity.pid)")){throw 'Independent installation ended without a result. Check runtime/install-*.'}
 Start-Sleep -Milliseconds 250
}
throw 'Installation is still running. Check runtime/install-* before starting another installation.'
