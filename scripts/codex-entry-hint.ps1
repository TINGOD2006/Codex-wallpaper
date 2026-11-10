function Get-CodexHintVersion([string]$AppPath){
 try{
  $base=Join-Path $env:ProgramFiles 'WindowsApps'
  $pattern='^'+[regex]::Escape($base)+'\\OpenAI\.Codex_(?<version>\d+\.\d+\.\d+\.\d+)_(?:x64|arm64|x86)__2p2nqsd0c76g0\\(?:app\\)?ChatGPT\.exe$'
  $match=[regex]::Match([IO.Path]::GetFullPath($AppPath),$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if($match.Success){return $match.Groups['version'].Value}
 }catch{}
 return $null
}
function Write-CodexHostHint {
 param([string]$HintPath,$Package,[int]$ProcessId,[string]$StartTime,[datetime]$CheckedAt=[DateTime]::UtcNow)
 try{
  $version=Get-CodexHintVersion $Package.appPath
  if($Package.packageFamily -ne 'OpenAI.Codex_2p2nqsd0c76g0' -or -not $version -or $version -ne [string]$Package.appVersion -or $ProcessId -le 0 -or $StartTime -notmatch '^\d+$'){return}
  $value=@{schemaVersion=1;checkedAt=$CheckedAt.ToUniversalTime().ToString('o');pid=$ProcessId;startTime=$StartTime;appPath=$Package.appPath;appVersion=$Package.appVersion;packageFamily=$Package.packageFamily}
  New-Item -ItemType Directory -Path (Split-Path $HintPath) -Force|Out-Null
  $temp=$HintPath+'.'+[guid]::NewGuid().ToString('N');try{[IO.File]::WriteAllText($temp,($value|ConvertTo-Json -Compress));[IO.File]::Move($temp,$HintPath,$true)}finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
 }catch{# Optional hints never block the native entry.
 }
}
function Get-CodexHostHint {
 param([string]$HintPath,[datetime]$Now=[DateTime]::UtcNow)
 try{
  $file=[IO.FileInfo]::new($HintPath);if(-not $file.Exists -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $null}
  $hint=[IO.File]::ReadAllText($file.FullName)|ConvertFrom-Json;$checked=[DateTimeOffset]::MinValue
  if($hint.schemaVersion -ne 1 -or $hint.packageFamily -ne 'OpenAI.Codex_2p2nqsd0c76g0'){return $null}
  # PowerShell may parse JSON dates into UTC DateTime objects. Casting those
  # to string loses the zone and would expire a fresh hint eight hours early.
  if($hint.checkedAt -is [DateTime] -or $hint.checkedAt -is [DateTimeOffset]){$checked=[DateTimeOffset]$hint.checkedAt}
  elseif(-not [DateTimeOffset]::TryParse([string]$hint.checkedAt,[ref]$checked)){return $null}
  $age=($Now.ToUniversalTime()-$checked.UtcDateTime).TotalSeconds
  $version=Get-CodexHintVersion $hint.appPath
  if($age -lt 0 -or $age -gt 300 -or -not $version -or $version -ne [string]$hint.appVersion -or $hint.startTime -notmatch '^\d+$' -or [int]$hint.pid -le 0){return $null}
  $package=@{id='codex-desktop';kind='codex-desktop';appPath=[string]$hint.appPath;appVersion=[string]$hint.appVersion;packageFamily=[string]$hint.packageFamily}
  $processes=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'")
  # A root from another installed version requires authoritative rediscovery.
  foreach($item in $processes){if($item.ExecutablePath -ne $package.appPath -and $item.CommandLine -and $item.CommandLine -notmatch '--type=|--user-data-dir=' -and (Get-CodexHintVersion $item.ExecutablePath)){return $null}}
  $roots=@(Select-CompanionRootCandidates -Candidates @(Find-CompanionHostCandidates -Package $package -Processes $processes))
  if($roots.Count -ne 1 -or $roots[0].pid -ne [int]$hint.pid -or [Math]::Abs([long]$roots[0].startTime-[long]$hint.startTime) -ge 10){return $null}
  return @{package=$package;process=$roots[0]}
 }catch{return $null}
}
