function Sync-CodexUserShortcuts {
 param([string]$CanonicalPath,[string]$BackupRoot,[string[]]$Folders,[string]$OfficialInstallLocation,[string]$PackageFamilyName,[switch]$Restore)
 $ErrorActionPreference='Stop'
 $canonical=[IO.Path]::GetFullPath($CanonicalPath)
 $windowsApps=Split-Path ([IO.Path]::GetFullPath($OfficialInstallLocation))
 $publisher=($PackageFamilyName -split '_')[-1]
 $officialPattern='^'+[regex]::Escape($windowsApps)+'\\OpenAI\.Codex_\d+\.\d+\.\d+\.\d+_(?:x64|arm64|x86)__'+[regex]::Escape($publisher)+'\\(?:app\\)?ChatGPT\.exe$'
 $shell=New-Object -ComObject WScript.Shell
 try{
  $source=$shell.CreateShortcut($canonical)
  $sourceHash=(Get-FileHash -LiteralPath $canonical).Hash
  foreach($folder in $Folders){
   $folder=[IO.Path]::GetFullPath($folder)
   if(-not(Test-Path -LiteralPath $folder -PathType Container)){continue}
   foreach($name in @('Codex.lnk','ChatGPT.lnk')){
    $link=Join-Path $folder $name
    $exists=Test-Path -LiteralPath $link
    $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($link.ToLowerInvariant())))
    $recordPath=Join-Path $BackupRoot ($key+'.json');$backup=Join-Path $BackupRoot ($key+'.lnk')
    $record=if(Test-Path -LiteralPath $recordPath){Get-Content -Raw -LiteralPath $recordPath|ConvertFrom-Json}else{$null}
    if($exists -and ((Get-Item -LiteralPath $link).Attributes -band [IO.FileAttributes]::ReparsePoint)){Write-Output ('Preserved linked shortcut: '+$link);continue}
    $hash=if($exists){(Get-FileHash -LiteralPath $link).Hash}else{$null}
    if($record -and ($record.path -ne $link -or -not $exists)){Write-Output ('Preserved modified shortcut: '+$link);continue}
    if($record -and $record.installedHash -ne $hash){
     # A package update can recreate its ChatGPT alias. Reuse the original
     # verified backup and repair only a direct link to the same official app.
     $recreated=$false
     if(-not $Restore -and $name -eq 'ChatGPT.lnk' -and $record.existed -and
        (Test-Path -LiteralPath $backup -PathType Leaf) -and
        -not ((Get-Item -LiteralPath $backup).Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        (Get-FileHash -LiteralPath $backup).Hash -eq $record.originalHash){
      $current=$shell.CreateShortcut($link)
      $recreated=$current.TargetPath -match $officialPattern -and [string]::IsNullOrEmpty($current.Arguments)
     }
     if(-not $recreated){Write-Output ('Preserved modified shortcut: '+$link);continue}
    }
    if($Restore){
     if(-not $record){continue}
     if($record.existed){
      if(-not(Test-Path -LiteralPath $backup) -or (Get-FileHash -LiteralPath $backup).Hash -ne $record.originalHash){throw 'Shortcut backup mismatch'}
      Copy-Item -LiteralPath $backup -Destination $link -Force
     }else{Remove-Item -LiteralPath $link}
     Remove-Item -LiteralPath $recordPath
     Write-Output ('Restored: '+$link);continue
    }
    if(-not $record){
     if(-not $exists -and $name -eq 'ChatGPT.lnk'){continue}
     if($exists){
      $old=$shell.CreateShortcut($link)
      $native=$old.TargetPath -match $officialPattern -and [string]::IsNullOrEmpty($old.Arguments)
      $integrated=$old.TargetPath -eq $source.TargetPath -and $old.Arguments -eq $source.Arguments
      if(-not($native -or $integrated)){Write-Output ('Preserved unrelated shortcut: '+$link);continue}
     }
     New-Item -ItemType Directory -Path $BackupRoot -Force|Out-Null
     if($exists){Copy-Item -LiteralPath $link -Destination $backup -Force}
     $record=[pscustomobject]@{schemaVersion=1;path=$link;existed=$exists;originalHash=$hash;installedHash=$sourceHash}
    }elseif($hash -eq $sourceHash){Write-Output ('Already installed: '+$link);continue}
    $temporary=Join-Path $folder ('Codex-entry-'+[guid]::NewGuid().ToString('N')+'.lnk')
    try{
     Copy-Item -LiteralPath $canonical -Destination $temporary
     if((Get-FileHash -LiteralPath $temporary).Hash -ne $sourceHash){throw 'Shortcut copy mismatch'}
     # Persist original ownership before publishing; never touch official files.
     $record.installedHash=$sourceHash
     $record|ConvertTo-Json|Set-Content -LiteralPath $recordPath -Encoding utf8
     Move-Item -LiteralPath $temporary -Destination $link -Force
    }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
    Write-Output ('Installed: '+$link)
   }
  }
 }finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
}
