$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/taskbar-properties.ps1')
$file=Join-Path ([IO.Path]::GetTempPath()) ('codex-pin-fixture-'+[guid]::NewGuid().ToString()+'.lnk')
$shell=New-Object -ComObject WScript.Shell
try{
 $shortcut=$shell.CreateShortcut($file)
 $shortcut.TargetPath=(Get-Command pwsh).Source
 $shortcut.Arguments='-NoProfile -Command exit'
 $shortcut.Save()
 $values=@{2='"C:\Path With Space\launcher.exe" --argument';3='C:\Path With Space\original.ico,0';4='Codex';5='fixture.codex.app'}
 foreach($number in @(2,4,3,5)){
  [CodexTaskbarIdentity]::WriteFile($file,$number,$values[$number])
  if([CodexTaskbarIdentity]::ReadFile($file,$number) -ne $values[$number]){throw 'Taskbar property roundtrip failed'}
 }
 $saved=$shell.CreateShortcut($file)
 if($saved.Arguments -ne '-NoProfile -Command exit'){throw 'Launch arguments changed by property writes'}
 Write-Output 'PASS: relaunch metadata round trip preserves executable arguments'
}finally{
 if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
