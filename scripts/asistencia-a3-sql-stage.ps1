# Agregados historicos: solo SELECT con READ ONLY, sin impersonacion ni escrituras.
[CmdletBinding()]
param([ValidateSet('pre','apply','post','security')][string]$Mode='pre')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$password=$null; $payload=$null; $response=$null
$stage='LIBRERIA'
try {
    . 'D:/SmartRayco/scripts/verificar-supabase-privado.ps1' -LibraryOnly
    $stage='CONFIGURACION'
    $settings=@{}
    foreach($line in [IO.File]::ReadAllLines('D:/SmartRayco/.env')) {
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
    $query=if($Mode -eq 'apply') { [IO.File]::ReadAllText((Join-Path (Get-Location) '.env.a3-recovery/apply-a3-guarded.sql')) } elseif($Mode -eq 'security') { [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sql/asistencia-a3-security-readonly.sql')) } else { [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'sql/asistencia-a3-backup-metadata.sql')) }
    $shell='IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'

    if($Mode -eq 'apply') { $shell=$shell.Replace('default_transaction_read_only=on','default_transaction_read_only=off') }
    $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"+$query+"`n"
    $response=Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    if($response.Code -ne 0) { throw ('SAFE:'+ (Get-FailureCategory $response.Error $response.Code)) }
    if($Mode -eq 'apply') { Write-Output 'A3_MIGRATION_COMMITTED'; exit 0 }
    $result=$response.Output.Trim() | ConvertFrom-Json
    if($result.read_only -ne 'on') { throw 'SAFE:CONTEXTO_INCORRECTO' }
    $utf8=New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path (Get-Location) ('.env.a3-recovery/sql-'+$Mode+'-private.json')),($result|ConvertTo-Json -Depth 60),$utf8)
    Write-Output ('A3_SQL_'+$Mode.ToUpper()+'_READONLY_OK')
} catch {
    $category='ACCESO_LOCAL_O_CATALOGO'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('A3_SQL_STAGE_FAILED='+$category+'; mode='+$Mode+'; error original oculto')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null }
