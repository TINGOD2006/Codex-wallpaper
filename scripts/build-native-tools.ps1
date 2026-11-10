param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot
if(-not $OutputDirectory){$OutputDirectory=Join-Path $project 'assets/native'}
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
if(-not $OutputDirectory.StartsWith(([IO.Path]::GetFullPath($project)+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)){throw 'Native build output must stay inside the project'}
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
foreach($item in @(@{source='native-tcp.cs';assembly='CodexWallpaperTcp.dll';manifest='tcp-build.json'},@{source='native-activation.cs';assembly='CodexNativeActivation.dll';manifest='activation-build.json'})){
 $source=Join-Path $project ('src/companion/'+$item.source);$assembly=Join-Path $OutputDirectory $item.assembly
 $sourceHash=(Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant();$existing=$null
 try{$existing=Get-Content -LiteralPath (Join-Path $OutputDirectory $item.manifest) -Raw|ConvertFrom-Json;if($existing.schemaVersion -eq 1 -and $existing.sourceSha256 -eq $sourceHash -and (Get-FileHash -LiteralPath $assembly).Hash.ToLowerInvariant() -eq $existing.assemblySha256){Write-Output $assembly;continue}}catch{}
 & $compiler '/nologo' '/target:library' '/platform:anycpu' '/optimize+' ('/out:'+$assembly) $source
 if($LASTEXITCODE -ne 0){throw ('Native helper compilation failed: '+$item.source)}
 @{schemaVersion=1;sourceSha256=$sourceHash;assemblySha256=(Get-FileHash -LiteralPath $assembly).Hash.ToLowerInvariant()}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $OutputDirectory $item.manifest) -Encoding utf8
 Write-Output $assembly
}
