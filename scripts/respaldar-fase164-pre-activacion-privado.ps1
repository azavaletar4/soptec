# Respaldo privado de solo lectura, punto de referencia PRE-Fase164
# (Fase 163 + Etapa 3 + cierre RLS ya activados en una tarea anterior de
# esta misma sesion; Fase 164 todavia ausente). Mismo procedimiento exacto
# que respaldar-activacion-final-privado.ps1 (Credencial via DPAPI,
# nunca interactiva ni mostrada/registrada; pg_dump de solo lectura,
# restauracion aislada sin red) — SOLO cambia el estado de origen/destino
# que el precheck exige, porque ese estado cambio legitimamente (Fase 163/
# Etapa 3/RLS ya se activaron). El script anterior quedo correctamente
# fijado a su propio checkpoint (Etapa3/RLS ausentes) y por eso se detuvo
# con ORIGEN_INESPERADO al intentarlo hoy — este es su sucesor, no un
# bypass de esa seguridad.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verificar-supabase-privado.ps1') -LibraryOnly
$root = Split-Path $PSScriptRoot -Parent
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
$statusPath = Join-Path $PSScriptRoot 'inventory-auth-lab\runtime\fase164-pre-activacion-backup-status.json'
$dir = $null; $password = $null; $payload = $null; $r = $null
function Save-SafeStatus([string]$status, [string]$category = '') {
    [ordered]@{Status = $status; Category = $category; BackupDirectory = $dir; DateUtc = (Get-Date).ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
}
try {
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
    $dir = Join-Path $env:LOCALAPPDATA ('SmartRaycoBackups\fase164_pre_activacion_completo_' + $runId)
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

    # Precheck de origen: Fase 162/163, Etapa 3 y cierre RLS deben estar
    # PRESENTES (ya activados hoy); Fase 164 debe seguir AUSENTE. Si el
    # estado cambio, se detiene sin respaldar sobre una base distinta de
    # la documentada.
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
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=5000'
psql -X -q -At --no-password -v ON_ERROR_STOP=1 <<'SQL' >/out/origen.json
BEGIN READ ONLY;
SELECT json_build_object('base_correcta',current_database()='postgres','usuario_correcto',current_user='postgres','version_servidor',current_setting('server_version'),'fase162_presente',to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)') IS NOT NULL,'fase163_presente',to_regclass('public.installation_postponements') IS NOT NULL,'etapa3_presente',to_regclass('public.campo_inventory_operations') IS NOT NULL,'rls_cierre_presente',to_regprocedure('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)') IS NOT NULL,'fase164_ausente',to_regclass('public.technician_material_custody') IS NULL);
ROLLBACK;
SQL
set +e
pg_dump --no-password --format=custom --lock-wait-timeout=5000 --file=/out/completo.dump
dump_exit=$?
set -e
printf '{"PgDumpExit":%s}\n' "$dump_exit" >/out/pg_dump-exit.json
test "$dump_exit" -eq 0
test -s /out/completo.dump
unset PGPASSWORD PGHOST PGUSER PGDATABASE PGOPTIONS
pg_restore --list /out/completo.dump >/out/inventario.txt
pg_restore --file=/dev/null /out/completo.dump
'@
    $script64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shell.Replace("`r`n", "`n")))
    $launch = 'printf %s ' + $script64 + ' | base64 -d > /tmp/backup.sh; exec sh /tmp/backup.sh'
    $payload = $ca + "`n" + $settings.PGHOST + "`n5432`npostgres`n" + $settings.PGUSER + "`n" + $password + "`n"
    $r = Invoke-PrivateDockerLongRunning ('run --rm -i --pull=never --log-driver none --mount "type=bind,source=' + $dir + ',target=/out" postgres:17 sh -c "' + $launch + '"') $payload
    $payload = $null; $password = $null
    if ($r.Code -ne 0) { throw ('SAFE:' + (Get-FailureCategory $r.Error $r.Code)) }
    $origin = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $dir 'origen.json')))
    $dumpExit = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $dir 'pg_dump-exit.json')))
    if ($dumpExit.PgDumpExit -ne 0 -or -not $origin.base_correcta -or -not $origin.usuario_correcto -or
        -not $origin.fase162_presente -or -not $origin.fase163_presente -or -not $origin.etapa3_presente -or
        -not $origin.rls_cierre_presente -or -not $origin.fase164_ausente) { throw 'SAFE:ORIGEN_INESPERADO' }
    $file = Join-Path $dir 'completo.dump'
    $size = (Get-Item -LiteralPath $file).Length
    if ($size -le 5) { throw 'SAFE:ARCHIVO_VACIO' }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    [IO.File]::WriteAllText((Join-Path $dir 'completo.sha256'), $hash + '  completo.dump' + "`n")
    $inventory = [IO.File]::ReadAllText((Join-Path $dir 'inventario.txt'))
    foreach ($table in @('clients', 'profiles', 'service_contracts', 'tickets', 'installations', 'routines',
            'job_assignees', 'job_work_sessions', 'inventory_products', 'inventory_categories',
            'inventory_movements', 'inventory_units', 'inventory_unit_events', 'routine_inventory_operations',
            'installation_postponements', 'campo_inventory_operations')) {
        if ($inventory -notmatch ('TABLE DATA public ' + $table + ' ')) { throw 'SAFE:DATOS_CRITICOS_AUSENTES' }
    }
    foreach ($pattern in @('FUNCTION public routine_inventory_operation\(', 'FUNCTION public current_user_role\(',
            'FUNCTION public postpone_installation\(', 'FUNCTION public campo_inventory_operation\(',
            'FUNCTION public inventory_order_read\(')) {
        if ($inventory -notmatch $pattern) { throw 'SAFE:INVENTARIO_INCOMPLETO' }
    }
    Save-SafeStatus 'RESTORE_RUNNING'
    $restore = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'tests\fase161-restore-isolated.sh')).Replace("`r`n", "`n").TrimEnd() + "`n"
    $require = @'
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF to_regprocedure('public.routine_inventory_operation(uuid,uuid,text,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'FASE162_NOT_RESTORED';
 END IF;
 IF to_regclass('public.installation_postponements') IS NULL THEN
   RAISE EXCEPTION 'FASE163_NOT_RESTORED';
 END IF;
 IF to_regclass('public.campo_inventory_operations') IS NULL THEN
   RAISE EXCEPTION 'ETAPA3_NOT_RESTORED';
 END IF;
 IF to_regprocedure('public.inventory_order_read(text,uuid,text,integer,uuid,uuid,text)') IS NULL THEN
   RAISE EXCEPTION 'RLS_CIERRE_NOT_RESTORED';
 END IF;
 IF to_regclass('public.technician_material_custody') IS NOT NULL THEN
   RAISE EXCEPTION 'FASE164_YA_PRESENTE_EN_ORIGEN';
 END IF;
END $$;
BEGIN READ ONLY;
SELECT 'INVENTORY_ROWS='||t||';rows='||(xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',t),false,true,'')))[1]::text
FROM unnest(ARRAY['inventory_products','inventory_movements','inventory_units','inventory_unit_events']) t;
SQL
'@
    $restore = $restore.Replace('echo RESTORE_VERIFIED_WITH_GLOBAL_ROLE_AND_EXTERNAL_KEY_LIMITATIONS', $require + "`n" + 'echo RESTORE_VERIFIED_WITH_GLOBAL_ROLE_AND_EXTERNAL_KEY_LIMITATIONS')
    $argsDocker = 'run --rm -i --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user postgres --log-driver none --memory 2g --cpus 2 --pids-limit 128 --tmpfs /tmp:rw,noexec,nosuid,size=1536m,mode=1777 --mount "type=bind,source=' + $dir + ',target=/backup,readonly" --entrypoint sh supabase/postgres:17.6.1.136'
    $r = Invoke-PrivateDockerLongRunning $argsDocker $restore
    if ($r.Code -ne 0) { throw 'SAFE:RESTAURACION_BLOQUEADA' }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) { throw 'SAFE:HASH_CAMBIO' }
    [IO.File]::WriteAllText((Join-Path $dir 'recuperacion-evidencia.txt'), $r.Output)
    $manifest = [ordered]@{
        Status = 'RESPALDO_VERIFICADO'; Project = 'mzupdnjegfwmpajywckd'; DateUtc = (Get-Date).ToUniversalTime().ToString('o')
        Bytes = $size; SHA256 = $hash; PgDumpExit = $dumpExit.PgDumpExit; PgRestoreListExit = 0; PgRestoreReadExit = 0
        RestorationExit = $r.Code; OrigenFase162Presente = $true; OrigenFase163Presente = $true
        OrigenEtapa3Presente = $true; OrigenRlsCierrePresente = $true; OrigenFase164Ausente = $true
        Backup = $file
        TLS = 'verify-full'
        Limitations = 'No Storage files, global role attributes/memberships or external Vault keys; no decryption tested. Role names reconstructed as NOLOGIN; isolated supabase_admin SUPERUSER. No writes to Cloud.'
    }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dir 'resultado.json') -Encoding UTF8
    Save-SafeStatus 'RESPALDO_VERIFICADO'
    Write-Host ('RESPALDO VERIFICADO: ' + $dir)
} catch {
    $category = 'EJECUCION_BLOQUEADA'
    if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category = $Matches[1] }
    Save-SafeStatus 'BLOQUEADO' $category
    Write-Host ('BLOQUEADO: ' + $category + '. No se muestran errores ni credenciales.')
} finally {
    $payload = $null; $password = $null; $r = $null
    if (Get-Variable secure -ErrorAction SilentlyContinue) { $secure = $null }
    $Error.Clear()
}
