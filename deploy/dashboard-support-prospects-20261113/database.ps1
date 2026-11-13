# SQL de paquete sellado. Lecturas protegidas; aplicar/revertir exige autorización expresa.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('preflight','apply','verify','rollback-unused','disable-used')][string]$Action,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedPackageSha256,
 [switch]$Authorized
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$password=$null; $payload=$null; $response=$null
$stage='AUTHORIZATION'
if($Action -in @('apply','rollback-unused','disable-used') -and -not $Authorized) {
 Write-Output 'STOPPED=EXPLICIT_AUTHORIZATION_REQUIRED; no credentials loaded; no connections'; exit 1
}
$workspaceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$readOnlyAction=$Action -in @('preflight','verify')
$stage='MANIFEST'
try {
    $manifestPath=Join-Path $PSScriptRoot 'package.json'
    if((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedPackageSha256) { throw 'SAFE:PACKAGE_HASH_DRIFT' }
    $manifest=[IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
    if(($manifest.services -join ',') -ne 'frontend' -or $manifest.backendSources.Count -ne 0) { throw 'SAFE:SCOPE_DRIFT' }
    foreach($entry in $manifest.files.PSObject.Properties) {
      if([IO.Path]::GetFileName($entry.Name) -ne $entry.Name -or (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw 'SAFE:PACKAGE_FILE_DRIFT' }
    }
    $library=Join-Path $workspaceRoot 'scripts/verificar-supabase-privado.ps1'
    if((Get-FileHash -LiteralPath $library -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'f79a3e17a453f2725330f27fe0195fcbbb3d98c701100d21e29d4d1713f31a96') { throw 'SAFE:LOCAL_LIBRARY_DRIFT' }
    . $library -LibraryOnly
    $dockerContext=(& docker context show).Trim()
    $dockerEndpoint=((& docker context inspect $dockerContext) | ConvertFrom-Json)[0].Endpoints.docker.Host
    if($dockerEndpoint -notmatch '^(npipe:|unix:|tcp://(127\.0\.0\.1|localhost):)') { throw 'SAFE:DOCKER_LOCAL_REQUERIDO' }
    $stage='CONFIGURACION'
    $settings=@{}
    foreach($line in [IO.File]::ReadAllLines((Join-Path $workspaceRoot '.env'))) {
        if($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') {
            $settings[$Matches[1]]=$Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    if($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
    $stage='CREDENCIAL_DPAPI'
    Add-Type -AssemblyName System.Security
    $encrypted=[IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
    $encoded=[Text.Encoding]::UTF8.GetString($encrypted).Trim()
    if($encoded.StartsWith('{')) {
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
    $query=[IO.File]::ReadAllText((Join-Path $PSScriptRoot ($Action+'.sql')))
    if($Action -eq 'apply') {
      $attempt=Join-Path $workspaceRoot 'scripts/inventory-auth-lab/runtime/dashboard-support-prospects-release/database-apply-attempt.json'
      $attemptStream=[IO.File]::Open($attempt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
      $attemptStream.Dispose()
    }
    $shell='IFS= read -r CERT; CERT=${CERT#$(printf ''\357\273\277'')}; printf %s "$CERT" | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1'
    $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"+$query+"`n"
    $sqlMode=if($readOnlyAction) { 'on' } else { 'off' }
    $shell=$shell.Replace('default_transaction_read_only=on',('default_transaction_read_only='+$sqlMode))
    $stage='CONTROLLED_SQL'
    $response=Invoke-PrivateDocker ('run --rm -i --pull=never --log-driver none --read-only --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    if($response.Code -ne 0) { throw ('SAFE:'+ (Get-FailureCategory $response.Error $response.Code)) }
    Write-Output ('PASS='+$Action+'; package='+$ExpectedPackageSha256+'; businessRecordsModifiedByScript=false; output withheld')
} catch {
    $category='ACCESO_LOCAL_O_CATALOGO'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('DATABASE_STOPPED='+$category+'; stage='+$stage+'; stop and review before retry; original errors withheld')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null; if(Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null } }
