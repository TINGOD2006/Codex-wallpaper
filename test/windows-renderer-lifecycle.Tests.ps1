$ErrorActionPreference='Stop'
$source=Split-Path $PSScriptRoot
$result=& node (Join-Path $source 'test/renderer/native-pool-acceptance.cjs')
if($LASTEXITCODE -ne 0){throw 'Owned native renderer lifecycle failed'}
$evidence=$result|Select-Object -Last 1|ConvertFrom-Json
if(-not $evidence.passed -or -not $evidence.ownShutdown -or -not $evidence.contentPageBound){throw 'Renderer lifecycle evidence incomplete'}
'PASS: native video aspect, pause/resume, cancellation, page bound, occupied-origin fallback and owned shutdown'
