# PowerShell 5.1+. Solo diagnostico: sin migraciones, respaldos ni escrituras SQL.
[CmdletBinding()]
param([switch]$LocalOnly, [switch]$LibraryOnly, [string]$SslRootCert)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Diagnostic([string]$code) { throw ('SAFE:' + $code) }
function Unwrap-Secret([Security.SecureString]$value) {
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Parse-PrivateUri([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text) -or $text -match '[\r\n]') { Stop-Diagnostic 'URI_INVALIDA' }
    try { $u=[Uri]$text.Trim() } catch { Stop-Diagnostic 'URI_INVALIDA' }
    if (-not $u.IsAbsoluteUri -or $u.Scheme -notin @('postgres','postgresql')) { Stop-Diagnostic 'URI_INVALIDA' }
    try { $name=[Uri]::UnescapeDataString(($u.UserInfo -split ':',2)[0]) } catch { Stop-Diagnostic 'URI_INVALIDA' }
    if ($name -ne 'postgres.mzupdnjegfwmpajywckd') { Stop-Diagnostic 'PROYECTO_INCORRECTO' }
    if ($u.Host -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $u.Port -ne 5432 -or $u.AbsolutePath -ne '/postgres' -or $u.Fragment) { Stop-Diagnostic 'URI_INVALIDA' }
    # No se heredan password ni parametros TLS/SQL desde la URI.
    [pscustomobject]@{HostName=$u.Host; UserName=$name}
}
function Get-FailureCategory([string]$stderr,[int]$code) {
    if ($stderr -match '(?i)certificate|SSL error|TLS|root certificate|SSL connection|does not support SSL') { return 'TLS' }
    if ($stderr -match '(?i)28P01|password authentication failed|no password supplied|SASL authentication') { return 'AUTENTICACION' }
    if ($stderr -match '(?i)tenant or user not found') { return 'PROYECTO_INCORRECTO' }
    if ($stderr -match '(?i)could not translate host|name or service not known|connection refused|timeout expired|network is unreachable|could not connect|connection timed out|connection reset|server closed the connection') { return 'RED' }
    if ($stderr -match '(?i)42501|permission denied for (table|schema|function)|must be owner|insufficient privilege') { return 'PERMISOS_SQL' }
    if ($stderr -match '(?i)57014|canceling statement|cancelled|canceled|interrupted') { return 'EJECUCION_CANCELADA' }
    if ($code -in @(125,126,127) -or $stderr -match '(?i)docker daemon|docker API|docker_engine|image.*not found|access is denied|permission denied.*docker|executable file not found') { return 'DOCKER' }
    return 'CONSULTA_SQL'
}
function Get-TlsDetail([string]$stderr) {
    if ($stderr -match '(?i)does not match host name|hostname mismatch|no certificate.*host name') { return 'TLS_HOSTNAME' }
    if ($stderr -match '(?i)root certificate file.*(does not exist|could not|cannot)|could not read root certificate|unable to load.*certificate|no certificate or crl found|PEM lib') { return 'TLS_CA_ARCHIVO' }
    if ($stderr -match '(?i)certificate has expired|certificate is not yet valid') { return 'TLS_CERTIFICADO_FECHA' }
    if ($stderr -match '(?i)certificate verify failed|unable to get.*issuer|self.signed certificate|unable to verify.*certificate') { return 'TLS_CADENA' }
    if ($stderr -match '(?i)protocol version|handshake failure|no shared cipher|wrong version number|does not support SSL|SSL connection|SSL error') { return 'TLS_NEGOCIACION' }
    return 'TLS'
}
function Invoke-PrivateDocker([string]$arguments,[string]$inputText='') {
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
        if (-not $p.WaitForExit(60000)) { $p.Kill(); $p.WaitForExit(); Stop-Diagnostic 'EJECUCION_CANCELADA' }
        [pscustomobject]@{Code=$p.ExitCode; Output=$outTask.GetAwaiter().GetResult(); Error=$errTask.GetAwaiter().GetResult()}
    } catch {
        if ($_.Exception.Message -match '^SAFE:') { throw }
        Stop-Diagnostic 'DOCKER'
    } finally {
        if ($null -ne $stdinBytes) { [Array]::Clear($stdinBytes,0,$stdinBytes.Length) }
        $p.Dispose()
    }
}
function Get-TrustedCa([string]$path) {
    try {
        if ($path) {
            # Normaliza CA PEM/DER a PEM ASCII compatible con OpenSSL de Linux.
            $bytes=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $path).Path)
            $text=[Text.Encoding]::UTF8.GetString($bytes)
            if ($text -match 'PRIVATE KEY') { Stop-Diagnostic 'TLS_CA_ARCHIVO' }
            $certs=New-Object Security.Cryptography.X509Certificates.X509Certificate2Collection
            $blocks=[regex]::Matches($text,'(?s)-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----')
            if ($blocks.Count) {
                foreach ($block in $blocks) { $certs.Import([Convert]::FromBase64String(($block.Groups[1].Value -replace '\s',''))) }
            } else { $certs.Import($bytes) }
            if (-not $certs.Count) { Stop-Diagnostic 'TLS_CA_ARCHIVO' }
            foreach ($cert in $certs) {
                $basic=@($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
                if (-not $basic.Count) { Stop-Diagnostic 'TLS_CA_ARCHIVO' }
                $constraints=New-Object Security.Cryptography.X509Certificates.X509BasicConstraintsExtension
                $constraints.CopyFrom($basic[0])
                if (-not $constraints.CertificateAuthority) { Stop-Diagnostic 'TLS_CA_ARCHIVO' }
                if ($cert.NotAfter -lt (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { Stop-Diagnostic 'TLS_CERTIFICADO_FECHA' }
            }
            $pem=($certs | ForEach-Object { "-----BEGIN CERTIFICATE-----`n"+[Convert]::ToBase64String($_.RawData,[Base64FormattingOptions]::InsertLineBreaks)+"`n-----END CERTIFICATE-----" }) -join "`n"
        } else {
            # Solo certificados PUBLICOS de las raices de confianza de Windows.
            $certs=@(Get-ChildItem Cert:\CurrentUser\Root,Cert:\LocalMachine\Root)
            if (-not $certs.Count) { Stop-Diagnostic 'TLS' }
            $pem=($certs | ForEach-Object { "-----BEGIN CERTIFICATE-----`n"+[Convert]::ToBase64String($_.RawData,[Base64FormattingOptions]::InsertLineBreaks)+"`n-----END CERTIFICATE-----" }) -join "`n"
        }
        [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pem))
    } catch {
        if ($_.Exception.Message -match '^SAFE:') { throw }
        Stop-Diagnostic 'TLS_CA_ARCHIVO'
    }
}
if ($LibraryOnly) { return }
$image='postgres:17'; $stage='DOCKER'
$uriSecret=$null; $passwordSecret=$null; $uriText=$null; $passwordText=$null; $payload=$null; $response=$null; $r=$null
$messages=@{
    URI_INVALIDA='Usa la URI Session pooler con puerto 5432 y base postgres; no el comando psql.'
    PROYECTO_INCORRECTO='El usuario/proyecto no coincide con el destino autorizado o el pooler no reconoce el tenant.'
    DOCKER='Docker o la imagen postgres:17 no estan disponibles, o el contenedor no puede ejecutarse. No se descarga nada automaticamente.'
    RED='Fallo DNS, conexion rechazada, interrupcion o tiempo de espera agotado. Revisar red y restricciones de acceso.'
    AUTENTICACION='PostgreSQL rechazo la autenticacion. Verifica la entrada oculta y la propagacion del pooler; no restablezcas otra vez la password.'
    TLS='Fallo de certificado, CA, hostname o negociacion TLS. Se mantiene verify-full. Puedes indicar una CA con -SslRootCert.'
    TLS_CA_REQUERIDA='Indica -SslRootCert con la CA descargada del Dashboard del proyecto Supabase. No se presume que las raices de Windows incluyan esa CA.'
    TLS_CA_ARCHIVO='La CA no existe, no se puede decodificar, contiene una clave privada o no es un certificado CA. Se aceptan certificados publicos PEM/DER.'
    TLS_CERTIFICADO_FECHA='Certificado fuera de su periodo de validez. Verifica certificado y reloj local; no se omite la validacion.'
    TLS_HOSTNAME='El certificado no corresponde al hostname Session pooler introducido. No se sustituye por el host directo ni por una IP.'
    TLS_CADENA='No se pudo validar la cadena hasta la CA confiable. Puede faltar la CA adecuada o un intermedio; este error no permite distinguirlos por si solo.'
    TLS_NEGOCIACION='La negociacion TLS fallo antes de validar la identidad. Revisar protocolo, endpoint o intermediario de red, sin bajar verify-full.'
    PERMISOS_SQL='Conexion establecida, pero faltan permisos para consultar metadatos.'
    EJECUCION_CANCELADA='Entrada cancelada o ejecucion interrumpida/agotada. No se reintenta automaticamente.'
    CONSULTA_SQL='Otro fallo SQL o respuesta inesperada; no se interpreta como password incorrecta.'
    ENTRADA_INVALIDA='Password vacia o con saltos de linea. Introducela en el campo oculto separado de la URI.'
}
try {
    $r=Invoke-PrivateDocker 'version --format {{.Server.Version}}'; if ($r.Code -ne 0) { Stop-Diagnostic 'DOCKER' }
    $r=Invoke-PrivateDocker ('image inspect '+$image+' --format {{.Id}}'); if ($r.Code -ne 0) { Stop-Diagnostic 'DOCKER' }
    $r=Invoke-PrivateDocker ('run --rm --network none --log-driver none '+$image+' psql --version'); if ($r.Code -ne 0) { Stop-Diagnostic 'DOCKER' }
    Write-Host ('LOCAL: PowerShell '+$PSVersionTable.PSVersion+'; Docker OK; psql 17 disponible.')
    $r=Invoke-PrivateDocker ('run --rm --network none --log-driver none '+$image+' pg_dump --version'); if ($r.Code -ne 0) { Stop-Diagnostic 'DOCKER' }
    $stage='TLS'
    if (-not $LocalOnly -and -not $SslRootCert) { Stop-Diagnostic 'TLS_CA_REQUERIDA' }
    $ca=Get-TrustedCa $SslRootCert
    $offlineShell='IFS= read -r TESTSECRET; export TESTSECRET; IFS= read -r CERT; printf %s $CERT | base64 -d > /tmp/smartrayco-ca.pem; test -s /tmp/smartrayco-ca.pem || exit 7; openssl crl2pkcs7 -nocrl -certfile /tmp/smartrayco-ca.pem -out /dev/null || exit 9; test ${#TESTSECRET} -gt 0 || exit 8; printf LOCAL_STDIN_OK'
    $r=Invoke-PrivateDocker ('run --rm -i --network none --log-driver none '+$image+' sh -c "'+$offlineShell+'"') ("synthetic-$-quote-'`n"+$ca+"`n")
    if ($r.Code -eq 9) { Stop-Diagnostic 'TLS_CA_ARCHIVO' }
    if ($r.Code -ne 0 -or $r.Output -ne 'LOCAL_STDIN_OK') { Stop-Diagnostic 'DOCKER' }
    Write-Host 'LOCAL: pg_dump disponible; stdin y certificados publicos OK; TLS verify-full.'
    if ($LocalOnly) { Write-Host 'FIN LOCAL: no hubo conexiones de red ni entradas de produccion.'; return }
    $stage='EJECUCION_CANCELADA'
    $uriSecret=Read-Host 'URI Session pooler (oculta; puede conservar [YOUR-PASSWORD])' -AsSecureString
    $passwordSecret=Read-Host 'Password PostgreSQL (oculta)' -AsSecureString
    $uriText=Unwrap-Secret $uriSecret; $passwordText=Unwrap-Secret $passwordSecret
    $stage='URI_INVALIDA'; $target=Parse-PrivateUri $uriText
    if ([string]::IsNullOrEmpty($passwordText) -or $passwordText -match '[\r\n]') { Stop-Diagnostic 'ENTRADA_INVALIDA' }
    $query=@'
BEGIN READ ONLY;
SELECT json_build_object(
 'conexion','OK','version_servidor',current_setting('server_version'),
 'solo_lectura',current_setting('transaction_read_only'),
 'tls_servidor',coalesce((SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),false),
 'base_correcta',current_database()='postgres','usuario_correcto',current_user='postgres',
 'public_usage',has_schema_privilege(current_user,'public','USAGE'),
 'public_create',has_schema_privilege(current_user,'public','CREATE'),
 'routines_select',has_table_privilege(current_user,'public.routines','SELECT'),
 'profiles_select',has_table_privilege(current_user,'public.profiles','SELECT'),
 'crew_select',has_table_privilege(current_user,'public.job_assignees','SELECT'),
 'sesiones_select',has_table_privilege(current_user,'public.job_work_sessions','SELECT'),
 'tabla_fase161_existe',to_regclass('public.routine_returns') IS NOT NULL,
 'rpc_fase161_existe',to_regprocedure('public.return_routine(uuid,text)') IS NOT NULL
);
ROLLBACK;
'@
    $shell='IFS= read -r CERT; printf %s $CERT | base64 -d > /tmp/smartrayco-ca.pem; IFS= read -r PGHOST; IFS= read -r PGPORT; IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; export PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/smartrayco-ca.pem PGCONNECT_TIMEOUT=10 PGCLIENTENCODING=UTF8; export PGOPTIONS=' + "'-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000'" + '; exec psql -X -q -A -t --no-password -v ON_ERROR_STOP=1 -v VERBOSITY=verbose'
    $payload=$ca+"`n"+$target.HostName+"`n5432`npostgres`n"+$target.UserName+"`n"+$passwordText+"`n"+$query+"`n"
    $stage='DOCKER'
    # Secretos solo por stdin; no argv, archivos host, Docker Config.Env ni logs.
    $response=Invoke-PrivateDocker ('run --rm -i --log-driver none '+$image+' sh -c "'+$shell+'"') $payload
    if ($response.Code -ne 0) {
        $failure=Get-FailureCategory $response.Error $response.Code
        if ($failure -eq 'TLS') { $failure=Get-TlsDetail $response.Error }
        Stop-Diagnostic $failure
    }
    $stage='CONSULTA_SQL'
    try { $result=$response.Output.Trim() | ConvertFrom-Json } catch { Stop-Diagnostic 'CONSULTA_SQL' }
    if ($result.conexion -ne 'OK' -or $result.solo_lectura -ne 'on') { Stop-Diagnostic 'CONSULTA_SQL' }
    # En un pooler, pg_stat_ssl describe pooler -> PostgreSQL, no cliente -> pooler.
    # libpq ya valido este ultimo tramo con verify-full; no confundir ambos.
    if (-not $result.base_correcta -or -not $result.usuario_correcto) { Stop-Diagnostic 'PROYECTO_INCORRECTO' }
    Write-Host 'CONEXION OK: TLS verify-full; solo lectura; proyecto autorizado.'
    foreach ($field in @('public_usage','public_create','routines_select','profiles_select','crew_select','sesiones_select','tabla_fase161_existe','rpc_fase161_existe')) { Write-Host ($field+': '+[bool]$result.$field) }
    Write-Host 'FIN: una prueba, sin reintentos, migraciones, respaldos ni escrituras SQL.'
} catch {
    $category=$stage
    if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    if (-not $messages.ContainsKey($category)) { $category='EJECUCION_CANCELADA' }
    Write-Host ('ERROR ['+$category+']: '+$messages[$category])
    Write-Host 'Errores originales ocultos. No compartas URI, passwords ni tokens.'
    exit 1
} finally {
    $uriText=$null; $passwordText=$null; $payload=$null; $response=$null; $r=$null; $Error.Clear()
    if ($null -ne $uriSecret) { $uriSecret.Dispose() }
    if ($null -ne $passwordSecret) { $passwordSecret.Dispose() }
}
