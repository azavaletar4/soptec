import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOltTelemetry, evaluateOntEvidence, OntTelemetryEvidence, rememberOntEvidence, type OntIdentity } from '../oltTelemetry';
import { persistOntMeasurement } from '../oltTelemetryPersistence';
import { enforceOntEvidence } from '../../../../src/lib/ontTelemetryEvidence';

const old = 'MSTC8CCE647E', replacement = 'HWTCE5C94DB6', janet = 'HWTCDEB847B6';
const row = (serial = old, id = 'old', onu = 3) => ({ id, olt_device_id: 'olt', serial, frame: 1, slot: 2, port: 8, ont_id: onu, status: 'online' as const, admin_state: 'enable', rx_power: -19.67, tx_power: 2.32, last_synced_at: '2026-10-20T20:31:31Z', client_id: 'client', contract_id: 'contract' });
function config(entries: [string, number][] = [[old, 3]]) {
  return 'interface gpon-olt_1/2/8\n' + entries.map(([s, n]) => ` onu ${n} type GPT sn ${s}`).join('\n') + '\n!\nend\n';
}
async function scan(options: { before?: [string, number][]; after?: [string, number][]; fail?: string; state?: string; signal?: boolean; missingPower?: boolean; duplicateState?: boolean } = {}) {
  const commands: string[] = []; let configReads = 0;
  const result = await collectOltTelemetry(async cmds => {
    assert(cmds.every(c => c === 'enable' || c.startsWith('show '))); const command = cmds.at(-1)!; commands.push(command);
    if (options.fail && command.includes(options.fail)) throw Error('synthetic read failure');
    if (command === 'show running-config') return ['enable', config(configReads++ ? options.after ?? options.before : options.before)];
    if (command === 'show gpon onu state') return ['enable', 'OnuIndex AdminState OMCC RunState Type\n' + (options.before ?? [[old, 3]]).map(([, n]) => `1/2/8:${n} enable enable ${options.state ?? 'working'} 1(GPON)`).join('\n') + (options.duplicateState ? '\n1/2/8:3 enable enable working 1(GPON)' : '') + '\nONU Number: 1/1'];
    return ['enable', options.missingPower ? 'N/A' : `gpon-onu_1/2/8:3    ${command.includes('onu-rx') ? '-19.7' : '2.2'}(dbm)\ngpon-onu_1/2/8:50   -23.98(dbm)`];
  }, { includeSignal: options.signal ?? true });
  return { result, commands };
}
test('mismo serial y posición: estado y potencia solo tras las dos comprobaciones de identidad', async () => {
  const { result, commands } = await scan(); const e = evaluateOntEvidence(row(), result);
  assert.equal(e.outcome, 'valid'); assert.equal(e.status, 'online'); assert.equal(e.rxPower, -19.7); assert.equal(e.txPower, 2.2);
  assert.equal(commands[0], 'show running-config'); assert.equal(commands.at(-1), 'show running-config');
});
test('serial trasladado: no mueve posición ni vínculos y no toma mediciones de la posición vieja', async () => {
  const stored = row(); const original = structuredClone(stored); const { result } = await scan({ before: [[old, 50]] });
  const e = evaluateOntEvidence(stored, result); assert.equal(e.outcome, 'moved'); assert.equal(e.observedPosition, '1/2/8:50'); assert.equal(e.status, 'unknown'); assert.equal(e.rxPower, null); assert.deepEqual(stored, original);
});
test('caso Janet/Estiven: posición reutilizada, nueva ONT protegida y Huawei de Janet sin cambios', async () => {
  const { result } = await scan({ before: [[replacement, 3], [janet, 50]] });
  const previous = evaluateOntEvidence(row(), result), current = evaluateOntEvidence(row(replacement, 'new'), result), huawei = evaluateOntEvidence(row(janet, 'janet', 50), result);
  assert.equal(previous.outcome, 'conflict'); assert.equal(previous.observedSerial, replacement); assert.equal(previous.status, 'unknown'); assert.equal(previous.rxPower, null);
  assert.equal(current.outcome, 'valid'); assert.equal(current.rxPower, -19.7); assert.equal(huawei.outcome, 'valid'); assert.equal(huawei.rxPower, -23.98);
});
test('ONT antigua ausente: ausencia confirmada del inventario no se convierte en desconexión física', async () => {
  const { result } = await scan({ before: [[janet, 50]] }); const e = evaluateOntEvidence(row(), result);
  assert.equal(e.outcome, 'absent'); assert.equal(e.status, 'unknown'); assert.equal(e.adminState, undefined); assert.equal(e.rxPower, null);
});
test('consulta de configuración fallida o estado fallido: nunca offline confirmado ni datos históricos actuales', async () => {
  for (const fail of ['running-config', 'onu state']) { const { result } = await scan({ fail }); const e = evaluateOntEvidence(row(), result); assert.equal(e.outcome, 'failed'); assert.equal(e.status, 'unknown'); assert.equal(e.rxPower, null); }
});
test('lectura de potencia fallida/incompleta: estado verificado separado, potencia anterior solo histórica', async () => {
  for (const options of [{ fail: 'onu-tx' }, { missingPower: true }, { signal: false }]) {
    const { result } = await scan(options); const e = evaluateOntEvidence(row(), result); assert.equal(e.status, 'online'); assert.equal(e.rxPower, null); assert.notEqual(e.signalOutcome, 'valid');
  }
});
test('cambio durante la lectura o serial duplicado: no atribuir una observación ambigua', async () => {
  for (const options of [{ after: [[replacement, 3]] as [string, number][] }, { before: [[old, 3], [old, 50]] as [string, number][] }, { duplicateState: true }]) {
    const { result } = await scan(options); const e = evaluateOntEvidence(row(), result); assert.equal(e.status, 'unknown'); assert.equal(e.rxPower, null);
  }
});
test('estado working requiere evidencia; offline observado conserva identidad; estado no reconocido queda sin confirmar', async () => {
  assert.equal(evaluateOntEvidence(row(), (await scan({ state: 'OffLine' })).result).status, 'offline');
  assert.equal(evaluateOntEvidence(row(), (await scan({ state: 'mystery' })).result).status, 'unknown');
});
test('dos ONT en misma posición en momentos diferentes: evidencia aislada por id, serial, posición y caducidad', async () => {
  let now = Date.now(); const cache = new OntTelemetryEvidence(() => now), stored = row();
  assert.equal(cache.project(stored).status, 'unknown');
  const evidence = evaluateOntEvidence(stored, (await scan()).result); cache.remember(stored, evidence);
  assert.equal(cache.project(stored).status, 'online'); assert.equal(cache.project({ ...stored, serial: replacement }).status, 'unknown');
  assert.equal(cache.project({ ...stored, ont_id: 50 }).status, 'unknown'); assert.equal(cache.project(row(replacement, 'new')).status, 'unknown');
  assert.equal(cache.project({ ...stored, olt_device_id: 'another-olt' }).status, 'unknown');
  const rejected = evaluateOntEvidence(stored, (await scan({ before: [[replacement, 3]] })).result); cache.remember(stored, rejected);
  const projection = cache.project(stored); assert.equal(projection.status, 'unknown'); assert.equal(projection.rx_power, null); assert.equal(projection.client_id, 'client'); assert.deepEqual(projection.telemetry.historical, { status: 'online', rxPower: -19.67, txPower: 2.32, at: stored.last_synced_at });
  cache.remember(stored, evidence); now = Date.parse(evidence.validUntil) + 1; assert.equal(cache.project(stored).status, 'unknown');
  assert.equal(enforceOntEvidence({ ...stored, telemetry: { ...evidence, signalOutcome: 'valid' } }, now).status, 'unknown');
  assert.equal(new OntTelemetryEvidence().project(stored).status, 'unknown');
});
test('configuración final fallida o respuesta vacía: las mediciones recogidas no se publican', async () => {
  let count = 0;
  const result = await collectOltTelemetry(async commands => {
    const command = commands.at(-1)!;
    if (command === 'show running-config') { if (count++) throw Error('closing identity check failed'); return ['', config()]; }
    if (command === 'show gpon onu state') return ['', 'OnuIndex\n1/2/8:3 enable enable working 1(GPON)\nONU Number: 1/1'];
    return ['', 'gpon-onu_1/2/8:3    -20(dbm)'];
  }, { includeSignal: true });
  assert.equal(evaluateOntEvidence(row(), result).status, 'unknown');
  const empty = await collectOltTelemetry(async () => ['', ''], { includeSignal: true });
  assert.equal(evaluateOntEvidence(row(), empty).outcome, 'failed');
});
test('persistencia condicionada por id, OLT, serial y posición: conserva nueva ONT y vínculos ante reemplazo concurrente', async () => {
  const stored = { ...row(replacement), retired_at: null }; const unchanged = structuredClone(stored); const predicates = new Map<string, unknown>(); let writes = 0;
  const fake = { from: () => ({ update: (patch: object) => { const q = { is: (k: string, v: unknown) => { predicates.set(k, v); return q; }, eq: (k: string, v: unknown) => { predicates.set(k, v); return q; }, select: () => q, maybeSingle: async () => {
    if ([...predicates].every(([k, v]) => (stored as unknown as Record<string, unknown>)[k] === v)) { writes++; return { data: { ...stored, ...patch }, error: null }; } return { data: null, error: null };
  } }; return q; } }) };
  await assert.rejects(persistOntMeasurement(row(), { status: 'online', rx_power: -10, last_synced_at: new Date().toISOString() }, fake as never), /identidad o posición cambió/);
  assert.equal(writes, 0); assert.deepEqual(stored, unchanged); assert.deepEqual([...predicates.keys()], ['retired_at','id','olt_device_id','serial','frame','slot','port','ont_id']);
});
test('registro de discrepancia: dos seriales y posición, sin cliente, contrato, nombre o credenciales', async () => {
  const captured: string[] = [], original = console.warn; console.warn = (...args: unknown[]) => captured.push(args.join(' '));
  try { const stored = row(); rememberOntEvidence(stored, evaluateOntEvidence(stored, (await scan({ before: [[replacement, 3]] })).result)); }
  finally { console.warn = original; }
  const output = captured.join('\n'); assert(output.includes(old)); assert(output.includes(replacement)); assert(output.includes('1/2/8:3')); assert(!/client_id|contract_id|password|username|Janet|Estiven/.test(output));
});
