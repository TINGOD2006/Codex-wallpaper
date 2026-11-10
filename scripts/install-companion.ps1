param([string]$SourceRoot=(Join-Path $PSScriptRoot '../dist/companion/app'),[string]$InstallRoot,[string]$LegacyRoot,[switch]$SkipPlugin,[switch]$NoShortcuts,[switch]$StartManager)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'companion-paths.ps1')
if(-not $InstallRoot){$InstallRoot=Get-CompanionInstallRoot}
$source=[IO.Path]::GetFullPath($SourceRoot).TrimEnd('\');$root=[IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if([IO.Path]::GetFileName($root) -notin @('CodexWallpaper','.codex-wallpaper') -or $root -eq [IO.Path]::GetPathRoot($root)){throw 'Install root must be a dedicated CodexWallpaper directory'}
function Resolve-InstallChild([string]$Relative){$target=[IO.Path]::GetFullPath((Join-Path $root $Relative));if(-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Install target outside dedicated root'};return $target}
function Assert-NotLinked([string]$File,[string]$Boundary){$current=$File;while($true){$item=Get-Item -LiteralPath $current -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Install rejects reparse points'};if($current.TrimEnd('\') -eq $Boundary.TrimEnd('\')){break};$current=Split-Path $current;if(-not $current -or $current.Length -lt $Boundary.Length){throw 'Invalid source boundary'}}}
$manifestPath=Join-Path $source 'install-manifest.json';$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'CodexWallpaper' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$' -or -not $manifest.files.Count -or $manifest.files.Count -gt 5000){throw 'Invalid install manifest'}
$seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($entry in $manifest.files){
 $relative=([string]$entry.path).Replace('/','\');$parts=$relative.Split('\')
 if([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or $relative.Contains([char]0) -or @($parts|Where-Object {$_ -in @('','.','..','.state','.git','node_modules','workshop','data','runtime')}).Count -or $relative -match '\.pkg$' -or -not $seen.Add($relative) -or $entry.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Unsafe install manifest path'}
 $file=[IO.Path]::GetFullPath((Join-Path $source $relative));if(-not $file.StartsWith($source+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Source path escape'};Assert-NotLinked $file $source
 if((Get-Item -LiteralPath $file).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256){throw 'Install payload integrity mismatch'}
}
$node=(Get-Command node -ErrorAction Stop).Source
if([int]((& $node -p 'process.versions.node').Split('.')[0]) -lt 24){throw 'Node.js24 or newer is required'}
if($PSVersionTable.PSVersion -lt [version]'7.4'){throw 'PowerShell7.4 or newer is required'}
New-Item -ItemType Directory -Path $root -Force|Out-Null;Assert-NotLinked $root $root
foreach($privateName in @('data','runtime','logs')){$privateFolder=Resolve-InstallChild $privateName;if(Test-Path -LiteralPath $privateFolder){Assert-NotLinked $privateFolder $privateFolder}}
$app=Resolve-InstallChild 'app';$runtime=Resolve-InstallChild 'runtime';$descriptor=Join-Path $runtime 'manager.json'
if(Test-Path -LiteralPath $app){Assert-NotLinked $app $app;if(-not(Test-Path -LiteralPath (Join-Path $app 'install-manifest.json'))){throw 'Existing app directory is not an owned installation'}}
if(Test-Path -LiteralPath $descriptor){
 $saved=Get-Content -LiteralPath $descriptor -Raw|ConvertFrom-Json;$owned=Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)"
 if($owned -and $owned.CreationDate.ToUniversalTime().Ticks.ToString() -eq [string]$saved.startTime){
  $oldCommand=Join-Path $app 'src/companion/command.cjs';$closed=& $node $oldCommand exit --root $root 2>$null;if($LASTEXITCODE -ne 0){throw 'Running manager could not confirm shutdown'}
  for($attempt=0;$attempt -lt 60;$attempt++){if(-not(Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)")){break};Start-Sleep -Milliseconds 100}
  if(Get-CimInstance Win32_Process -Filter "ProcessId=$($saved.pid)"){throw 'Manager has not stopped'}
  $workerPath=Join-Path $app 'scripts/companion-worker.ps1'
  for($attempt=0;$attempt -lt 40;$attempt++){if(-not @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'"|Where-Object {$_.CommandLine.Contains($workerPath)}).Count){break};Start-Sleep -Milliseconds 100}
 }
}
if($LegacyRoot){
 $oldState=Split-Path ([IO.Path]::GetFullPath($LegacyRoot));$oldIdentity=Join-Path $oldState 'session.json'
 if(Test-Path -LiteralPath $oldIdentity){
  $legacy=Get-Content -LiteralPath $oldIdentity -Raw|ConvertFrom-Json;$loader=Get-CimInstance Win32_Process -Filter "ProcessId=$($legacy.daemonPid)" -ErrorAction SilentlyContinue
  $oldCli=Join-Path (Split-Path $oldState) 'src/cli.cjs'
  if($loader -and $loader.ExecutablePath -eq $node -and $loader.CreationDate.ToUniversalTime().Ticks.ToString() -eq [string]$legacy.daemonStartTime -and $loader.CommandLine.Contains($oldCli) -and $loader.CommandLine -match '\sdaemon\s'){
   $descendants=[Collections.Generic.Queue[int]]::new();$descendants.Enqueue([int]$legacy.daemonPid)
   while($descendants.Count){foreach($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($descendants.Dequeue())")){if($child.ProcessId -eq $legacy.pid){throw 'Refused to stop a legacy tree containing the original app'};$descendants.Enqueue([int]$child.ProcessId)}}
   $again=Get-CimInstance Win32_Process -Filter "ProcessId=$($legacy.daemonPid)" -ErrorAction SilentlyContinue
   if($again -and $again.CreationDate -eq $loader.CreationDate -and $again.ExecutablePath -eq $node -and $again.CommandLine.Contains($oldCli)){& taskkill.exe /PID $legacy.daemonPid /T /F|Out-Null;if($LASTEXITCODE -ne 0){throw 'Legacy loader could not be stopped'}}
  }
 }
}
$stage=Resolve-InstallChild ('.staging-'+[guid]::NewGuid().ToString());$stagedApp=Join-Path $stage 'app';New-Item -ItemType Directory -Path $stagedApp -Force|Out-Null
foreach($entry in $manifest.files){$destination=Join-Path $stagedApp $entry.path;New-Item -ItemType Directory -Path (Split-Path $destination) -Force|Out-Null;Copy-Item -LiteralPath (Join-Path $source $entry.path) -Destination $destination;if((Get-FileHash -LiteralPath $destination).Hash -ne $entry.sha256){throw 'Staged payload integrity mismatch'}}
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $stagedApp 'install-manifest.json')
$backup=$null
try{
 if(Test-Path -LiteralPath $app){$backup=Resolve-InstallChild ('app.previous-'+[guid]::NewGuid().ToString());Move-Item -LiteralPath $app -Destination $backup}
 if(-not $stagedApp.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $app.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Move target outside install root'}
 Move-Item -LiteralPath $stagedApp -Destination $app
}catch{if($backup -and -not(Test-Path -LiteralPath $app)){Move-Item -LiteralPath $backup -Destination $app};throw}
$migrationArguments=@((Join-Path $app 'src/companion/migrate-command.cjs'),'--root',$root);if($LegacyRoot){$migrationArguments+=@('--legacy',[IO.Path]::GetFullPath($LegacyRoot))}
$migrated=& $node @migrationArguments 2>$null;if($LASTEXITCODE -ne 0){throw 'SETTINGS_INVALID: migration failed; original settings and backups are retained'}
$pluginInstalled=$false;$pluginRefreshPending=$false
if(-not $SkipPlugin){
 $codex=Get-CompanionCodexCli;$listed=& $codex plugin marketplace list --json;if($LASTEXITCODE -ne 0){throw 'Cannot read plugin marketplaces'};$marketplaces=@(($listed|ConvertFrom-Json).marketplaces)
 $matching=@($marketplaces|Where-Object name -eq 'codex-wallpaper-local')
 if($matching.Count -and [IO.Path]::GetFullPath($matching[0].root).TrimEnd('\') -ne $app){throw 'Marketplace name already belongs to a different source'}
 if(-not $matching.Count){$registered=& $codex plugin marketplace add $app --json;if($LASTEXITCODE -ne 0){throw 'Local marketplace registration failed'}}
 $plugin=& $codex plugin add 'codex-wallpaper-control@codex-wallpaper-local' --json
 if($LASTEXITCODE -ne 0){
  # Windows cannot replace a plugin cache directory held by its running MCP process.
  # Keep the verified existing entry and report pending reload; the independent manager can still update.
  $currentList=& $codex plugin list --json;if($LASTEXITCODE -ne 0){throw 'Local control plugin installation failed'}
  $current=@(($currentList|ConvertFrom-Json).installed|Where-Object pluginId -eq 'codex-wallpaper-control@codex-wallpaper-local')
  $expectedPlugin=Join-Path $app 'plugins/codex-wallpaper-control'
  if($current.Count -ne 1 -or -not $current[0].installed -or $current[0].source.source -ne 'local' -or [IO.Path]::GetFullPath($current[0].source.path).TrimEnd('\') -ne $expectedPlugin){throw 'Local control plugin installation failed'}
  $pluginRefreshPending=$true
 };$pluginInstalled=$true
}
if(-not $NoShortcuts){
 $shell=New-Object -ComObject WScript.Shell
 foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){
  $file=Join-Path $folder 'Codex Wallpaper.lnk';$shortcut=$shell.CreateShortcut($file)
  if((Test-Path -LiteralPath $file) -and -not $shortcut.Arguments.Contains($root)){throw 'An unrelated Codex Wallpaper shortcut already exists'}
  $shortcut.TargetPath=(Get-Process -Id $PID).Path;$shortcut.Arguments='-NoProfile -File "'+(Join-Path $app 'scripts/start-companion.ps1')+'"';$shortcut.WorkingDirectory=$app;$shortcut.WindowStyle=7;$shortcut.Description='Codex Wallpaper 獨立桌布管理器';$shortcut.Save()
 }
}
@{installed=$true;version=$manifest.version;pluginInstalled=$pluginInstalled;pluginRefreshPending=$pluginRefreshPending;dataPreserved=$true}|ConvertTo-Json -Compress
if($StartManager){& (Join-Path $app 'scripts/start-companion.ps1') -Action Start|Out-Null;if($LASTEXITCODE -ne 0){throw 'Manager startup not confirmed'}}
