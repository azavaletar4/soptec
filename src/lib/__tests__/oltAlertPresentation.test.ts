import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeruDateTime, buildOltAlertView, ALERT_KIND_LABEL, type OltAlertOntInfo, type OltAlertSource } from '../oltAlertPresentation';

// ---- formatPeruDateTime ----

test('formatPeruDateTime: ISO real -> fecha/hora en horario de Peru, no la del dispositivo', () => {
  // 2026-10-14T13:31:00Z = 2026-10-14 08:31 America/Lima (UTC-5, sin horario de verano)
  const out = formatPeruDateTime('2026-10-14T13:31:00.000Z');
  assert.match(out, /14\/10\/2026/);
  assert.match(out, /08:31/);
});

test('formatPeruDateTime: ISO invalido -> mensaje claro, nunca inventa una fecha', () => {
  assert.equal(formatPeruDateTime('no-es-fecha'), 'Fecha no disponible');
});

// ---- buildOltAlertView ----

function alertSource(overrides: Partial<OltAlertSource> = {}): OltAlertSource {
  return { id: 'a1', ontDbId: 'ont-1', kind: 'offline', message: 'ONT slot 2/puerto 1/onu-id 5 se desconectó', at: '2026-10-14T13:31:00.000Z', ...overrides };
}

function ont(overrides: Partial<OltAlertOntInfo> = {}): OltAlertOntInfo {
  return { id: 'ont-1', serial: 'ZTEG0001', description: null, slot: 2, port: 1, ont_id: 5, client_id: null, ...overrides };
}

test('buildOltAlertView: ONT vinculada (client_id + contract_id + contrato resuelto) -> linked, con cliente/contrato/zona del CONTRATO', () => {
  const o = ont({
    client_id: 'cli-1',
    contract_id: 'ctr-1',
    clients: { id: 'cli-1', first_name: 'Violeta', last_name: 'Garcia Silva' },
    zones: { id: 'z-ont', name: 'PON 1 - AO (vieja)' },
    service_contracts: { id: 'ctr-1', contract_number: 'C-001', client_code: 'CL-001', zones: { id: 'z-ctr', name: 'PON 1 - AO' } },
  });
  const v = buildOltAlertView(alertSource(), o, 1);
  assert.equal(v.linked, true);
  assert.deepEqual(v.client, { id: 'cli-1', name: 'Violeta Garcia Silva' });
  assert.deepEqual(v.contract, { id: 'ctr-1', contractNumber: 'C-001', clientCode: 'CL-001' });
  // la zona del CONTRATO gana sobre la de la propia ONT (misma lógica que Fase B).
  assert.equal(v.zoneName, 'PON 1 - AO');
  assert.equal(v.kindLabel, 'Internet desconectado');
  assert.equal(v.severity, 'critical');
  assert.equal(v.ponNumber, 1);
});

test('buildOltAlertView: ONT sin client_id/contract_id (migracion SmartOLT) -> NUNCA infiere cliente, aunque la ONT tenga description con un nombre', () => {
  const o = ont({ description: 'Juan Perez - Jr. Lima 123', client_id: null, contract_id: null });
  const v = buildOltAlertView(alertSource({ kind: 'recovered' }), o, 1);
  assert.equal(v.linked, false);
  assert.equal(v.client, null);
  assert.equal(v.contract, null);
  assert.equal(v.description, 'Juan Perez - Jr. Lima 123'); // se MUESTRA, nunca se usa para inferir
  assert.equal(v.kindLabel, 'Internet reconectado');
  assert.equal(v.severity, 'ok');
});

test('buildOltAlertView: contract_id presente pero client_id null (dato inconsistente) -> sigue sin vincular, nunca expone medio vinculo', () => {
  const o = ont({
    client_id: null,
    contract_id: 'ctr-2',
    service_contracts: { id: 'ctr-2', contract_number: 'C-002', client_code: 'CL-002', zones: { id: 'z', name: 'PON 2 - SM' } },
  });
  const v = buildOltAlertView(alertSource(), o, 2);
  assert.equal(v.linked, false);
  assert.equal(v.client, null);
  assert.equal(v.contract, null);
});

test('buildOltAlertView: cliente con multiples servicios -> usa el contrato de ESTA ont (contract_id exacto), nunca "cualquiera" del cliente', () => {
  const oServicioA = ont({
    id: 'ont-a',
    client_id: 'cli-multi',
    contract_id: 'ctr-a',
    clients: { id: 'cli-multi', first_name: 'Cliente', last_name: 'MultiServicio' },
    service_contracts: { id: 'ctr-a', contract_number: 'C-A', client_code: 'CL-A', zones: { id: 'z-a', name: 'PON 1 - AO' } },
  });
  const v = buildOltAlertView(alertSource({ ontDbId: 'ont-a' }), oServicioA, 1);
  assert.equal(v.contract?.id, 'ctr-a');
  assert.equal(v.contract?.contractNumber, 'C-A');
  assert.equal(v.zoneName, 'PON 1 - AO');
});

test('buildOltAlertView: ONT no encontrada en el panel (ont = null) -> no revienta, todo lo fisico queda null y nunca vinculado', () => {
  const v = buildOltAlertView(alertSource(), null, null);
  assert.equal(v.linked, false);
  assert.equal(v.client, null);
  assert.equal(v.serial, null);
  assert.equal(v.slot, null);
  assert.equal(v.ponNumber, null);
  assert.equal(v.technicalMessage, alertSource().message);
});

test('buildOltAlertView: ONT vinculada pero sin ninguna zona registrada (ni en contrato ni en la propia ONT) -> zoneName null, no inventa', () => {
  const o = ont({
    client_id: 'cli-3',
    contract_id: 'ctr-3',
    clients: { id: 'cli-3', first_name: 'Cliente', last_name: 'SinZona' },
    service_contracts: { id: 'ctr-3', contract_number: 'C-003', client_code: 'CL-003' },
  });
  const v = buildOltAlertView(alertSource(), o, 1);
  assert.equal(v.zoneName, null);
});

test('buildOltAlertView: señal óptica baja/recuperada mantienen su propia etiqueta y severidad, no se confunden con desconexión', () => {
  const low = buildOltAlertView(alertSource({ kind: 'lowSignal' }), null, null);
  const recov = buildOltAlertView(alertSource({ kind: 'signalRecovered' }), null, null);
  assert.equal(low.kindLabel, ALERT_KIND_LABEL.lowSignal);
  assert.equal(low.severity, 'critical');
  assert.equal(recov.kindLabel, ALERT_KIND_LABEL.signalRecovered);
  assert.equal(recov.severity, 'ok');
});
