# Respaldo PostgreSQL completo previo al descarte administrativo de prospectos.
# Snapshot consistente y restauracion aislada. Credencial via DPAPI (.env ->
# PGPASSWORD_DPAPI_FILE), nunca interactiva ni mostrada/registrada. No aplica
# migraciones ni escribe en Cloud; el pg_dump en si es de solo lectura
# (BEGIN READ ONLY en el precheck, pg_dump no modifica el origen). Adaptado de
# scripts/respaldar-activacion-final-privado.ps1 (misma logica de
# credencial/Docker/restauracion aislada); solo cambian el precheck de origen,
# la etiqueta del respaldo y la lista de tablas/funciones criticas.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
$root = Split-Path $PSScriptRoot -Parent
# Invoke-PrivateDocker (libreria compartida) corta a los 60s — insuficiente
# para un pg_dump completo (~38MB) por el pooler real. Copia local, mismo
# patron de stdin/Stop-Diagnostic, solo para este paso; no se toca la
# funcion compartida (la usan otros scripts con cargas mas chicas).
function Invoke-PrivateDockerLongRunning([string]$arguments, [string]$inputText = '') {
    $p = New-Object Diagnostics.Process
    $stdinBytes = $null
    try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        $stdinBytes = $utf8.GetBytes($inputText)
        $s = New-Object Diagnostics.ProcessStartInfo
        $s.FileName = (Get-Command docker.exe -ErrorAction Stop).Source; $s.Arguments = $arguments
        $s.UseShellExecute = $false; $s.CreateNoWindow = $true
        $s.RedirectStandardInput = $true; $s.RedirectStandardOutput = $true; $s.RedirectStandardError = $true
        $s.StandardOutputEncoding = $utf8; $s.StandardErrorEncoding = $utf8
        $p.StartInfo = $s; $null = $p.Start()
        $outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
        $p.StandardInput.BaseStream.Write($stdinBytes, 0, $stdinBytes.Length)
        $p.StandardInput.BaseStream.Flush(); $p.StandardInput.Close()
        if (-not $p.WaitForExit(240000)) { $p.Kill(); $p.WaitForExit(); throw 'SAFE:EJECUCION_CANCELADA' }
        [pscustomobject]@{Code = $p.ExitCode; Output = $outTask.GetAwaiter().GetResult(); Error = $errTask.GetAwaiter().GetResult() }
    } catch {
        if ($_.Exception.Message -match '^SAFE:') { throw }
        throw 'SAFE:DOCKER'
    } finally {
        if ($null -ne $stdinBytes) { [Array]::Clear($stdinBytes, 0, $stdinBytes.Length) }
        $p.Dispose()
    }
}
$statusPath = Join-Path $PSScriptRoot 'inventory-auth-lab\runtime\dashboard-support-backup-status.json'
$dir = $null; $password = $null; $payload = $null; $r = $null
function Save-SafeStatus([string]$status, [string]$category = '') {
    [ordered]@{Status = $status; Category = $category; BackupDirectory = $dir; DateUtc = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
}
try {
    $ctx=(& docker context show).Trim(); $endpoint=((& docker context inspect $ctx) | ConvertFrom-Json)[0].Endpoints.docker.Host
    if($endpoint -notmatch '^(npipe:|unix:|tcp://(127\.0\.0\.1|localhost):)') { throw 'SAFE:DOCKER_LOCAL_REQUERIDO' }
    Save-SafeStatus 'WAITING_DPAPI'
    $settings = @{}
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root '.env'))) {
        if ($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') {
            $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if ($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or
        $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
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

    $runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss') + '_' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $dir = Join-Path $env:LOCALAPPDATA ('SmartRaycoBackups\dashboard_support_pre_sql_' + $runId)
    $null = New-Item -ItemType Directory -Path $dir
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($identity in @($sid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $dir -AclObject $acl
    if (-not (Get-Acl -LiteralPath $dir).AreAccessRulesProtected) { throw 'SAFE:ACL_PRIVADA' }
    Save-SafeStatus 'BACKUP_RUNNING'

    # Precheck de origen: confirma el estado exacto que exige la migracion IPTV
    # antes de respaldar — columna/trigger IPTV aun ausentes, trigger de cierre
    # y RPC de preflight con el mismo cuerpo que la migracion verifica por hash.
    # Si el estado cambio (alguien aplico algo distinto mientras tanto), se
    # detiene sin respaldar sobre una base distinta de la documentada.
    $shell = @'
set -eu
IFS= read -r CERT
CERT=${CERT#$(printf '\357\273\277')}
printf %s "$CERT" | base64 -d >/tmp/ca.pem
IFS= read -r PGHOST
IFS= read -r PGPORT
IFS= read -r PGDATABASE
IFS= read -r PGUSER
IFS= read -r PGPASSWORD
export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=5000 -c timezone=UTC'
test ! -e /out/completo.dump
psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS backup_snapshot \gset
\setenv BACKUP_SNAPSHOT :backup_snapshot
\o /out/origen.json
SELECT json_build_object('base_correcta',current_database()='postgres','usuario_correcto',current_user='postgres',
 'read_only',current_setting('transaction_read_only'),'snapshot_at',now(),'server_version',current_setting('server_version'),
 'pre_migration',to_regprocedure('public.discard_unfulfilled_client_prospect(uuid,timestamptz,text,boolean)') is null and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='prospect_discarded_at'),
 'clients_count',(select count(*) from public.clients),'clients_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.clients c),
 'contracts_count',(select count(*) from public.service_contracts),'contracts_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.service_contracts c),
 'installations_count',(select count(*) from public.installations),'installations_md5',(select md5(string_agg(md5(to_jsonb(c)::text),'' order by id)) from public.installations c));
\o
\! pg_dump --no-password --format=custom --lock-wait-timeout=5000 --snapshot="$BACKUP_SNAPSHOT" --file=/out/completo.dump 2>/out/dump-errors.log
\if :SHELL_ERROR
 \quit 3
\endif
ROLLBACK;
SQL
printf '{"PgDumpExit":0}\n' >/out/pg_dump-exit.json
unset PGPASSWORD PGHOST PGUSER PGDATABASE PGOPTIONS
test -s /out/completo.dump
pg_restore --list /out/completo.dump >/out/inventario.txt
pg_restore --file=/dev/null /out/completo.dump 2>/out/archive-check-errors.log
'@
    $script64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shell.Replace("`r`n", "`n")))
    $launch = 'printf %s ' + $script64 + ' | base64 -d > /tmp/backup.sh; exec sh /tmp/backup.sh'
    $payload = $ca + "`n" + $settings.PGHOST + "`n5432`npostgres`n" + $settings.PGUSER + "`n" + $password + "`n"
    $r = Invoke-PrivateDockerLongRunning ('run --rm -i --pull=never --log-driver none --mount "type=bind,source=' + $dir + ',target=/out" postgres:17 sh -c "' + $launch + '"') $payload
    $payload = $null; $password = $null
    if ($r.Code -ne 0) { throw ('SAFE:' + (Get-FailureCategory $r.Error $r.Code)) }
    $origin = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $dir 'origen.json')))
    $dumpExit = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $dir 'pg_dump-exit.json')))
    if ($dumpExit.PgDumpExit -ne 0 -or -not $origin.base_correcta -or -not $origin.usuario_correcto -or -not $origin.pre_migration -or $origin.read_only -ne 'on') { throw 'SAFE:ORIGEN_INESPERADO' }
    $file = Join-Path $dir 'completo.dump'
    $size = (Get-Item -LiteralPath $file).Length
    if ($size -le 5) { throw 'SAFE:ARCHIVO_VACIO' }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    [IO.File]::WriteAllText((Join-Path $dir 'completo.sha256'), $hash + '  completo.dump' + "`n")
    $inventory = [IO.File]::ReadAllText((Join-Path $dir 'inventario.txt'))
    foreach ($table in @('clients', 'profiles', 'service_contracts', 'tickets', 'installations', 'routines',
            'job_assignees', 'job_work_sessions', 'inventory_products', 'inventory_categories',
            'inventory_movements', 'inventory_units', 'inventory_unit_events', 'routine_inventory_operations',
            'campo_inventory_operations', 'material_inventory_rejections', 'client_equipment_photos')) {
        if ($inventory -notmatch ('TABLE DATA public ' + $table + ' ')) { throw 'SAFE:DATOS_CRITICOS_AUSENTES' }
    }
    foreach ($pattern in @('FUNCTION public current_user_role\(', 'FUNCTION public validate_installation_completion\(',
            'FUNCTION public inventory_order_read\(')) {
        if ($inventory -notmatch $pattern) { throw 'SAFE:INVENTARIO_INCOMPLETO' }
    }
    Save-SafeStatus 'RESTORE_RUNNING'
    $restore = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'tests/dashboard-support-restore-isolated.sh')).Replace("`r`n", "`n")
    $evidence = Join-Path $dir 'restore-verify'
    $null=New-Item -ItemType Directory -Path $evidence
    $argsDocker = 'run --rm -i --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user postgres --log-driver none --memory 3g --cpus 2 --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=2300m,mode=1777 --mount "type=bind,source=' + $dir + ',target=/backup,readonly" --mount "type=bind,source=' + $evidence + ',target=/evidence" --entrypoint sh supabase/postgres:17.6.1.136'
    $r = Invoke-PrivateDockerLongRunning $argsDocker $restore
    if ($r.Code -ne 0) { throw 'SAFE:RESTAURACION_BLOQUEADA' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) { throw 'SAFE:HASH_CAMBIO' }
    [IO.File]::WriteAllText((Join-Path $dir 'recuperacion-evidencia.txt'), $r.Output)
    $manifest = [ordered]@{
        Status = 'RESPALDO_VERIFICADO'; Project = 'mzupdnjegfwmpajywckd'; DateUtc = (Get-Date).ToUniversalTime().ToString('o')
        Bytes = $size; SHA256 = $hash; PgDumpExit = $dumpExit.PgDumpExit; PgRestoreListExit = 0; PgRestoreReadExit = 0
        RestorationExit = $r.Code; PreMigration = $origin.pre_migration; SnapshotUtc = $origin.snapshot_at; GlobalDataWrites = 0
        Backup = $file
        TLS = 'verify-full'
        Limitations = 'No Storage files, global role attributes/memberships or external Vault keys; no decryption tested. Role names reconstructed as NOLOGIN; isolated supabase_admin SUPERUSER. No writes to Cloud.'
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'resultado.json') -Encoding UTF8
    $restored=ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $evidence 'restore-fingerprints.json')))
    foreach($field in @('clients_count','clients_md5','contracts_count','contracts_md5','installations_count','installations_md5')) {
      if($origin.$field -ne $restored.$field) { throw 'SAFE:RESTORE_DATA_MISMATCH' }
    }
    Save-SafeStatus 'RESPALDO_VERIFICADO'
    Write-Host ('RESPALDO VERIFICADO: ' + $dir)
} catch {
    $category = 'EJECUCION_BLOQUEADA'
    if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category = $Matches[1] }
    Save-SafeStatus 'BLOQUEADO' $category
    Write-Host ('BLOQUEADO: ' + $category + '. No se muestran errores ni credenciales.'); exit 1
} finally {
    $payload = $null; $password = $null; $r = $null
    if (Get-Variable secure -ErrorAction SilentlyContinue) { $secure = $null }
    $Error.Clear()
}
