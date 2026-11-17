$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/codex-native-activation.ps1')
if(-not ('CodexNativeActivation' -as [type])){throw 'Native activation module did not compile'}
if([CodexNativeActivation]::WallpaperArguments -cne '--remote-debugging-address=127.0.0.1 --remote-debugging-port=0'){throw 'Native activation does not request the existing local endpoint'}
$rejected=$false;try{Invoke-CodexNativeActivation -Package @{packageFamily='invalid identity'}}catch{$rejected=$true}
if(-not $rejected){throw 'Invalid application identity was accepted'}
# A non-foreground guard must return before COM and cannot activate any app.
if([CodexNativeActivation]::Activate('NotAnInstalledApp_test!App',[IntPtr]::new(-1)) -ne 0){throw 'Automatic activation ignored its foreground guard'}
# A missing, fixture-only AUMID exercises the Windows COM call without opening an application.
$missing=$false;try{[void][CodexNativeActivation]::Activate('WallpaperOwnedMissingFixture_123456789abcd!App',[IntPtr]::Zero)}catch{
 $hr=$_.Exception.GetBaseException().HResult.ToString('X8');$missing=$hr -in @('80070002','80070490','80073CF1','80270254')
 if(-not $missing){throw}
}
if(-not $missing){throw 'Missing fixture identity was opened'}
'PASS: native activation sends loopback arguments, rejects invalid identities, honors the foreground guard and reaches the Windows activation service'
