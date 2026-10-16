// Generates the private executor. It cannot run without a later authorization record.
const fs=require('node:fs');
let ps=fs.readFileSync('scripts/inventory-production-cloud-readonly.ps1','utf8');
ps=ps.replace('param()', 'param([switch]$AuthorizedWindow)');
ps=ps.replace("$ErrorActionPreference='Stop'",`$ErrorActionPreference='Stop'
if(-not $AuthorizedWindow) { throw 'SAFE:VENTANA_NO_AUTORIZADA' }
$window=Get-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/INVENTARIO-PRODUCCION-VENTANA.json') -Raw | ConvertFrom-Json
$authorization=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'inventory-auth-lab/runtime/inventory-window-authorization.json') -Raw | ConvertFrom-Json
if(-not $authorization.authorized -or $authorization.sourceRevision -ne $window.sourceRevision -or [DateTime]::UtcNow -ge [DateTime]::Parse($authorization.expiresAt).ToUniversalTime()) { throw 'SAFE:AUTORIZACION_AUSENTE_O_EXPIRADA' }
if((Get-FileHash -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) $window.bundle.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $window.bundle.sha256) { throw 'SAFE:HASH_BUNDLE_DISTINTO' }
foreach($migration in $window.migrations) {
 if((Get-FileHash -LiteralPath (Join-Path (Split-Path $PSScriptRoot -Parent) $migration.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $migration.sha256) { throw 'SAFE:HASH_MIGRACION_DISTINTO' }
}`);
ps=ps.replace("(Join-Path $PSScriptRoot 'tests/inventory-production-precheck.sql')", "(Join-Path (Split-Path $PSScriptRoot -Parent) $window.bundle.path)")
 .replace('-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000','-c default_transaction_read_only=off -c statement_timeout=60000 -c lock_timeout=2000 -c transaction_timeout=120000')
 .replace("if($result.read_only -ne 'on') { throw 'SAFE:CONTEXTO_INCORRECTO' }", "if(-not $result.migrationsCommitted -or $result.sourceRevision -ne $window.sourceRevision -or -not $result.operationalDataUnchanged -or -not $result.fase162Unchanged) { throw 'SAFE:ESTADO_REMOTO_REQUIERE_INSPECCION' }")
 .replace("../docs/INVENTARIO-PRODUCCION-PRECHECK.json", "../docs/INVENTARIO-PRODUCCION-MIGRACIONES-RESULTADO.json")
 .replace('CLOUD_HISTORICAL_READ_ONLY_OK; solo agregados; sin identificadores ni datos personales', 'INVENTORY_MIGRATIONS_COMMITTED; datos operativos y Fase162 intactos; despliegue compatible inmediato pendiente')
 .replace('CLOUD_METADATA_BLOCKED=', 'INVENTORY_APPLY_STOPPED=')
 .replace('no cambios remotos; errores originales ocultos', 'estado remoto requiere inspeccion de solo lectura antes de reintentar; errores originales ocultos');
fs.writeFileSync('scripts/apply-inventory-production-window.ps1',ps);
console.log('PRIVATE_EXECUTOR_PREPARED; authorization record not created');
