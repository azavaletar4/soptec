# Targeted LOCAL HTTP recovery drill; reuses already verified backup/image.
# No dump, load, migration, production connection, API call or scheduler.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../verificar-supabase-privado.ps1') -LibraryOnly
$backup=Join-Path $env:LOCALAPPDATA 'SmartRaycoBackups/mi_avance_20261020_155830_e29392f9/deployment-images'
$image='sha256:21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c'
$container=$null
function Invoke-LabDocker([string]$arguments) {
 $r=Invoke-PrivateDocker $arguments
 if($r.Code -ne 0){throw ('LAB_DOCKER_FAILED: '+$r.Error)}
 return $r
}
function Http-Read([string]$path) {
 $r=Invoke-LabDocker ('exec '+$container+' wget -S -O - http://127.0.0.1'+$path)
 $statuses=[regex]::Matches($r.Error,'(?m)^\s*HTTP/\S+\s+(\d{3})\b')
 if($statuses.Count -ne 1 -or $statuses[0].Groups[1].Value -ne '200'){throw 'HTTP_200_REQUIRED_WITHOUT_REDIRECT'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try {$digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($r.Output)))).Replace('-','').ToLowerInvariant()}
 finally {$sha.Dispose()}
 $expected=$manifest.files.('html'+$path)
 if($digest -ne $expected.sha256){throw ('BACKED_CONTENT_DIGEST_MISMATCH: '+$path)}
 return [pscustomobject]@{path=$path;status=200;sha256=$digest;matchesBackup=$true;body=$r.Output}
}
try {
 if(-not (Get-Acl -LiteralPath $backup).AreAccessRulesProtected -and -not (Get-Acl -LiteralPath (Split-Path $backup)).AreAccessRulesProtected){throw 'PRIVATE_BACKUP_REQUIRED'}
 $manifest=Get-Content -Raw (Join-Path $backup 'manifest.json')|ConvertFrom-Json
 if($manifest.containers.frontend.image -ne $image){throw 'EXPECTED_BACKUP_IMAGE_REQUIRED'}
 $endpoint=(Invoke-LabDocker 'context inspect --format "{{.Endpoints.docker.Host}}"').Output.Trim()
 if($endpoint -notmatch '^npipe:'){throw 'LOCAL_DOCKER_ONLY'}
 $actual=(Invoke-LabDocker ('image inspect --format "{{.Id}}" '+$image)).Output.Trim()
 if($actual -ne $image){throw 'EXACT_RECOVERED_IMAGE_REQUIRED'}
 # These four capabilities are a subset of Docker's normal root container
 # defaults. CHOWN prepares only tmpfs cache; SETUID/SETGID start nginx workers;
 # NET_BIND_SERVICE permits its original port. Production config/image is intact.
 $name='mi-avance-http-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
 $start=Invoke-LabDocker ('run -d --rm --pull=never --name '+$name+' --label mi-avance.local-http-recovery=true --network none --add-host backend:127.0.0.1 --read-only --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add NET_BIND_SERVICE --security-opt no-new-privileges --log-driver none --tmpfs /run:rw,noexec,nosuid,size=8m --tmpfs /var/cache/nginx:rw,noexec,nosuid,size=8m --entrypoint nginx '+$image+' -g "daemon off;"')
 $container=$start.Output.Trim()
 if($container -notmatch '^[a-f0-9]{64}$'){throw 'UNEXPECTED_LAB_CONTAINER_ID'}
 # nginx's master is ready before workers; bounded readiness probe, no API.
 $ready=$false
 for($n=0;$n -lt 20;$n++) {
  $probe=Invoke-PrivateDocker ('exec '+$container+' wget -q -O /dev/null http://127.0.0.1/')
  if($probe.Code -eq 0){$ready=$true;break}
  Start-Sleep -Milliseconds 150
 }
 if(-not $ready){throw 'FRONTEND_HTTP_NOT_READY'}
 # HTTP response bytes must match the original backup manifest, not merely
 # another copy extracted from the container being tested.
 $index=Http-Read '/index.html'
 $routeResponse=Invoke-LabDocker ('exec '+$container+' wget -S -O - http://127.0.0.1/campo')
 if($routeResponse.Error -notmatch 'HTTP/\S+ 200\b' -or $routeResponse.Output -cne $index.body){throw 'CAMPO_SPA_FALLBACK_MISMATCH'}
 $bundlePaths=@([regex]::Matches($index.body,'<script[^>]+src="([^" ]+)"')|ForEach-Object {$_.Groups[1].Value}|Where-Object {$_ -match '^/assets/[A-Za-z0-9_.-]+\.js$'})
 if($bundlePaths.Count -lt 1){throw 'EXPECTED_ENTRY_BUNDLE_NOT_FOUND'}
 $responses=@($index)+@($bundlePaths|ForEach-Object {Http-Read $_})
 $report=[ordered]@{result='PASS';image=$image;exactBackedImage=$true;productionAccess=$false;network='none';httpClient='wget inside isolated container';capabilities=@('CHOWN','SETUID','SETGID','NET_BIND_SERVICE');route='/campo';routeStatus=200;routeMatchesBackedIndex=$true;responses=@($responses|Select-Object path,status,sha256,matchesBackup)}
 $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $PSScriptRoot '../../docs/MI-AVANCE-FRONTEND-RECUPERACION.json') -Encoding UTF8
 $report|ConvertTo-Json -Depth 8
} finally {
 if($container -match '^[a-f0-9]{64}$') {
  $null=Invoke-LabDocker ('stop --time 5 '+$container)
 }
}
