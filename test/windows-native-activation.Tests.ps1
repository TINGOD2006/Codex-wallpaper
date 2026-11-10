$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/codex-native-activation.ps1')
if(-not ('CodexNativeActivation' -as [type])){throw 'Native activation module did not compile'}
$rejected=$false;try{Invoke-CodexNativeActivation -Package @{packageFamily='invalid identity'}}catch{$rejected=$true}
if(-not $rejected){throw 'Invalid application identity was accepted'}
# A non-foreground guard must return before COM and cannot activate any app.
if([CodexNativeActivation]::Activate('NotAnInstalledApp_test!App',[IntPtr]::new(-1)) -ne 0){throw 'Automatic activation ignored its foreground guard'}
'PASS: official activation bridge compiles, rejects invalid identities, and never steals focus for background restores'
