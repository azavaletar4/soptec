import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Fase 175 — prueba de regresion/equivalencia para la reescritura de
// fn_traffic_anomalies (ver 20261026130000_fase175_traffic_anomalies_lateral.sql).
// Carga la version ORIGINAL (Fase 36) bajo otro nombre y la version NUEVA
// (la migracion real que se aplicaria) en el mismo Postgres aislado, y
// compara que devuelvan el MISMO resultado en los casos que importan: ratio
// que supera el umbral, ratio que no lo supera, consumo reciente por debajo
// del minimo, y el caso filoso — un contrato con trafico reciente alto pero
// SIN ninguna muestra de linea base (debe excluirse en ambas versiones).

const sqlFile = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const client = (n: number) => `10000000-0000-0000-0000-00000000000${n}`;
const contract = (n: number) => `20000000-0000-0000-0000-00000000000${n}`;
const device1 = '50000000-0000-0000-0000-000000000001';

test('PostgreSQL isolado: fn_traffic_anomalies (Fase 175, LATERAL) — mismo resultado que la version original', { timeout: 60000 }, async () => {
  const container = `smartrayco-fase175-test-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) =>
    execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const psqlArgs = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const query = (sql: string) => docker(psqlArgs, sql).trim();

  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(ready, 'isolated Postgres must start');

    query(sqlFile('./trafficAnomaliesSchema.sql'));
    query(`insert into public.mikrotik_devices (id) values ('${device1}');`);

    // ---- Version ORIGINAL (Fase 36), renombrada para poder compararla ----
    const originalMigration = sqlFile('../../supabase/migrations/20260930030000_fase36_analitica_trafico.sql');
    const originalFn = originalMigration
      .match(/create or replace function public\.fn_traffic_anomalies[\s\S]*?\$\$;/)![0]
      .replace('function public.fn_traffic_anomalies', 'function public.fn_traffic_anomalies_original');
    query(originalFn);

    // ---- Version NUEVA (Fase 175, la migracion real que se prepara) ----
    const newMigration = sqlFile('../../supabase/migrations/20261026130000_fase175_traffic_anomalies_lateral.sql');
    query(newMigration);

    // La migracion se puede reaplicar sin error (CREATE OR REPLACE es idempotente).
    query(newMigration);

    const compare = (label: string, args: string) => {
      const original = query(`select contract_id, ratio from public.fn_traffic_anomalies_original(${args}) order by contract_id;`);
      const rewritten = query(`select contract_id, ratio from public.fn_traffic_anomalies(${args}) order by contract_id;`);
      assert.equal(rewritten, original, `${label}: la version LATERAL debe devolver EXACTAMENTE lo mismo que la original`);
      return rewritten;
    };

    // Clientes/contratos de los distintos escenarios.
    for (let n = 1; n <= 5; n++) {
      query(`insert into public.clients (id, first_name, last_name) values ('${client(n)}','Cliente','${n}');`);
      query(`insert into public.service_contracts (id, client_id, contract_number) values ('${contract(n)}','${client(n)}','CTR-000${n}');`);
    }

    const insertSample = (contractId: string, hoursAgo: number, downloadBps: number, uploadBps: number) =>
      query(`insert into public.mikrotik_traffic_samples (contract_id, device_id, run_id, sampled_at, interval_seconds, download_bps, upload_bps)
        values ('${contractId}','${device1}', gen_random_uuid(), now() - interval '${hoursAgo} hours', 600, ${downloadBps}, ${uploadBps});`);

    await test('contrato 1: ratio alto (6x) — aparece en ambas versiones, con el mismo ratio', () => {
      insertSample(contract(1), 1, 3_000_000, 0); // reciente: avg 3,000,000
      insertSample(contract(1), 72, 500_000, 0); // baseline (3 dias atras): avg 500,000
      const rows = compare('contrato 1', '2.0, 2000000');
      assert.match(rows, new RegExp(`${contract(1)}\\|6\\.00`));
    });

    await test('contrato 2: ratio insuficiente (1.5x < umbral 2.0x) — excluido en ambas versiones', () => {
      insertSample(contract(2), 1, 3_000_000, 0); // reciente: avg 3,000,000
      insertSample(contract(2), 72, 2_000_000, 0); // baseline: avg 2,000,000 -> ratio 1.5
      const rows = compare('contrato 2', '2.0, 2000000');
      assert.doesNotMatch(rows, new RegExp(contract(2)));
    });

    await test('contrato 3: consumo reciente por debajo de p_min_current_bps — excluido aunque el ratio seria altisimo', () => {
      insertSample(contract(3), 1, 1_000_000, 0); // reciente: avg 1,000,000 < minimo 2,000,000
      insertSample(contract(3), 72, 100_000, 0);
      const rows = compare('contrato 3', '2.0, 2000000');
      assert.doesNotMatch(rows, new RegExp(contract(3)));
    });

    await test('CASO FILOSO — contrato 4: trafico reciente alto pero SIN ninguna muestra de linea base (7d-24h) — excluido en ambas versiones (no se inventa un baseline)', () => {
      insertSample(contract(4), 1, 5_000_000, 0); // reciente: califica para el umbral minimo
      // sin ninguna fila en la ventana 7d-24h para este contrato.
      const rows = compare('contrato 4', '2.0, 2000000');
      assert.doesNotMatch(rows, new RegExp(contract(4)));
    });

    await test('contrato 5 + contrato 1: 2 contratos califican, el orden por ratio desc es el mismo en ambas versiones', () => {
      insertSample(contract(5), 1, 4_000_000, 0); // reciente: avg 4,000,000
      insertSample(contract(5), 72, 200_000, 0); // baseline: avg 200,000 -> ratio 20
      const originalOrder = query(`select contract_id from public.fn_traffic_anomalies_original(2.0, 2000000) order by ratio desc;`);
      const rewrittenOrder = query(`select contract_id from public.fn_traffic_anomalies(2.0, 2000000) order by ratio desc;`);
      assert.equal(rewrittenOrder, originalOrder);
      // contrato 5 (ratio 20) antes que contrato 1 (ratio 6).
      assert.equal(rewrittenOrder.split('\n')[0], contract(5));
    });
  } finally {
    try {
      docker(['stop', container]);
    } catch {
      /* Already removed after a startup failure. */
    }
  }
});
