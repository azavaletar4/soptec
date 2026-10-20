# Complete the previously pending recovery drill; no production credentials/network.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../verificar-supabase-privado.ps1') -LibraryOnly
$private=Join-Path $env:LOCALAPPDATA 'SmartRaycoBackups/mi_avance_20261020_155830_e29392f9'
$manifest=Get-Content -Raw (Join-Path $private 'deployment-images/manifest.json')|ConvertFrom-Json
$image='sha256:0ee2ed7441fb08b66ecf437b3c1189c569449fac95a1842b692a43b4892f4466'
$container=$null
function Docker-Lab([string]$arguments){$r=Invoke-PrivateDocker $arguments;if($r.Code -ne 0){throw ('LAB_FAILED: '+$r.Error)};return $r}
try {
 $hostEndpoint=(Docker-Lab 'context inspect --format "{{.Endpoints.docker.Host}}"').Output.Trim()
 if($hostEndpoint -notmatch '^npipe:' -or $manifest.containers.backend.image -ne $image){throw 'LOCAL_EXACT_BACKUP_REQUIRED'}
 foreach($name in @('completo.dump','snapshot-catalog.json','snapshot-fingerprints.jsonl','SHA256SUMS.json','deployment-images/frontend.image.tar','deployment-images/backend.image.tar')){if(-not(Test-Path -LiteralPath (Join-Path $private $name))){throw 'BACKUP_UNAVAILABLE'}}
 $restore=Get-ChildItem -LiteralPath $private -Directory -Filter 'restore_*'|Sort-Object Name -Descending|Select-Object -First 1
 if(-not $restore -or -not(Test-Path -LiteralPath (Join-Path $restore.FullName 'restored-catalog-canonical.json'))){throw 'APPROVED_PG_RESTORE_EVIDENCE_MISSING'}
 $archive=Join-Path $private 'deployment-images/backend.image.tar'
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.files.'backend.image.tar'.sha256){throw 'BACKEND_ARCHIVE_HASH_MISMATCH'}
 $null=Docker-Lab ('load --input "'+$archive+'"')
 if((Docker-Lab ('image inspect --format "{{.Id}}" '+$image)).Output.Trim() -ne $image){throw 'EXACT_IMAGE_ID_REQUIRED'}
 $flags=@('TR069','DEBT_HOLD','MIKROTIK_RECONCILE','INVOICE','TRAFFIC_ANALYTICS','OLT_SYNC','SCHEDULE_ALERT')|ForEach-Object {' -e '+$_+'_SCHEDULER_ENABLED=false'}
 $arguments='run -d --rm --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --log-driver none --tmpfs /tmp:rw,noexec,nosuid,size=32m -e PORT=3000'+($flags -join '')+' --mount "type=bind,source=D:/SmartRayco/scripts/tests/mi-avance-backend-recovery.mjs,target=/lab/check.mjs,readonly" --entrypoint node '+$image+' /app/node_modules/tsx/dist/cli.mjs server/src/index.ts'
 $container=(Docker-Lab $arguments).Output.Trim()
 if($container -notmatch '^[a-f0-9]{64}$'){throw 'UNEXPECTED_LAB_CONTAINER'}
 Start-Sleep -Milliseconds 1200
 $check=Docker-Lab ('exec '+$container+' node /lab/check.mjs')
 $proof=$check.Output.Trim()|ConvertFrom-Json
 if($proof.result -ne 'PASS'){throw 'BACKEND_RECOVERY_FAILED'}
 $report=@{result='PASS';image=$image;productionAccess=$false;schedulers='all disabled in lab';network='none';responses=$proof.responses;postgresBackupAvailable=$true;postgresRestoreEvidenceAvailable=$true;frontendBackupAvailable=$true;backendBackupAvailable=$true}
 $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../../docs/MI-AVANCE-BACKEND-RECUPERACION.json') -Encoding UTF8
 $report|ConvertTo-Json -Depth 8
} finally {if($container -match '^[a-f0-9]{64}$'){$null=Docker-Lab ('stop --time 5 '+$container)}}
