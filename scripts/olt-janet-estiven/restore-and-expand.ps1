# Respaldo logico completo (Fase 168) antes de desplegar Fase 166/167.
# Autorizado explicitamente por el usuario: Supabase Free, sin PITR --
# estrategia de dos copias independientes (PC + VM) via pg_dump.
# Mismo patron de seguridad ya probado en material-custody-integral-backup.ps1:
# credencial SOLO por DPAPI (CurrentUser), SOLO por stdin al contenedor,
# nunca en argv/env visibles ni en archivo/log; destino validado antes de
# conectar; directorio con ACL restringida a este usuario + SYSTEM.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Prepare','Database','Restore')][string]$Phase,[string]$BackupDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
# Sin esto, Process.StandardInput (StreamWriter interno de .NET Framework,
# incluso escribiendo via .BaseStream) antepone un BOM UTF-8 a la PRIMERA
# linea del stdin del contenedor -- corrompe el primer "IFS= read -r" del
# script embebido (en este caso, el certificado CA en base64) sin tocar
# ningun secreto; confirmado con una carga sintetica antes de usar
# credenciales reales. No afecta la consola interactiva del usuario.
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
. 'D:/SmartRayco/scripts/verificar-supabase-privado.ps1' -LibraryOnly

function Invoke-BackupDocker([string]$arguments,[string]$inputText='') {
    $p=New-Object Diagnostics.Process
    $stdinBytes=$null
    try {
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
try {
    $backupRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'SmartRaycoBackups'))
    $namePattern='^olt_janet_estiven_[0-9]{8}_[0-9]{6}_[a-f0-9]{8}$'

    if ($Phase -eq 'Prepare') {
        $disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
        if ($disk.FreeSpace -lt 2GB) { throw 'SAFE:CAPACIDAD_INSUFICIENTE' }
        $BackupDirectory=Join-Path $backupRoot ('olt_janet_estiven_'+(Get-Date).ToUniversalTime().ToString('yyyyMMdd_HHmmss')+'_'+[Guid]::NewGuid().ToString('N').Substring(0,8))
        $null=New-Item -ItemType Directory -Path $BackupDirectory
        $acl=New-Object Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true,$false)
        foreach ($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().User,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
            $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
        }
        Set-Acl -LiteralPath $BackupDirectory -AclObject $acl
        if (-not (Get-Acl -LiteralPath $BackupDirectory).AreAccessRulesProtected) { throw 'SAFE:PRIVATE_ACL' }
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'backup-location.json'),(@{BackupDirectory=$BackupDirectory;Status='PREPARED';CreatedUtc=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
        Write-Output ('PRIVATE_BACKUP_DIRECTORY='+$BackupDirectory+'; ACL restringida a usuario actual y SYSTEM; espacio libre verificado')
        return
    }

    $resolved=[IO.Path]::GetFullPath($BackupDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -ne $backupRoot -or [IO.Path]::GetFileName($resolved) -notmatch $namePattern -or -not (Get-Acl -LiteralPath $resolved).AreAccessRulesProtected) { throw 'SAFE:PRIVATE_DIRECTORY' }
    $BackupDirectory=$resolved

    if ($Phase -eq 'Database') {
        $settings=@{}
        foreach ($line in [IO.File]::ReadAllLines('D:/SmartRayco/.env')) {
            if ($line -match '^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLROOTCERT|PGPASSWORD_DPAPI_FILE)=(.*)$') {
                $settings[$Matches[1]]=$Matches[2].Trim().Trim('"').Trim("'")
            }
        }
        if ($settings.PGHOST -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -or $settings.PGUSER -ne 'postgres.mzupdnjegfwmpajywckd' -or $settings.PGPORT -ne '5432' -or $settings.PGDATABASE -ne 'postgres' -or $settings.PGSSLMODE -ne 'verify-full') { throw 'SAFE:DESTINO_NO_AUTORIZADO' }
        if (-not (Test-Path -LiteralPath $settings.PGPASSWORD_DPAPI_FILE -PathType Leaf)) { throw 'SAFE:CREDENCIAL_DPAPI_NO_DISPONIBLE' }
        Add-Type -AssemblyName System.Security
        $encrypted=[IO.File]::ReadAllBytes($settings.PGPASSWORD_DPAPI_FILE)
        $encoded=[Text.Encoding]::UTF8.GetString($encrypted).Trim()
        if ($encoded.StartsWith('{')) {
            $wrapper=$encoded | ConvertFrom-Json
            if ($wrapper.Project -ne 'mzupdnjegfwmpajywckd' -or $wrapper.WindowsSID -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'SAFE:CONTEXTO_DPAPI_INCORRECTO' }
            $encoded=[string]$wrapper.Ciphertext
            $encrypted=[Text.Encoding]::UTF8.GetBytes($encoded)
        }
        if ($encoded -match '^01000000[0-9a-f]+$') {
            $secure=($encoded | ConvertTo-SecureString)
            $password=Unwrap-Secret $secure
        } else {
            if ($encoded -match '^[A-Za-z0-9+/=]+$') { $encrypted=[Convert]::FromBase64String($encoded) }
            $decrypted=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            try { $password=[Text.Encoding]::UTF8.GetString($decrypted) }
            finally { [Array]::Clear($decrypted,0,$decrypted.Length) }
        }
        if ([string]::IsNullOrEmpty($password) -or $password -match '[\r\n]') { throw 'SAFE:CREDENCIAL_INVALIDA' }
        $ca=Get-TrustedCa $settings.PGSSLROOTCERT

        $shell=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'backup.sh')).Replace("`r`n","`n")
        $script64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($shell))
        $launch='printf %s '+$script64+' | base64 -d > /tmp/backup.sh; exec sh /tmp/backup.sh'
        $payload=$ca+"`n"+$settings.PGHOST+"`n5432`npostgres`n"+$settings.PGUSER+"`n"+$password+"`n"
        $response=Invoke-BackupDocker ('run --rm -i --pull=never --read-only --cap-drop ALL --log-driver none --tmpfs /tmp:rw,noexec,nosuid,size=64m --mount "type=bind,source='+$BackupDirectory+',target=/out" postgres:17 sh -c "'+$launch+'"') $payload
        if ($response.Code -ne 0) {
            $failure=Get-FailureCategory $response.Error $response.Code
            if ($failure -eq 'TLS') { $failure=Get-TlsDetail $response.Error }
            # Shell exit codes used by fase168-pg-logical-backup.sh itself (no stderr leak): 1=existing output files, 3=pg_dump/pg_dumpall/roles failed inside psql.
            Stop-Diagnostic $failure
        }
        Write-Output 'DATABASE_READ_ONLY_OK'
        return
    }

    if ($Phase -eq 'Restore') {
        $evidence=Join-Path $BackupDirectory ('restore-verify-'+[DateTime]::UtcNow.ToString('yyyyMMdd_HHmmss'))
        if (Test-Path -LiteralPath $evidence) { throw 'SAFE:EVIDENCIA_YA_EXISTE' }
        $null=New-Item -ItemType Directory -Path $evidence
        $restoreScript=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'restore-and-expand.sh')).Replace("`r`n","`n")
        $restoreScript64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($restoreScript))
        $launch='printf %s '+$restoreScript64+' | base64 -d > /tmp/restore.sh; exec sh /tmp/restore.sh'
        $response=Invoke-BackupDocker ('run --rm -i --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user postgres --log-driver none --memory 3g --cpus 2 --pids-limit 128 --tmpfs /tmp:rw,size=512m,uid=100,gid=101 --tmpfs /var/lib/postgresql/data:rw,size=2300m,uid=100,gid=101,mode=0700 --tmpfs /var/run/postgresql:rw,size=16m,uid=100,gid=101 --mount "type=bind,source='+$BackupDirectory+',target=/backup,readonly" --mount "type=bind,source='+$evidence+',target=/evidence" --mount "type=bind,source='+(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path+',target=/candidate,readonly" --mount "type=bind,source='+(Join-Path $evidence 'lab-current')+',target=/out" --mount "type=bind,source='+(Join-Path $PSScriptRoot 'execution')+',target=/scripts,readonly" supabase/postgres:17.6.1.136 sh -c "'+$launch+'"')
        if ($response.Code -ne 0) { Write-Output ('RESTORE_WARN: codigo '+$response.Code+'; revisar '+$evidence); }
        [IO.File]::WriteAllText((Join-Path $evidence 'stdout.log'),$response.Output,[Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText((Join-Path $evidence 'stderr.log'),$response.Error,[Text.UTF8Encoding]::new($false))
        Write-Output ('RESTORE_VERIFY_DONE; evidencia en '+$evidence)
        return
    }
} catch {
    $category='BACKUP_BLOCKED'
    if ($_.Exception.Message -match '^SAFE:([A-Z_]+)$') { $category=$Matches[1] }
    Write-Output ('BLOCKED='+$category+'; phase='+$Phase+'; sin escrituras en Cloud; errores originales ocultos')
    exit 1
} finally {
    $password=$null; $payload=$null; $response=$null
    if (Get-Variable secure -ErrorAction SilentlyContinue) { $secure=$null }
}
