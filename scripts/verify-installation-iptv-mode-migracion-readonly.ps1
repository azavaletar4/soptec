# Verificacion de solo lectura POST-migracion de 20261111140000_installation_iptv_mode.sql
# Ningun DDL/DML: solo BEGIN READ ONLY ... ROLLBACK. Mismo patron de credencial
# DPAPI + Docker aislado que el resto de scripts de solo lectura del proyecto.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$password = $null; $payload = $null; $response = $null
$stage = 'LIBRERIA'
try {
    . (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
    $stage = 'CONFIGURACION'
    $settings = @{}
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot '../.env'))) {
        if ($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') {
            $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if ($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or
        $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
    $stage = 'CREDENCIAL_DPAPI'
    if (-not (Test-Path -LiteralPath $settings.PGPASSWORD_DPAPI_FILE -PathType Leaf)) { throw 'SAFE:CREDENCIAL_DPAPI_NO_DISPONIBLE' }
    Add-Type -AssemblyName System.Security
    $encrypted = [IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
    $encoded = [Text.Encoding]::UTF8.GetString($encrypted).Trim()
    if ($encoded.StartsWith('{')) {
        $wrapper = $encoded | ConvertFrom-Json
        if ($wrapper.Project -ne 'mzupdnjegfwmpajywckd' -or $wrapper.WindowsSID -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'SAFE:CONTEXTO_DPAPI_INCORRECTO' }
        $encoded = [string]$wrapper.Ciphertext
        $encrypted = [Text.Encoding]::UTF8.GetBytes($encoded)
    }
    if ($encoded -match '^01000000[0-9a-f]+$') {
        $secure = ($encoded | ConvertTo-SecureString)
        $password = Unwrap-Secret $secure
    } else {
        if ($encoded -match '^[A-Za-z0-9+/=]+$') { $encrypted = [Convert]::FromBase64String($encoded) }
        $decrypted = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { $password = [Text.Encoding]::UTF8.GetString($decrypted) }
        finally { [Array]::Clear($decrypted, 0, $decrypted.Length) }
    }
    if ([string]::IsNullOrEmpty($password) -or $password -match '[\r\n]') { throw 'SAFE:CREDENCIAL_INVALIDA' }
    $ca = Get-TrustedCa $settings.PGSSLROOTCERT
    $query = @'
BEGIN READ ONLY;
SELECT json_build_object(
 'read_only',current_setting('transaction_read_only'),'at',clock_timestamp(),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) ORDER BY column_name),'[]') FROM information_schema.columns WHERE table_schema='public' AND table_name='installations' AND column_name IN ('iptv_policy_version','iptv_installation_mode','closure_operation_id','closure_payload_hash')),
 'constraints',(SELECT coalesce(jsonb_agg(conname ORDER BY conname),'[]') FROM pg_constraint WHERE conrelid='public.installations'::regclass AND conname IN ('installations_iptv_policy_check','installations_iptv_mode_check','installations_closure_receipt_check')),
 'triggers',(SELECT coalesce(jsonb_agg(tgname ORDER BY tgname),'[]') FROM pg_trigger WHERE tgrelid='public.installations'::regclass AND tgname IN ('b_installation_iptv_insert','b_installation_iptv_update')),
 'completion_trigger_md5',(SELECT md5(regexp_replace(regexp_replace(replace(prosrc,chr(13),''),'--[^'||chr(10)||']*','','g'),'[[:space:]]','','g')) FROM pg_proc WHERE oid=to_regprocedure('public.validate_installation_completion()')),
 'legacy_assert_present',to_regprocedure('public.assert_material_closure_ready_iptv_legacy(text,uuid)') IS NOT NULL,
 'new_assert_present',to_regprocedure('public.assert_material_closure_ready(text,uuid)') IS NOT NULL,
 'preflight_present',to_regprocedure('public.installation_iptv_preflight(uuid,uuid,text,uuid,text)') IS NOT NULL,
 'guard_trigger_fn_present',to_regprocedure('public.guard_installation_iptv_policy()') IS NOT NULL,
 'assert_mode_fn_present',to_regprocedure('public.assert_installation_iptv_mode(uuid,uuid,uuid,text)') IS NOT NULL,
 'installations_total',(SELECT count(*) FROM public.installations),
 'installations_with_mode_set',(SELECT count(*) FROM public.installations WHERE iptv_policy_version IS NOT NULL),
 'installations_by_status',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT status::text st,count(*) c FROM public.installations GROUP BY status ORDER BY status)x),
 'contracts_total',(SELECT count(*) FROM public.service_contracts),
 'inventory_units_total',(SELECT count(*) FROM public.inventory_units),
 'tickets_total',(SELECT count(*) FROM public.tickets),
 'routines_total',(SELECT count(*) FROM public.routines),
 'preflight_acl',to_regprocedure('public.installation_iptv_preflight(uuid,uuid,text,uuid,text)')::regprocedure::text,
 'preflight_grants',(SELECT coalesce(jsonb_agg(grantee||':'||privilege_type ORDER BY grantee,privilege_type),'[]') FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='installation_iptv_preflight')
);
ROLLBACK;
'@
    $shell = 'IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload = $ca + "`n" + $settings.PGHOST + "`n5432`npostgres`n" + $settings.PGUSER + "`n" + $password + "`n" + $query + "`n"
    $response = Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "' + $shell + '"') $payload
    if ($response.Code -ne 0) { throw ('SAFE:' + (Get-FailureCategory $response.Error $response.Code)) }
    $destination = Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/iptv-migration-postcheck.json'
    [IO.File]::WriteAllText($destination, $response.Output, [Text.UTF8Encoding]::new($false))
    Write-Output ('POSTCHECK_OK; saved=' + $destination)
} catch {
    $category = 'ACCESO_LOCAL_O_CATALOGO'
    if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category = $Matches[1] }
    Write-Output ('POSTCHECK_BLOCKED=' + $category + '; errores y credenciales no mostrados')
    exit 1
} finally {
    $password = $null; $payload = $null; $response = $null
    if (Get-Variable secure -ErrorAction SilentlyContinue) { $secure = $null }
}
