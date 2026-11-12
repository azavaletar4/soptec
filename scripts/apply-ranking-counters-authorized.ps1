# Ejecuta SOLO el apply.sql autorizado para technician_ranking_between.
# Sin parametros de SQL/ruta, sin reintentos y sin rollback automatico.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$password=$null; $payload=$null; $response=$null
$stage='PRECONDICIONES_LOCALES'
$started=$false
try {
    $package=Join-Path $PSScriptRoot '../deploy/ranking-counters-20261112'
    $runtime=Join-Path $PSScriptRoot 'inventory-auth-lab/runtime'
    $manifest=Get-Content -LiteralPath (Join-Path $package 'manifest.json') -Raw | ConvertFrom-Json
    $expectedApplySha='8e2dfeb15ff2debd6ecf28d8077751daca6926ec29cc5b0a21bbefdd621b6990'
    if($manifest.files.'apply.sql'.sha256 -ne $expectedApplySha) { throw 'SAFE:PAQUETE_NO_AUTORIZADO' }
    foreach($file in $manifest.files.PSObject.Properties) {
        if((Get-FileHash -LiteralPath (Join-Path $package $file.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.Value.sha256) { throw 'SAFE:HUELLA_NO_COINCIDE' }
    }
    $preflightFile=Join-Path $runtime 'ranking-counters-activation-private.json'
    $preflight=Get-Content -LiteralPath $preflightFile -Raw | ConvertFrom-Json
    if(@($preflight).Count -ne 3) { throw 'SAFE:PREFLIGHT_INCOMPLETO' }
    foreach($row in $preflight) { if($row.read_only -ne 'on') { throw 'SAFE:PREFLIGHT_NO_READ_ONLY' } }
    $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($preflight[0].as_of)).TotalMinutes
    if($age -lt 0 -or $age -gt 10) { throw 'SAFE:PREFLIGHT_VENCIDO' }
    $target=$preflight[0].functions | Where-Object name -eq 'technician_ranking_between'
    if($target.definition_md5 -ne $manifest.definitionMd5Before -or $target.owner -ne 'postgres' -or $target.oid -ne $manifest.oidAtCapture) { throw 'SAFE:DERIVA_FUNCION' }
    $backup=[IO.File]::ReadAllText((Join-Path $package 'backup.sql'))
    if(($target.definition+";`n") -cne $backup) { throw 'SAFE:RESPALDO_NO_EXACTO' }
    foreach($helper in $manifest.helpers) {
        $found=$preflight[0].functions | Where-Object signature -eq $helper.signature
        if($found.definition_md5 -ne $helper.definition_md5) { throw 'SAFE:DERIVA_FUNCION_RELACIONADA' }
    }
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $backupPath=Join-Path $runtime ('ranking-counters-backup-before-'+$stamp+'.sql')
    [IO.File]::WriteAllText($backupPath,$backup,[Text.UTF8Encoding]::new($false))
    if((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.files.'backup.sql'.sha256) { throw 'SAFE:RESPALDO_NO_VERIFICADO' }
    Copy-Item -LiteralPath $preflightFile -Destination (Join-Path $runtime ('ranking-counters-preflight-before-'+$stamp+'.json'))
    $stage='LIBRERIA_Y_CONFIGURACION'
    . (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
    $settings=@{}
    foreach($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot '../.env'))) {
        if($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') { $settings[$Matches[1]]=$Matches[2].Trim().Trim('"').Trim("'") }
    }
    if($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
    $stage='CREDENCIAL_DPAPI'
    Add-Type -AssemblyName System.Security
    $encrypted=[IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
    $encoded=[Text.Encoding]::UTF8.GetString($encrypted).Trim()
    if($encoded.StartsWith('{')) {
        $wrapper=$encoded | ConvertFrom-Json
        if($wrapper.Project -ne 'mzupdnjegfwmpajywckd' -or $wrapper.WindowsSID -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'SAFE:CONTEXTO_DPAPI_INCORRECTO' }
        $encoded=[string]$wrapper.Ciphertext; $encrypted=[Text.Encoding]::UTF8.GetBytes($encoded)
    }
    if($encoded -match '^01000000[0-9a-f]+$') {
        $secure=($encoded | ConvertTo-SecureString); $password=Unwrap-Secret $secure
    } else {
        if($encoded -match '^[A-Za-z0-9+/=]+$') { $encrypted=[Convert]::FromBase64String($encoded) }
        $decrypted=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { $password=[Text.Encoding]::UTF8.GetString($decrypted) }
        finally { [Array]::Clear($decrypted,0,$decrypted.Length) }
    }
    if([string]::IsNullOrEmpty($password) -or $password -match '[\r\n]') { throw 'SAFE:CREDENCIAL_INVALIDA' }
    $ca=Get-TrustedCa $settings.PGSSLROOTCERT
    # SQL integro, sin concatenar otras sentencias ni modificar el archivo aprobado.
    $query=[IO.File]::ReadAllText((Join-Path $package 'apply.sql'))
    $shell='IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c application_name=rayco-ranking-counters-20261112 -c lock_timeout=2000 -c statement_timeout=30000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"+$query+"`n"
    $stage='APLICACION_AUTORIZADA'; $started=$true
    $response=Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    $record=[ordered]@{at=[DateTime]::UtcNow.ToString('o');code=$response.Code;stdout=$response.Output;stderr=$response.Error;applySha256=$expectedApplySha;backupPath=$backupPath}
    [IO.File]::WriteAllText((Join-Path $runtime ('ranking-counters-apply-result-'+$stamp+'.json')),($record | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    if($response.Code -ne 0) { throw ('SAFE:'+ (Get-FailureCategory $response.Error $response.Code)) }
    if($response.Error -notmatch 'PASS: contadores esperados; puntos/Altas/posiciones/permisos/dependencias conservados') { throw 'SAFE:RESULTADO_INESPERADO_VERIFICAR_NO_REINTENTAR' }
    Write-Output ('RANKING_APPLY_OK; code=0; protected checks PASS; original backup saved; timestamp='+$stamp+'; run read-only postcheck')
} catch {
    $category='APLICACION_O_GUARDA'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('RANKING_APPLY_STOPPED='+$category+'; etapa='+$stage+'; execution_started='+$started+'; sin reintentos ni rollback automatico; verificar estado antes de actuar')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null; if(Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null } }
