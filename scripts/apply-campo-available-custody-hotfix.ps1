# Incidente Ruber: reemplaza solamente inventory_order_read con guarda MD5 y rollback exacto.
# Sin DML operativo, cambios de permisos o migraciones generales.
[CmdletBinding()]
param()
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
    # Unicamente CREATE OR REPLACE de la funcion de lectura, con guarda MD5 exacta.
    $query=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fix-campo-available-custody.sql'))
    $query += @'

BEGIN READ ONLY;
SELECT json_build_object('read_only',current_setting('transaction_read_only'),'at',clock_timestamp(),'function_md5',md5(pg_get_functiondef('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure)),'function_acl',(SELECT proacl::text FROM pg_proc WHERE oid='public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)'::regprocedure));
ROLLBACK;
'@
    $shell='IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c statement_timeout=10000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"+$query+"`n"
    $stage='DOCKER_SQL'
    $response=Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    if($response.Code -ne 0) { throw ('SAFE:'+ (Get-FailureCategory $response.Error $response.Code)) }
    $result=$response.Output.Trim() | ConvertFrom-Json
    if($result.function_md5 -ne '8cc863804104190ce7a3b9cfb67bf458') { throw 'SAFE:POSTCHECK_FUNCION' }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/ruber-hotfix-applied.json'),($result | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    Write-Output ('HOTFIX_READ_FUNCTION_APPLIED; md5='+$result.function_md5+'; operational_DML=0')
} catch {
    $category='APLICACION_O_GUARDA'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('HOTFIX_BLOCKED='+$category+'; etapa='+$stage+'; errores y credenciales no mostrados')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null; if(Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null } }
