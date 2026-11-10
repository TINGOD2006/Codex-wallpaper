if(-not ('CodexNativeActivation' -as [type])){
 $source=Join-Path $PSScriptRoot '../src/companion/native-activation.cs';$assembly=Join-Path $PSScriptRoot '../assets/native/CodexNativeActivation.dll';$ready=$false
 try{$build=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../assets/native/activation-build.json') -Raw|ConvertFrom-Json;$ready=$build.schemaVersion -eq 1 -and (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() -eq $build.sourceSha256 -and (Get-FileHash -LiteralPath $assembly).Hash.ToLowerInvariant() -eq $build.assemblySha256}catch{}
 if($ready){Add-Type -Path $assembly}else{Add-Type -Path $source}
}
function Invoke-CodexNativeActivation {
 param([Parameter(Mandatory)]$Package,[IntPtr]$OnlyIfForeground=[IntPtr]::Zero)
 $id=[string]$Package.packageFamily+'!App'
 if($id -notmatch '^[A-Za-z0-9_.-]+![A-Za-z0-9_.-]+$'){throw 'Invalid official application identity'}
 $record=@{at=[DateTime]::UtcNow.ToString('o');appId=$id;foregroundGuard=($OnlyIfForeground -ne [IntPtr]::Zero);result='failed';pid=0;errorCode=$null}
 try{$nativePid=[CodexNativeActivation]::Activate($id,$OnlyIfForeground);$record.pid=$nativePid;$record.result=if($nativePid){'activated'}else{'foreground-changed'}}catch{$record.errorCode=$_.Exception.HResult.ToString('X8');throw}finally{
  try{$runtime=Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'runtime';if(Test-Path -LiteralPath $runtime){$target=Join-Path $runtime 'native-activation-last.json';$temp=$target+'.'+[guid]::NewGuid().ToString('N');$record|ConvertTo-Json -Compress|Set-Content -LiteralPath $temp -Encoding utf8;[IO.File]::Move($temp,$target,$true)}}catch{}
 }
}
