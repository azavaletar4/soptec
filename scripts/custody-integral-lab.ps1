[CmdletBinding()]
param([ValidateSet('Prepare','Restore','Services','Seed','Api','Browser','Status','Stop')][string]$Phase='Status')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
try {
 if($Phase -eq 'Prepare') {
  $free=(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace
  if($free -lt 5GB){throw 'SAFE:INSUFFICIENT_CAPACITY'}
  $dir=Join-Path $env:LOCALAPPDATA ('SmartRaycoLabs\custodia_integral_'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,6))
  $null=New-Item -ItemType Directory -Path $dir
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
   $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
  }
  Set-Acl -LiteralPath $dir -AclObject $acl
  if(-not (Get-Acl -LiteralPath $dir).AreAccessRulesProtected){throw 'SAFE:PRIVATE_ACL_REQUIRED'}
  & node (Join-Path $PSScriptRoot 'custody-integral-lab.mjs') prepare $dir
 } else { & node (Join-Path $PSScriptRoot 'custody-integral-lab.mjs') $Phase.ToLowerInvariant() }
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
} catch {Write-Output 'ISOLATED_LAB_BLOCKED; no production writes; private artifacts preserved';exit 1}
