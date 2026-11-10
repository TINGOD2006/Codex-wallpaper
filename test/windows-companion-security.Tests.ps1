$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/companion-security.ps1')
$target=Join-Path ([IO.Path]::GetTempPath()) ('cw-private-'+[guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $target|Out-Null
Set-CompanionPrivateAccess $target
Set-CompanionPrivateAccess $target
$file=Join-Path $target 'descriptor-fixture.json';Set-Content -LiteralPath $file -Value '{}'
Set-CompanionPrivateAccess $file
Set-CompanionPrivateAccess $file
$acl=Get-Acl -LiteralPath $target
if(-not $acl.AreAccessRulesProtected){throw 'Private ACL still inherits'}
$allowed=@([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18')
foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($rule.IdentityReference.Value -notin $allowed){throw 'Unexpected private ACL principal'}}
Write-Output 'PASS: runtime ACL limited to current user and SYSTEM'
