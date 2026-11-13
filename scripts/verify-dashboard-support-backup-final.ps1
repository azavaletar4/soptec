[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$state=Get-Content (Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/dashboard-support-backup-status.json') -Raw|ConvertFrom-Json
$directory=$state.BackupDirectory
$origin=Get-Content (Join-Path $directory 'origen.json') -Raw|ConvertFrom-Json
$manifest=Get-Content (Join-Path $directory 'resultado.json') -Raw|ConvertFrom-Json
$copy=Get-Content (Join-Path $directory 'float-verify/copy-verification.json') -Raw|ConvertFrom-Json
$variants=Get-Content (Join-Path $directory 'float-verify/float-fingerprints.json') -Raw|ConvertFrom-Json
$matched=@($variants|Where-Object {$_.digits -eq 0 -and $_.clients_md5 -eq $origin.clients_md5 -and $_.contracts_md5 -eq $origin.contracts_md5})
if($matched.Count -ne 1 -or $copy.status -ne 'PASS' -or -not $copy.allRowsAndFieldsCompared -or $manifest.PgDumpExit -ne 0 -or $manifest.RestorationExit -ne 0 -or -not $origin.pre_migration) { throw 'BACKUP_NOT_VERIFIED' }
foreach($table in @('clients','service_contracts','installations')) {
 if(-not $copy.tables.$table.allFieldsEqual -or @($copy.tables.$table.numericRepresentationDifferences.PSObject.Properties).Count -gt 0) { throw 'COPY_NOT_EXACT' }
}
$hash=(Get-FileHash -LiteralPath $manifest.Backup -Algorithm SHA256).Hash.ToLowerInvariant()
if($hash -ne $manifest.SHA256.ToLowerInvariant() -or -not (Get-Acl -LiteralPath $directory).AreAccessRulesProtected) { throw 'BACKUP_HASH_OR_ACL_CHANGED' }
$result=[ordered]@{status='PASS';archive=$manifest.Backup;bytes=$manifest.Bytes;sha256=$hash;snapshotUtc=$origin.snapshot_at;restoreExit=0;fullDatabaseDump=$true;allCriticalRowsAndFieldsExactlyEqual=$true;counts=@{clients=$origin.clients_count;contracts=$origin.contracts_count;installations=$origin.installations_count};initialMismatchExplained='JSON float serialization: local extra_float_digits=0 reproduces both original fingerprints; raw COPY has zero differences';expectedHashesReplaced=$false;privateAcl=$true;productionWrites=0;limitations=$manifest.Limitations}
$destination=Join-Path $PSScriptRoot '../deploy/dashboard-support-prospects-20261113/postgres-backup-verification.json'
if(Test-Path -LiteralPath $destination) { throw 'EVIDENCE_EXISTS' }
[IO.File]::WriteAllText($destination,($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$result|ConvertTo-Json -Depth 6
