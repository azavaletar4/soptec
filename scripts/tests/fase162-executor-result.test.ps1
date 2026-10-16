# Only new executor result regressions. Synthetic evidence, no Cloud or Docker.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot/../fase162-executor-result.ps1"
$count=0
function Check($condition,$name){if(-not $condition){throw $name};$script:count++;Write-Output ('PASS '+$name)}
$before='{"read_only":"on","products":{"rows":2,"digest":"synthetic"}}'
$post='{"stage":"postchecks","rows":[{"control":"RPC","resultado":"OK"},{"control":"RESULTADO FINAL","resultado":"INSTALACION ESTRUCTURAL OK"}]}'
$ok=@('F162_GATE_PASSED',$before,'F162_BASELINE_END','F162_COMMIT_CONFIRMED',$post,'F162_POSTCHECKS_END',$before,'F162_AFTER_END') -join "`n"
$r=Get-Fase162InstallationResult 0 $ok
Check ($r.success -and $r.commitConfirmed) 'complete successful evidence'
$r=Get-Fase162InstallationResult 0 'F162_ABORTED_UNSAFE'
Check (-not $r.success -and -not $r.commitConfirmed -and $r.status -eq 'BLOQUEADO_PRECHECK_SIN_INSTALACION') 'psql quit zero is failure when gate denied'
$r=Get-Fase162InstallationResult 0 ''
Check (-not $r.success) 'empty successful exit is not installation'
$r=Get-Fase162InstallationResult 3 $ok
Check (-not $r.success -and $r.commitConfirmed -and -not $r.automaticRetry) 'SQL failure never retries or claims rollback after commit'
$r=Get-Fase162InstallationResult 0 ($ok.Replace('F162_COMMIT_CONFIRMED',''))
Check (-not $r.success -and $r.requiresReadOnlyInspection) 'lost commit response requires read only inspection'
$r=Get-Fase162InstallationResult 0 ($ok.Replace('INSTALACION ESTRUCTURAL OK','BLOQUEADO'))
Check (-not $r.success -and $r.commitConfirmed) 'postcheck failure preserves confirmed commit state'
$r=Get-Fase162InstallationResult 0 ($ok.Replace('"resultado":"OK"','"resultado":"BLOQUEADO"'))
Check (-not $r.success) 'individual postcheck failure cannot be hidden by final row'
$r=Get-Fase162InstallationResult 0 ($ok.Replace("F162_POSTCHECKS_END`n"+$before,"F162_POSTCHECKS_END`n"+$before.Replace('synthetic','changed')))
Check (-not $r.success) 'stock or historical snapshot difference is failure'
$r=Get-Fase162InstallationResult 0 ($ok+"`nF162_COMMIT_CONFIRMED")
Check (-not $r.success) 'duplicate markers rejected'
$r=Get-Fase162InstallationResult 0 ($ok.Replace('F162_AFTER_END','F162_GATE_PASSED'))
Check (-not $r.success) 'missing or reordered markers rejected'
$r=Get-Fase162InstallationResult 0 ($ok+"`nF162_ABORTED_UNSAFE")
Check (-not $r.success -and $r.commitConfirmed -and $r.status -eq 'BLOQUEADO_EVIDENCIA_CONTRADICTORIA') 'contradictory markers never claim no installation after commit'
Write-Output ('PASS '+$count+' focused checks; no network or SQL')
