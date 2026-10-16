# Unicode transport regression only. No Cloud access, secrets or migrations.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $root 'scripts/verificar-supabase-privado.ps1') -LibraryOnly
$utf8=New-Object Text.UTF8Encoding($false,$true)
$results=New-Object Collections.Generic.List[object]
function Check([bool]$ok,[string]$name) {
    if(-not $ok){throw ('UNICODE_TEST_FAILED: '+$name)}
    $results.Add([ordered]@{test=$name;status='PASS'})
    Write-Output ('PASS '+$name)
}
function Hash([byte[]]$bytes) {
    $h=[Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($h.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally {$h.Dispose()}
}
$emoji=[char]::ConvertFromUtf32(0x1F4E6)
$fixtures=@(
    @{name='ascii';text='SELECT ''literal-$-backslash-\-quotes'';'},
    @{name='latin';text=('Espa'+[char]0x00F1+'ol '+[char]0x00E1+[char]0x00E9+[char]0x00ED+[char]0x00F3+[char]0x00FA)},
    @{name='supplementary';text=($emoji+[char]::ConvertFromUtf32(0x1F680))},
    @{name='cjk-arabic';text=([string][char]0x6F22+[char]0x5B57+[char]0x0627+[char]0x0644)},
    @{name='normalization-distinct';text=([string][char]0x00E9+'|e'+[char]0x0301)},
    @{name='sql-json-crlf';text=("BEGIN READ ONLY;`r`nSELECT '"+$emoji+"', '{`"icon`":`""+$emoji+"`"}'::jsonb;`nROLLBACK;`n")}
)
# Reproduce the previous StreamWriter path, including its actual code page.
$p=New-Object Diagnostics.Process
try {
    $s=New-Object Diagnostics.ProcessStartInfo
    $s.FileName=(Get-Command docker.exe).Source
    $s.Arguments='run --rm -i --pull=never --network none --log-driver none --read-only --cap-drop ALL postgres:17 cat'
    $s.UseShellExecute=$false;$s.CreateNoWindow=$true
    $s.RedirectStandardInput=$true;$s.RedirectStandardOutput=$true;$s.RedirectStandardError=$true
    $s.StandardOutputEncoding=$utf8;$s.StandardErrorEncoding=$utf8
    $p.StartInfo=$s;$null=$p.Start()
    $legacyEncoding=$p.StandardInput.Encoding.WebName
    $o=$p.StandardOutput.ReadToEndAsync();$e=$p.StandardError.ReadToEndAsync()
    $p.StandardInput.Write($emoji);$p.StandardInput.Close()
    if(-not $p.WaitForExit(10000)){throw 'Legacy probe timeout'}
    $legacy=$o.GetAwaiter().GetResult();$null=$e.GetAwaiter().GetResult()
    Check ($p.ExitCode -eq 0) 'legacy probe completes'
    $legacyEvidence=[ordered]@{stdinEncoding=$legacyEncoding;expectedHex=([BitConverter]::ToString($utf8.GetBytes($emoji))).Replace('-','').ToLowerInvariant();actualHex=([BitConverter]::ToString($utf8.GetBytes($legacy))).Replace('-','').ToLowerInvariant();lossReproduced=($legacy -cne $emoji)}
    Write-Output ('LEGACY_STDIN_ENCODING='+$legacyEncoding+'; LOSS='+$legacyEvidence.lossReproduced)
} finally {$p.Dispose()}
foreach($f in $fixtures){
    $r=Invoke-PrivateDocker 'run --rm -i --pull=never --network none --log-driver none --read-only --cap-drop ALL postgres:17 cat' $f.text
    Check ($r.Code -eq 0 -and [string]::Equals($r.Output,$f.text,[StringComparison]::Ordinal)) ('exact roundtrip '+$f.name)
    $r=Invoke-PrivateDocker 'run --rm -i --pull=never --network none --log-driver none --read-only --cap-drop ALL postgres:17 sha256sum' $f.text
    Check ($r.Code -eq 0 -and ($r.Output -split '\s+')[0] -ceq (Hash $utf8.GetBytes($f.text))) ('byte SHA256 '+$f.name)
}
$r=Invoke-PrivateDocker 'run --rm -i --pull=never --network none --log-driver none --read-only --cap-drop ALL postgres:17 sh -c "cat >&2"' $fixtures[5].text
Check ($r.Code -eq 0 -and [string]::Equals($r.Error,$fixtures[5].text,[StringComparison]::Ordinal)) 'stderr exact UTF8'
$invalidRejected=$false
try {$null=Invoke-PrivateDocker 'not-executed' ([string][char]0xD800)} catch {$invalidRejected=$true}
Check $invalidRejected 'unpaired surrogate rejected before process starts'
$migrations=@(
    @{path='supabase/migrations/20261015180000_fase162_inventario_rutinas.sql';sha256='16a7d9a05dfb6b02ddce08051f7293a93bb246429ca8237229c81ac46748b225'},
    @{path='supabase/migrations/20261016020000_fase162_autorizacion_recibos.sql';sha256='17f0c543b0742fb40d2992ea36238f807fe5b4fa13dbdb3e05a837a0b9d34f72'},
    @{path='scripts/inventory-auth-lab/runtime/fase162-installation-bundle.sql';sha256='898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b'}
)
foreach($m in $migrations){
    $path=Join-Path $root $m.path
    Check ((Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $m.sha256) ('approved source unchanged '+[IO.Path]::GetFileName($path))
    $text=[IO.File]::ReadAllText($path,$utf8)
    Check ((Hash $utf8.GetBytes($text)) -ceq $m.sha256) ('strict UTF8 decode/encode '+[IO.Path]::GetFileName($path))
    $r=Invoke-PrivateDocker 'run --rm -i --pull=never --network none --log-driver none --read-only --cap-drop ALL postgres:17 sha256sum' $text
    Check ($r.Code -eq 0 -and ($r.Output -split '\s+')[0] -ceq $m.sha256) ('received SQL bytes unchanged '+[IO.Path]::GetFileName($path))
}
# A fresh PostgreSQL without network, volumes, ports or operational data.
$name='smartrayco-unicode-'+[Guid]::NewGuid().ToString('N')
$created=$false
try {
    $r=Invoke-PrivateDocker ('run --rm -d --pull=never --name '+$name+' --network none --log-driver none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17')
    if($r.Code -ne 0){throw 'Isolated PostgreSQL unavailable'}
    $created=$true
    $ready=$false
    for($i=0;$i -lt 60;$i++){
        $r=Invoke-PrivateDocker ('exec '+$name+' pg_isready -h 127.0.0.1 -U postgres')
        if($r.Code -eq 0){$ready=$true;break}
        Start-Sleep -Milliseconds 200
    }
    Check $ready 'isolated PostgreSQL ready without network'
    foreach($f in $fixtures){
        $literal=$f.text.Replace("'","''")
        $query="BEGIN READ ONLY; SELECT jsonb_build_object('read_only',current_setting('transaction_read_only'),'client_encoding',current_setting('client_encoding'),'hex',encode(convert_to('"+$literal+"','UTF8'),'hex'),'sha256',encode(sha256(convert_to('"+$literal+"','UTF8')),'hex')); ROLLBACK;"
        $r=Invoke-PrivateDocker ('exec -i -e PGCLIENTENCODING=UTF8 '+$name+' psql -h 127.0.0.1 -U postgres -X -q -A -t -v ON_ERROR_STOP=1') $query
        if($r.Code -ne 0){throw 'Read-only PostgreSQL Unicode probe failed'}
        $j=$r.Output|ConvertFrom-Json
        Check ($j.read_only -eq 'on' -and $j.client_encoding -eq 'UTF8' -and $j.hex -ceq ([BitConverter]::ToString($utf8.GetBytes($f.text))).Replace('-','').ToLowerInvariant() -and $j.sha256 -ceq (Hash $utf8.GetBytes($f.text))) ('PostgreSQL literal bytes/hash '+$f.name)
    }
} finally {
    if($created){$r=Invoke-PrivateDocker ('rm -f '+$name);if($r.Code -ne 0){throw 'Isolated container cleanup failed'}}
}
$report=[ordered]@{at=[DateTime]::UtcNow.ToString('o');status='PASS';environment='ISOLATED_DOCKER_NO_NETWORK';powershell=$PSVersionTable.PSVersion.ToString();legacy=$legacyEvidence;results=$results.ToArray();approvedFiles=$migrations;cloudAccess=$false;migrationsExecuted=$false}
[IO.File]::WriteAllText((Join-Path $root 'docs/FASE162-UNICODE-PRUEBAS.json'),($report|ConvertTo-Json -Depth 12),$utf8)
Write-Output ('PASS '+$results.Count+' Unicode transport checks; no Cloud access')
