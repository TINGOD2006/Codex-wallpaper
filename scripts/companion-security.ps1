param([ValidateSet('Protect','Stamp','Verify')][string]$Operation='Protect',[string]$TargetPath,[int]$ManagerPid,[string]$StartTime,[string]$ExpectedEntry,[string]$ExpectedNode)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
function Set-CompanionPrivateAccess([string]$Path){
 $item=Get-Item -LiteralPath $Path -Force
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Private path cannot be a link'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 # Read and write only owner/DACL. Set-Acl can also request SACL privileges on an already protected directory.
 $sections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
 $acl=[IO.FileSystemAclExtensions]::GetAccessControl($item,$sections)
 # Reapplying inheritable ACLs propagates through the browser profile/cache.
 # Validate the existing private ACL before touching a potentially large tree.
 $trusted=@($sid.Value,'S-1-5-18')
 $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
 $inheritance=if($item.PSIsContainer){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
 $safe=$acl.AreAccessRulesProtected -and $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and $rules.Count -eq 2
 foreach($rule in $rules){
  if($rule.IdentityReference.Value -notin $trusted -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $rule.InheritanceFlags -ne $inheritance -or $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or $rule.IsInherited){$safe=$false}
 }
 if($safe -and @($rules.IdentityReference.Value|Select-Object -Unique).Count -eq 2){return}
 if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){$acl.SetOwner($sid)}
 $acl.SetAccessRuleProtection($true,$false)
 foreach($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){$acl.PurgeAccessRules($rule.IdentityReference)}
 foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  if($item.PSIsContainer){$rule=[Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$rule=[Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','Allow')}
  [void]$acl.AddAccessRule($rule)
 }
 [IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)
}
if($MyInvocation.InvocationName -ne '.'){
 if($Operation -eq 'Protect'){Set-CompanionPrivateAccess $TargetPath;@{ok=$true}|ConvertTo-Json -Compress;exit}
 $manager=Get-CimInstance Win32_Process -Filter "ProcessId=$ManagerPid"
 if(-not $manager){throw 'Manager not running'}
 $stamp=$manager.CreationDate.ToUniversalTime().Ticks.ToString()
 if($Operation -eq 'Stamp'){@{pid=$ManagerPid;startTime=$stamp;nodePath=$manager.ExecutablePath}|ConvertTo-Json -Compress;exit}
 if($stamp -ne $StartTime -or $manager.ExecutablePath -ne $ExpectedNode -or -not $manager.CommandLine.Contains($ExpectedEntry)){throw 'Manager identity mismatch'}
 @{ok=$true}|ConvertTo-Json -Compress
}
