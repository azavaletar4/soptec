# Agregados historicos: solo SELECT con READ ONLY, sin impersonacion ni escrituras.
[CmdletBinding()]
param()
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

    $cfg=Get-Content 'D:/smartrayco-fase168/revision-olt-janet-estiven/scripts/olt-janet-estiven/execution-config.json' -Raw | ConvertFrom-Json
    if (!(Get-Acl -LiteralPath $cfg.dir).AreAccessRulesProtected) { throw 'SAFE:PRIVATE_DIRECTORY' }
    $shell=[IO.File]::ReadAllText((Join-Path $cfg.workspace 'apply-cloud.sh')).Replace("\r\n","\n")
    $script64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shell))
    $launch='printf %s '+$script64+' | base64 -d > /tmp/backup.sh; exec sh /tmp/backup.sh'
    $payload=$ca+"\n"+$settings.PGHOST+"\n5432\npostgres\n"+$settings.PGUSER+"\n"+$password+"\n"
    $payload=$payload.Replace('\n', [string][char]10)
    $response=Invoke-Stage1Docker ('run --rm -i --pull=never --read-only --cap-drop ALL --log-driver none --tmpfs /tmp:rw,noexec,nosuid,size=128m --mount "type=bind,source='+(Join-Path $cfg.dir 'production-apply')+',target=/out" --mount "type=bind,source='+$cfg.workspace+',target=/scripts,readonly" postgres:17 sh -c "'+$launch+'"') $payload
    if($response.Code -ne 0) { [IO.File]::WriteAllText((Join-Path $cfg.dir 'apply-errors.private.txt'),$response.Error+$response.Output); throw 'SAFE:BACKUP_FAILED' }
    Write-Output 'STAGE2_EXPANSION_COMMITTED_AND_READBACK_COMPLETE'
} catch {
    $category='ACCESO_LOCAL_O_CATALOGO'
    if($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('CLOUD_METADATA_BLOCKED='+$category+'; etapa='+$stage+'; tipo='+$_.Exception.GetType().Name+'; no cambios remotos; errores originales ocultos')
    exit 1
} finally { $password=$null; $payload=$null; $response=$null; if(Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null } }
