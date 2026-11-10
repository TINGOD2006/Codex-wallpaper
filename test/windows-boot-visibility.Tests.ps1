$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/boot-visibility.ps1')
$project=Split-Path $PSScriptRoot;$root=Join-Path $project ('.state/boot-visibility-'+[guid]::NewGuid().ToString('N'));$runtime=Join-Path $root 'runtime';$folder=Join-Path $runtime 'boot-animation';New-Item -ItemType Directory -Path $folder -Force|Out-Null
$file=Join-Path $folder 'last-request.json';$now=[DateTime]::UtcNow;$id=[guid]::NewGuid().ToString()
$valid={param($ProcessId,$StartTime,$ExpectedPath)if($ExpectedPath -ne [IO.Path]::GetFullPath((Join-Path $project 'assets/boot-animation/DragonBoot.exe'))){throw 'Expected player path was not fixed to this installation'};return $ProcessId -eq 1234 -and $StartTime -eq '12345'}
$options=@{RuntimeRoot=$runtime;ProjectRoot=$project;Now=$now;VerifyPlayer=$valid}
if(Test-WallpaperBootActive @options){throw 'No animation request hid the button'}
@{ticks=$now.Ticks;launchId=$id}|ConvertTo-Json|Set-Content -LiteralPath $file -Encoding utf8
if(-not(Test-WallpaperBootActive @options)){throw 'Player startup gap was not hidden'}
$options.Now=$now.AddSeconds(3);if(Test-WallpaperBootActive @options){throw 'Failed startup request hid the button indefinitely'}
@{ticks=$now.Ticks;launchId=$id;playerPid=1234;playerStartTime='12345'}|ConvertTo-Json|Set-Content -LiteralPath $file -Encoding utf8
if(-not(Test-WallpaperBootActive @options)){throw 'Verified live player was not hidden'}
[IO.File]::WriteAllText((Join-Path $folder ($id+'.json.result.json')),'{}')
if(-not(Test-WallpaperBootActive @options)){throw 'Completion marker exposed the button before player exit'}
$options.VerifyPlayer={param($ProcessId,$StartTime,$ExpectedPath)$false}
if(Test-WallpaperBootActive @options){throw 'Exited or reused player PID left the button hidden'}
$options.VerifyPlayer=$valid
@{ticks=$now.Ticks;launchId=$id;playerPid=1234;playerStartTime='99999'}|ConvertTo-Json|Set-Content -LiteralPath $file -Encoding utf8
if(Test-WallpaperBootActive @options){throw 'Reused process identity hid the button'}
foreach($data in @('{broken','{"launchId":"not-a-launch","playerPid":1234,"playerStartTime":"12345"}',('x'*9000))){[IO.File]::WriteAllText($file,$data);if(Test-WallpaperBootActive @options){throw 'Invalid request hid the button'}}
'PASS: live-player hiding, bounded startup gap, closing-player hold, exit/reused PID and invalid-marker recovery'
