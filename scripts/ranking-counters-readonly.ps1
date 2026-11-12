# Diagnostico READ ONLY acotado al ranking y TCK-2026-00104.
[CmdletBinding()]
param([ValidateSet('counters','activation','postcheck')][string]$Scope='counters')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$password=$null; $payload=$null; $response=$null
$stage='LIBRERIA'
try {
    . (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
    $stage='CONFIGURACION'
    $settings=@{}
    foreach($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot '../.env'))) {
        if($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') {
            $settings[$Matches[1]]=$Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
    $stage='CREDENCIAL_DPAPI'
    if(-not (Test-Path -LiteralPath $settings.PGPASSWORD_DPAPI_FILE -PathType Leaf)) { throw 'SAFE:CREDENCIAL_DPAPI_NO_DISPONIBLE' }
    Add-Type -AssemblyName System.Security
    $encrypted=[IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
    $encoded=[Text.Encoding]::UTF8.GetString($encrypted).Trim()
    $stage='CREDENCIAL_DPAPI_FORMATO'
    if($encoded.StartsWith('{')) {
        $stage='CREDENCIAL_DPAPI_JSON'
        $wrapper=$encoded | ConvertFrom-Json
        if($wrapper.Project -ne 'mzupdnjegfwmpajywckd' -or $wrapper.WindowsSID -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'SAFE:CONTEXTO_DPAPI_INCORRECTO' }
        $encoded=[string]$wrapper.Ciphertext
        $encrypted=[Text.Encoding]::UTF8.GetBytes($encoded)
    }
    if($encoded -match '^01000000[0-9a-f]+$') {
        $secure=($encoded | ConvertTo-SecureString)
        $password=Unwrap-Secret $secure
    } else {
        if($encoded -match '^[A-Za-z0-9+/=]+$') { $encrypted=[Convert]::FromBase64String($encoded) }
        $decrypted=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { $password=[Text.Encoding]::UTF8.GetString($decrypted) }
        finally { [Array]::Clear($decrypted,0,$decrypted.Length) }
    }
    if([string]::IsNullOrEmpty($password) -or $password -match '[\r\n]') { throw 'SAFE:CREDENCIAL_INVALIDA' }
    $stage='CA'
    $ca=Get-TrustedCa $settings.PGSSLROOTCERT
    $queryFile=switch($Scope) {
        'activation' { 'tests/ranking-counters-activation-readonly.sql' }
        'postcheck' { '../deploy/ranking-counters-20261112/verify-readonly.sql' }
        default { 'tests/ranking-counters-readonly.sql' }
    }
    $query=[IO.File]::ReadAllText((Join-Path $PSScriptRoot $queryFile))
    # Evalua solo el SELECT candidato dentro de la misma transaccion READ ONLY.
    # No CREATE/REPLACE, migraciones, cambios de permisos ni datos.
    $candidate=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../server/queries/technicianRankingCounters.sql')).Trim().TrimEnd(';')
    $candidate=$candidate.Replace('p_start',"timestamptz '2026-11-01 05:00Z'").Replace('p_end',"timestamptz '2026-12-01 05:00Z'")
    $comparison="select jsonb_build_object('read_only',current_setting('transaction_read_only'),'candidate',coalesce(jsonb_agg(r),'[]'::jsonb)) from (`n"+$candidate+"`n) r;`n"
    if($Scope -ne 'postcheck') { $query=$query.Replace('set local role service_role;', $comparison+'set local role service_role;') }
    $shell='IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"+$query+"`n"
    $stage='DOCKER_SQL'
    $response=Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    if($response.Code -ne 0) {
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/ranking-counters-error-private.txt'),$response.Error,[Text.UTF8Encoding]::new($false))
        throw ('SAFE:'+ (Get-FailureCategory $response.Error $response.Code))
    }
    $rows=@($response.Output.Trim() -split '\r?\n' | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    foreach($result in $rows) { if($result.read_only -ne 'on') { throw 'SAFE:CONTEXTO_INCORRECTO' } }
    $outputFile=switch($Scope) {
        'activation' { 'ranking-counters-activation-private.json' }
        'postcheck' { 'ranking-counters-postcheck-private.json' }
        default { 'ranking-counters-private.json' }
    }
    $destination=Join-Path $PSScriptRoot ('inventory-auth-lab/runtime/'+$outputFile)
    [IO.File]::WriteAllText($destination,($rows | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
    Write-Output 'RANKING_COUNTERS_READ_ONLY_OK; private output saved; no credentials or operational identifiers printed'
} catch {
    $category='ACCESO_LOCAL_O_CATALOGO'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('CLOUD_METADATA_BLOCKED='+$category+'; etapa='+$stage+'; tipo='+$_.Exception.GetType().Name+'; no cambios remotos; errores originales ocultos')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null; if(Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null } }
