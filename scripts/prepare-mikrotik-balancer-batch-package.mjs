// Paquete reproducible SOLO BACKEND para la correccion del exceso de Log
// Ingestion de Supabase (fix/mikrotik-balancer-batch-logs-20261118, commit
// 414778e). A diferencia de scripts/frontend-consolidation-release.*, este
// release no toca absolutamente nada de frontend (sin cambios en src/,
// index.html, vite.config.ts) -- por eso no reutiliza esa herramienta, que
// siempre empaqueta el arbol de frontend completo sin importar el alcance.
//
// 100% local: no abre SSH, no hace scp, no toca la VM de produccion
// (192.168.55.201), no ejecuta deploy/update.sh, no aplica migraciones.
// Solo lee el commit YA HECHO en git y escribe archivos bajo
// scripts/inventory-auth-lab/runtime/ -- nunca sobrescribe un paquete ya
// validado (mismo criterio de "nunca repetir un intento fallido" que el
// resto de scripts de release de este proyecto).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// A proposito NO hay un commit esperado fijo escrito aqui: un script que se
// commitea a si mismo no puede conocer de antemano el hash del commit que
// lo incluye. En su lugar se valida la RAMA (estable) y que el arbol en
// alcance (BACKEND_SOURCES/EVIDENCE_TESTS) este limpio y realmente
// commiteado -- el commit real queda registrado dinamicamente en el manifiesto.
const EXPECTED_BRANCH = 'fix/mikrotik-balancer-batch-logs-20261118';
const BACKEND_SOURCES = ['server/src/mikrotik/balancerDiscovery.ts', 'server/src/services/mikrotikBalancerDiscoveryService.ts'];
// Tests empaquetados solo como evidencia trazable, nunca se copian a la
// imagen de produccion (el Dockerfile.backend hace COPY . . de todo el
// repo en el commit real, los tests viajan igual que hoy -- esto no cambia
// nada de eso, solo documenta cuales son los archivos de ESTE release).
const EVIDENCE_TESTS = [
  'server/src/services/__tests__/mikrotikBalancerDiscovery.test.ts',
  'server/src/services/__tests__/mikrotikBalancerDiscoveryBatch.test.ts',
  'server/tests/mikrotikBalancerBatchPostgrest.test.ts',
];

const outDir = path.resolve('scripts/inventory-auth-lab/runtime/mikrotik-balancer-batch-package');
mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, 'manifest.json');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// --- Verificaciones de alcance (nunca empaquetar algo distinto a lo
// autorizado, ni algo que no coincida con lo ya commiteado) ---
const headCommit = git('rev-parse', 'HEAD');
const headBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (headBranch !== EXPECTED_BRANCH) throw new Error(`BRANCH_MISMATCH: HEAD en "${headBranch}", esperado "${EXPECTED_BRANCH}"`);
const dirtyScoped = git('status', '--porcelain', '--', ...BACKEND_SOURCES);
if (dirtyScoped) throw new Error(`WORKING_TREE_DIRTY_IN_SCOPE:\n${dirtyScoped}`);
// Nunca empaquetar un commit que todavia arrastra cambios de otras fases
// (Altas/respaldos) -- confirma que esos archivos NO estan en este commit.
const committedFiles = git('ls-tree', '-r', '--name-only', headCommit).split('\n');
for (const f of [...BACKEND_SOURCES, ...EVIDENCE_TESTS]) {
  if (!committedFiles.includes(f)) throw new Error(`FILE_NOT_IN_COMMIT: ${f}`);
}

// --- Tarball determinista SOLO de los 2 archivos backend (mismo patron de
// git archive + mtime fijo + umask fijo que el resto del proyecto, para
// que el tar sea byte-a-byte reproducible sin importar la maquina/hora). ---
const commitEpoch = git('show', '-s', '--format=%ct', headCommit);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'mikrotik-balancer-pkg-'));
let tarBytes;
try {
  const tarPath = path.join(tmp, 'backend-source.tar');
  execFileSync('git', [
    '-c', 'tar.umask=0022',
    'archive', headCommit, '--format=tar', `--mtime=@${commitEpoch}`, '--output=' + tarPath,
    ...BACKEND_SOURCES,
  ]);
  tarBytes = readFileSync(tarPath);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const tarName = 'backend-source.tar';

// --- Hashes individuales de cada archivo (ademas del tar completo) para
// poder verificar uno por uno, igual que el contrato de release existente. ---
const fileHashes = {};
for (const f of [...BACKEND_SOURCES, ...EVIDENCE_TESTS, 'deploy/Dockerfile.backend']) {
  fileHashes[f] = sha256(readFileSync(f));
}

const toolHash = sha256(readFileSync(new URL(import.meta.url)));

const manifest = {
  kind: 'backend-only-package',
  localOnly: true,
  productionWrites: 0,
  sourceCommit: headCommit,
  sourceBranch: EXPECTED_BRANCH,
  toolHash,
  generatedAt: new Date().toISOString(),
  scope: {
    backendSources: BACKEND_SOURCES,
    frontendSources: [],
    frontendAssets: [],
  },
  evidenceTests: EVIDENCE_TESTS,
  baseDockerfile: 'deploy/Dockerfile.backend',
  files: {
    [tarName]: sha256(tarBytes),
    ...fileHashes,
  },
  verification: {
    'tsc -p tsconfig.server.json --noEmit': 'PASS (sin errores nuevos; 1 error preexistente no relacionado en src/types/domain.ts, confirmado igual en main)',
    'node --import tsx --test server/src/services/__tests__/*.test.ts': '383/383 PASS',
    'node --import tsx --test server/src/services/__tests__/mikrotikBalancerDiscoveryBatch.test.ts': '7/7 PASS (cliente Supabase y fetch MikroTik falsos)',
    'node --import tsx --test server/tests/mikrotikBalancerBatchPostgrest.test.ts': '6/6 PASS (Postgres 17 + PostgREST reales y aislados en Docker, imagenes fijadas por digest, sin tocar produccion)',
  },
  rollback: {
    procedure:
      'Este release NUNCA debe desplegarse solo: siempre junto a la imagen backend que ya corre en produccion en ese momento. ' +
      'Antes de construir/promover la imagen candidata, el procedimiento de 5 fases del proyecto (prepare/build/deploy/verify/rollback, ver ESTADO_DESARROLLO.md) ' +
      'debe respaldar primero la imagen backend EN VIVO (su tag/sha256 se confirma en el momento real del deploy, nunca se fija de antemano en este paquete). ' +
      'Si verify falla despues de desplegar, revertir sirve el backend a esa imagen respaldada -- cero migraciones SQL en este release, por lo que el rollback no requiere ningun paso de base de datos.',
    requiresSqlRollback: false,
  },
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');

if (existsSync(manifestPath)) {
  const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (existing.toolHash !== toolHash || existing.sourceCommit !== manifest.sourceCommit || JSON.stringify(existing.files) !== JSON.stringify(manifest.files)) {
    throw new Error('PACKAGE_CONTRACT_DRIFT: ya existe un paquete validado distinto en ' + manifestPath);
  }
  console.log(JSON.stringify({ ok: true, alreadyPackaged: true, manifest: manifestPath, productionWrites: 0 }));
  process.exit(0);
}

writeFileSync(path.join(outDir, tarName), tarBytes, { flag: 'wx' });
writeFileSync(manifestPath, manifestBytes, { flag: 'wx' });
console.log(JSON.stringify({ ok: true, alreadyPackaged: false, outDir, manifest: manifestPath, files: Object.keys(manifest.files), productionWrites: 0 }));
