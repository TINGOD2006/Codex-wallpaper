function Test-WallpaperBootActive {
 param([Parameter(Mandatory)][string]$RuntimeRoot,[Parameter(Mandatory)][string]$ProjectRoot,[datetime]$Now=[DateTime]::UtcNow,[scriptblock]$VerifyPlayer)
 try{
  $file=[IO.FileInfo]::new((Join-Path $RuntimeRoot 'boot-animation/last-request.json'))
  if(-not $file.Exists -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $false}
  $record=[IO.File]::ReadAllText($file.FullName)|ConvertFrom-Json
  $launch=[guid]::Empty;if(-not [guid]::TryParse([string]$record.launchId,[ref]$launch)){return $false}
  if($null -ne $record.playerPid){
   [int]$processId=0;[long]$stamp=0
   if(-not [int]::TryParse([string]$record.playerPid,[ref]$processId) -or $processId -le 0 -or -not [long]::TryParse([string]$record.playerStartTime,[ref]$stamp) -or $stamp -le 0){return $false}
   $expected=[IO.Path]::GetFullPath((Join-Path $ProjectRoot 'assets/boot-animation/DragonBoot.exe'))
   if(-not $VerifyPlayer){$VerifyPlayer={param($ProcessId,$StartTime,$ExpectedPath)[CodexWallpaper.NativeCaption]::VerifyHost($ProcessId,$StartTime,$ExpectedPath)}}
   # Keep hiding through handoff until this exact player exits. A result file
   # can be written while its covering window is still closing.
   return [bool](& $VerifyPlayer $processId ([string]$record.playerStartTime) $expected)
  }
  # The launcher publishes a request just before starting the player. Bound
  # this short gap so a failed start cannot leave the settings entry hidden.
  [long]$ticks=0;if(-not [long]::TryParse([string]$record.ticks,[ref]$ticks)){return $false}
  $age=$Now.ToUniversalTime().Ticks-$ticks
  return $age -ge 0 -and $age -le [TimeSpan]::FromSeconds(2).Ticks
 }catch{return $false}
}
