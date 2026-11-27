# Comprobacion obligatoria antes de cada publicacion (regla permanente,
# Fase 29.1, 27/11/2026): la migracion finance_contract_cycle_status
# nunca se aplico en produccion y el frontend ya la llamaba — el bug real
# reportado por el propietario (Diego Rojas Gamboa / Roberto Gil Gil) fue
# exactamente esta desincronizacion entre migraciones, RPC y frontend.
# Este script generaliza la verificacion para cualquier modulo: toma el
# alcance declarado de un release (deploy/consolidation-release-scope.json,
# frontendSources), extrae cada supabase.rpc('nombre') que esos archivos
# referencian y confirma de solo lectura, en produccion real, que la
# funcion existe en pg_proc (public). No asume nada de migraciones locales
# ni de memoria de sesiones previas — lee produccion tal cual esta ahora.
# Nunca ejecutar deploy de un release con RPC en frontend que esta funcion
# marque como ausente.
[CmdletBinding()]
param(
    [string]$ScopeFile = (Join-Path $PSScriptRoot '../deploy/consolidation-release-scope.json'),
    [ValidatePattern('^[a-z0-9-]+$')][string]$EvidenceTag = 'default'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$password = $null; $payload = $null; $response = $null; $stage = 'LIBRERIA'
try {
    . ('D:/SMARTRAYCO/scripts/verificar-supabase-privado.ps1') -LibraryOnly
    $context = (& docker context show).Trim()
    $endpoint = ((& docker context inspect $context) | ConvertFrom-Json)[0].Endpoints.docker.Host
    if ($endpoint -notmatch '^(npipe:|unix:|tcp://(127\.0\.0\.1|localhost):)') { throw 'SAFE:DOCKER_LOCAL_REQUERIDO' }
    $stage = 'ALCANCE'
    if (-not (Test-Path -LiteralPath $ScopeFile)) { throw 'SAFE:SCOPE_NO_ENCONTRADO' }
    $scope = Get-Content -Raw -LiteralPath $ScopeFile | ConvertFrom-Json
    $repoRoot = Split-Path -Parent (Split-Path -Parent $ScopeFile)
    $rpcNames = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($relPath in @($scope.frontendSources)) {
        $srcFile = Join-Path $repoRoot $relPath
        if (-not (Test-Path -LiteralPath $srcFile)) { throw ('SAFE:FUENTE_DECLARADA_AUSENTE:' + $relPath) }
        $content = [IO.File]::ReadAllText($srcFile)
        foreach ($m in [regex]::Matches($content, "supabase\.rpc\(\s*['\""]([a-zA-Z0-9_]+)['\""]")) {
            $null = $rpcNames.Add($m.Groups[1].Value)
        }
    }
    if ($rpcNames.Count -eq 0) {
        Write-Output 'RELEASE_RPC_DEPENDENCIES_PASS; sin llamadas RPC en el alcance declarado'
        return
    }
    $stage = 'DESTINO_PRIVADO'
    $dir = Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/finance-phase28-private/secure'
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir }
    $acl = New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))) }
    if (-not (Get-Acl -LiteralPath $dir).AreAccessRulesProtected) { Set-Acl -LiteralPath $dir -AclObject $acl }
    if (-not (Get-Acl -LiteralPath $dir).AreAccessRulesProtected) { throw 'SAFE:ACL_PRIVADA' }
    $destination = Join-Path $dir ('rpc-dependencies-' + $EvidenceTag + '-private.json')
    if (Test-Path -LiteralPath $destination) { throw 'SAFE:EVIDENCIA_EXISTENTE' }
    $stage = 'CONFIGURACION'; $settings = @{}
    foreach ($line in [IO.File]::ReadAllLines(('D:/SMARTRAYCO/.env'))) {
        if ($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
    }
    if ($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
    $stage = 'CREDENCIAL_DPAPI'; Add-Type -AssemblyName System.Security
    $encrypted = [IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
    $encoded = [Text.Encoding]::UTF8.GetString($encrypted).Trim()
    if ($encoded.StartsWith('{')) {
        $wrapper = $encoded | ConvertFrom-Json
        if ($wrapper.Project -ne 'mzupdnjegfwmpajywckd' -or $wrapper.WindowsSID -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'SAFE:CONTEXTO_DPAPI_INCORRECTO' }
        $encoded = [string]$wrapper.Ciphertext; $encrypted = [Text.Encoding]::UTF8.GetBytes($encoded)
    }
    if ($encoded -match '^01000000[0-9a-f]+$') { $secure = ($encoded | ConvertTo-SecureString); $password = Unwrap-Secret $secure }
    else {
        if ($encoded -match '^[A-Za-z0-9+/=]+$') { $encrypted = [Convert]::FromBase64String($encoded) }
        $decrypted = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        try { $password = [Text.Encoding]::UTF8.GetString($decrypted) } finally { [Array]::Clear($decrypted, 0, $decrypted.Length) }
    }
    if ([string]::IsNullOrEmpty($password) -or $password -match '[\r\n]') { throw 'SAFE:CREDENCIAL_INVALIDA' }
    $stage = 'CA'; $ca = Get-TrustedCa $settings.PGSSLROOTCERT
    $namesJsonArray = ($rpcNames | ForEach-Object { "'" + ($_ -replace "'", '') + "'" }) -join ','
    $query = "begin isolation level repeatable read read only;`nselect jsonb_build_object('at',now(),'read_only',current_setting('transaction_read_only'),'present',(select jsonb_object_agg(n,(select count(*) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=n)) from unnest(array[$namesJsonArray]) n));`nrollback;`n"
    $shell = 'IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=45000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload = $ca + "`n" + $settings.PGHOST + "`n5432`npostgres`n" + $settings.PGUSER + "`n" + $password + "`n" + $query + "`n"
    $stage = 'SQL_READONLY'
    $response = Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "' + $shell + '"') $payload
    if ($response.Code -ne 0) { throw ('SAFE:' + (Get-FailureCategory $response.Error $response.Code)) }
    $result = $response.Output.Trim() | ConvertFrom-Json
    if ($result.read_only -ne 'on') { throw 'SAFE:CONTEXTO_INCORRECTO' }
    [IO.File]::WriteAllText($destination, $response.Output.Trim(), [Text.UTF8Encoding]::new($false))
    $missing = @($result.present.PSObject.Properties | Where-Object { $_.Value -eq 0 } | ForEach-Object { $_.Name })
    if ($missing.Count -gt 0) {
        Write-Output ('RELEASE_RPC_DEPENDENCIES_FAIL; funciones ausentes en produccion: ' + ($missing -join ', ') + '; NO DESPLEGAR; evidence saved privately')
        exit 1
    }
    Write-Output ('RELEASE_RPC_DEPENDENCIES_PASS; ' + $rpcNames.Count + ' funciones verificadas en produccion; evidence saved privately')
} catch {
    $category = 'ACCESO_LOCAL_O_CATALOGO'; if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category = $Matches[1] }
    Write-Output ('RPC_DEPENDENCY_CHECK_STOPPED=' + $category + '; stage=' + $stage + '; line=' + $_.InvocationInfo.ScriptLineNumber + '; type=' + $_.Exception.GetType().Name + '; no remote mutations; original errors withheld'); exit 1
} finally { $password = $null; $payload = $null; $response = $null; if (Get-Variable secure -ErrorAction SilentlyContinue) { $secure = $null } }
