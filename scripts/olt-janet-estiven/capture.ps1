# Agregados historicos: solo SELECT con READ ONLY, sin impersonacion ni escrituras.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$OutputDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Invoke-Stage1Docker([string]$arguments,[string]$inputText='') {
    $p=New-Object Diagnostics.Process
    $stdinBytes=$null
    try {
        # Windows PowerShell 5.1 uses the console code page for StandardInput.
        # Write bytes directly: no replacement fallback, StreamWriter or BOM.
        $utf8=New-Object Text.UTF8Encoding($false,$true)
        $stdinBytes=$utf8.GetBytes($inputText)
        $s=New-Object Diagnostics.ProcessStartInfo
        $s.FileName=(Get-Command docker.exe -ErrorAction Stop).Source; $s.Arguments=$arguments
        $s.UseShellExecute=$false; $s.CreateNoWindow=$true
        $s.RedirectStandardInput=$true; $s.RedirectStandardOutput=$true; $s.RedirectStandardError=$true
        $s.StandardOutputEncoding=$utf8
        $s.StandardErrorEncoding=$utf8
        $p.StartInfo=$s; $null=$p.Start()
        $outTask=$p.StandardOutput.ReadToEndAsync(); $errTask=$p.StandardError.ReadToEndAsync()
        $p.StandardInput.BaseStream.Write($stdinBytes,0,$stdinBytes.Length)
        $p.StandardInput.BaseStream.Flush(); $p.StandardInput.Close()
        if (-not $p.WaitForExit(600000)) { $p.Kill(); $p.WaitForExit(); Stop-Diagnostic 'EJECUCION_CANCELADA' }
        [pscustomobject]@{Code=$p.ExitCode; Output=$outTask.GetAwaiter().GetResult(); Error=$errTask.GetAwaiter().GetResult()}
    } catch {
        if ($_.Exception.Message -match '^SAFE:') { throw }
        Stop-Diagnostic 'DOCKER'
    } finally {
        if ($null -ne $stdinBytes) { [Array]::Clear($stdinBytes,0,$stdinBytes.Length) }
        $p.Dispose()
    }
}

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


    if (!(Get-Acl -LiteralPath $OutputDirectory).AreAccessRulesProtected) { throw 'SAFE:PRIVATE_DIRECTORY' }
    $destination=Join-Path $OutputDirectory 'preflight.private.json'
    if(Test-Path -LiteralPath $destination) { throw 'SAFE:EXISTING_OUTPUT' }
    $query=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'preflight.sql'))
    $shell='IFS= read -r CERT; printf %s $CERT | base64 -d >/tmp/ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=2000'" + '; exec psql -X -q -At --no-password -v ON_ERROR_STOP=1'
    $nl=[string][char]10
    $payload=$ca+$nl+$settings.PGHOST+$nl+'5432'+$nl+'postgres'+$nl+$settings.PGUSER+$nl+$password+$nl+$query+$nl
    $response=Invoke-Stage1Docker ('run --rm -i --pull=never --log-driver none --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m postgres:17 sh -c "'+$shell+'"') $payload
    if($response.Code -ne 0) { throw ('SAFE:'+(Get-FailureCategory $response.Error $response.Code)) }
    $result=$response.Output.Trim() | ConvertFrom-Json
    if($result.case.read_only -ne 'on') { throw 'SAFE:READ_ONLY_REQUIRED' }
    [IO.File]::WriteAllText($destination,$response.Output.Trim(),[Text.UTF8Encoding]::new($false))
    Write-Output 'CLOUD_PREFLIGHT_READ_ONLY_CAPTURED'
} catch { Write-Output ('BLOCKED: '+$_.Exception.Message); exit 1 }
finally { $password=$null; $payload=$null; $response=$null }
