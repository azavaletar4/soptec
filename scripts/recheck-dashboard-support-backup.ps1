[CmdletBinding()]
param([ValidateSet('copy-verify','float-verify')][string]$EvidenceName='copy-verify')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
try {
 . (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
 $backupState=Get-Content (Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/dashboard-support-backup-status.json') -Raw | ConvertFrom-Json
 $backupDirectory=$backupState.BackupDirectory
 if(-not (Get-Acl -LiteralPath $backupDirectory).AreAccessRulesProtected) { throw 'SAFE:PRIVATE_ACL' }
 $manifest=Get-Content (Join-Path $backupDirectory 'resultado.json') -Raw | ConvertFrom-Json
 if((Get-FileHash -LiteralPath $manifest.Backup -Algorithm SHA256).Hash -ne $manifest.SHA256) { throw 'SAFE:ARCHIVE_DRIFT' }
 $context=(& docker context show).Trim();$endpoint=((& docker context inspect $context)|ConvertFrom-Json)[0].Endpoints.docker.Host
 if($endpoint -notmatch '^(npipe:|unix:|tcp://(127\.0\.0\.1|localhost):)') { throw 'SAFE:DOCKER_LOCAL_REQUERIDO' }
 $evidence=Join-Path $backupDirectory $EvidenceName
 if(Test-Path -LiteralPath $evidence) { throw 'SAFE:EVIDENCE_EXISTS' }
 $null=New-Item -ItemType Directory -Path $evidence
 $shell=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'tests/dashboard-support-backup-recheck.sh')).Replace("`r`n","`n")
 $result=Invoke-PrivateDocker ('run --rm -i --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user postgres --log-driver none --memory 3g --cpus 2 --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=2300m,mode=1777 --mount "type=bind,source='+$backupDirectory+',target=/backup,readonly" --mount "type=bind,source='+$evidence+',target=/evidence" --entrypoint sh supabase/postgres:17.6.1.136') $shell
 if($result.Code -ne 0) { throw 'SAFE:ISOLATED_RESTORE_FAILED' }
 [IO.File]::WriteAllText((Join-Path $evidence 'restore-summary.log'),$result.Output)
 & python (Join-Path $PSScriptRoot 'verify-dashboard-support-backup-copy.py') $evidence
 if($LASTEXITCODE -ne 0) { throw 'SAFE:COPY_VERIFICATION_FAILED' }
 if((Get-FileHash -LiteralPath $manifest.Backup -Algorithm SHA256).Hash -ne $manifest.SHA256) { throw 'SAFE:ARCHIVE_DRIFT' }
 Write-Output 'COPY_RESTORE_VERIFIED; backup unchanged; no production connection'
}catch{
 $category='LOCAL_RESTORE_FAILED';if($_.Exception.Message -match '^SAFE:([A-Z_]+)$'){$category=$Matches[1]}
 Write-Output ('STOPPED='+$category+'; production unchanged');exit 1
}
