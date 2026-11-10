$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/codex-user-shortcuts.ps1')
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('codex-entry-test-'+[guid]::NewGuid().ToString('N'))
$desktop=Join-Path $fixture 'desktop';$programs=Join-Path $fixture 'programs';$backup=Join-Path $fixture 'backup';$canonical=Join-Path $fixture 'source.lnk'
New-Item -ItemType Directory -Path $desktop,$programs -Force|Out-Null
$shell=New-Object -ComObject WScript.Shell
function Save-FixtureLink([string]$Path,[string]$Target,[string]$Arguments=''){$link=$shell.CreateShortcut($Path);$link.TargetPath=$Target;$link.Arguments=$Arguments;$link.Save()}
try{
 Save-FixtureLink $canonical (Get-Command pwsh).Source '-NoProfile -WindowStyle Hidden -File "C:\Own Wallpaper\launch-wallpaper.ps1"'
 $alias=Join-Path $programs 'ChatGPT.lnk'
 Save-FixtureLink $alias 'C:\Program Files\WindowsApps\OpenAI.Codex_26.1.2.3_x64__publisher\app\ChatGPT.exe'
 $originalHash=(Get-FileHash -LiteralPath $alias).Hash
 $unrelated=Join-Path $desktop 'ChatGPT.lnk';Save-FixtureLink $unrelated 'C:\Other\ChatGPT.exe';$unrelatedHash=(Get-FileHash -LiteralPath $unrelated).Hash
 $options=@{CanonicalPath=$canonical;BackupRoot=$backup;Folders=@($desktop,$programs);OfficialInstallLocation='C:\Program Files\WindowsApps\OpenAI.Codex_26.4.5.6_x64__publisher';PackageFamilyName='OpenAI.Codex_publisher'}
 Sync-CodexUserShortcuts @options|Out-Null
 $sourceHash=(Get-FileHash -LiteralPath $canonical).Hash
 foreach($file in @((Join-Path $desktop 'Codex.lnk'),(Join-Path $programs 'Codex.lnk'),$alias)){if((Get-FileHash -LiteralPath $file).Hash -ne $sourceHash){throw 'Expected integrated shortcut'}}
 if((Get-FileHash -LiteralPath $unrelated).Hash -ne $unrelatedHash){throw 'Unrelated alias overwritten'}
 $stamp=(Get-Item -LiteralPath $alias).LastWriteTimeUtc
 Sync-CodexUserShortcuts @options|Out-Null
 if((Get-Item -LiteralPath $alias).LastWriteTimeUtc -ne $stamp){throw 'Unchanged shortcut rewritten'}
 $modified=Join-Path $desktop 'Codex.lnk';Save-FixtureLink $modified 'C:\UserChoice\Other.exe';$modifiedHash=(Get-FileHash -LiteralPath $modified).Hash
 Sync-CodexUserShortcuts @options|Out-Null
 if((Get-FileHash -LiteralPath $modified).Hash -ne $modifiedHash){throw 'User change overwritten'}
 Sync-CodexUserShortcuts @options -Restore|Out-Null
 if((Get-FileHash -LiteralPath $alias).Hash -ne $originalHash){throw 'Original alias not restored'}
 if(Test-Path -LiteralPath (Join-Path $programs 'Codex.lnk')){throw 'New shortcut not removed on restore'}
 if((Get-FileHash -LiteralPath $modified).Hash -ne $modifiedHash){throw 'Restore clobbered user edit'}
 Write-Output 'PASS: stale official alias migrated, normal entries created, originals backed up, no-op stable, unrelated/user edits preserved, restore verified'
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
