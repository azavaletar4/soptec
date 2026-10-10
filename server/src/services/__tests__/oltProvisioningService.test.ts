import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTelnetCommands, type TelnetTarget } from '../../telnet/client';
import { withOltLock } from '../oltTelnetLock';
import {
  provisionOnt,
  runProvisioningPipeline,
  validateProvisionInput,
  findExistingBySerial,
  resolveFreeOnuId,
  collectUsedOnuIds,
  looksLikeParseFailure,
  verifyProvisionedOnt,
  classifyWriteError,
  isOltStageOk,
  isPipelineComplete,
  outcomeNeedsReconciliation,
  type ProvisionDeps,
  type ProvisionParams,
} from '../oltProvisioningService';
import { startFakeOltCli, type FakeOltCliOptions } from './fakeOltCli';
import { TEST_USERNAME, TEST_PASSWORD } from '../../telnet/__tests__/fakeOltServer';
import { parseFullRunningConfig } from '../../ssh/zteParsers';
import { configureOntInternetServiceCommands, configureWanPppoeCommands, registerOntCommands } from '../../ssh/zteCommands';

let deviceCounter = 0;
/** deviceId unico por test -- withOltLock mantiene colas por deviceId; nunca debe compartirse entre tests. */
function nextDeviceId(): string {
  deviceCounter += 1;
  return `test-device-${deviceCounter}`;
}

function makeDeps(port: number, deviceId: string, stageLog: { stage: string; status: string; detail?: string }[] = []): ProvisionDeps {
  const target: TelnetTarget = { host: '127.0.0.1', port, username: TEST_USERNAME, password: TEST_PASSWORD };
  return {
    withOltLock: <T>(fn: () => Promise<T>) => withOltLock(deviceId, fn),
    // timeout corto a proposito: todas las respuestas del simulador son casi
    // instantaneas salvo donde el propio test decide colgarlas/cerrarlas.
    runTelnet: (commands, _opts) => runTelnetCommands(target, commands, { timeoutMs: 600 }),
    onStage: (stage, status, detail) => {
      stageLog.push({ stage, status, detail });
    },
  };
}

function baseParams(overrides: Partial<ProvisionParams> = {}): ProvisionParams {
  return {
    ref: { shelf: 1, slot: 2, port: 2 },
    serial: 'HWTCABD21CB4',
    onuType: 'GPT-2741GNAC',
    vlan: 120,
    description: 'Cliente de prueba',
    tcontProfile: 'SMARTOLT-100M-UP',
    trafficProfile: 'SMARTOLT-100M-DOWN',
    ...overrides,
  };
}

async function withServer<T>(opts: FakeOltCliOptions, fn: (port: number) => Promise<T>): Promise<T> {
  const { port, close } = await startFakeOltCli(opts);
  try {
    return await fn(port);
  } finally {
    await close();
  }
}

// ---------------------------------------------------------------------------
// Pruebas puras (sin sockets)
// ---------------------------------------------------------------------------

test('validateProvisionInput: rechaza cada campo invalido con un mensaje especifico', () => {
  assert.match(validateProvisionInput(baseParams({ serial: 'ab' }))!, /serial/i);
  assert.match(validateProvisionInput(baseParams({ onuType: '' }))!, /tipo de onu/i);
  assert.match(validateProvisionInput(baseParams({ vlan: 0 }))!, /vlan/i);
  assert.match(validateProvisionInput(baseParams({ vlan: 5000 }))!, /vlan/i);
  assert.match(validateProvisionInput(baseParams({ tcontProfile: '' }))!, /perfiles/i);
  assert.match(validateProvisionInput(baseParams({ ref: { shelf: 1, slot: 99, port: 2 } }))!, /slot/i);
  assert.match(validateProvisionInput(baseParams({ forcedOnuId: 0 }))!, /id de onu/i);
  assert.match(validateProvisionInput(baseParams({ forcedOnuId: 999 }))!, /id de onu/i);
  assert.equal(validateProvisionInput(baseParams()), null, 'una solicitud valida no debe reportar error');
});

test('WAN manual: registra servicio GEM/VLAN sin enviar credenciales WAN ni tocar MikroTik', async () => {
  const p = baseParams();
  const user = 'usuario-que-no-debe-salir';
  const pass = 'clave-que-no-debe-salir';
  const registration = registerOntCommands({
    ref: p.ref, onuId: 19, serial: p.serial, onuType: p.onuType, vlan: p.vlan,
    description: p.description, tcontProfile: p.tcontProfile, trafficProfile: p.trafficProfile,
  });
  assert.ok(registration.includes('service 1 gemport 1 vlan 120'));
  assert.ok(!registration.some((line) => line.startsWith('wan-ip ')));
  assert.ok(!registration.some((line) => line.includes(user) || line.includes(pass)));

  const serviceOnly = configureOntInternetServiceCommands({ ref: p.ref, onuId: 19, vlan: 120 });
  assert.deepEqual(serviceOnly, [
    'enable', 'configure terminal', 'pon-onu-mng gpon-onu_1/2/2:19', 'service 1 gemport 1 vlan 120', 'exit',
  ]);
  const optionalWan = configureWanPppoeCommands({ ref: p.ref, onuId: 19, username: user, password: pass, vlanProfile: '120' });
  assert.ok(optionalWan.some((line) => line.includes(`username ${user} password ${pass}`)));
  assert.ok(!optionalWan.some((line) => line.startsWith('service ')));

  const commandsReceived: string[] = [];
  await withServer({ onCommand: (line) => commandsReceived.push(line) }, async (port) => {
    const result = await runProvisioningPipeline({ provision: () => provisionOnt(makeDeps(port, nextDeviceId()), p) });
    assert.equal(result.olt.kind, 'registered');
    assert.equal(result.wanOk, true);
    assert.equal(result.mikrotikOk, true);
  });
  assert.ok(commandsReceived.includes('service 1 gemport 1 vlan 120'));
  assert.ok(!commandsReceived.some((line) => line.startsWith('wan-ip ')));
  assert.ok(!commandsReceived.some((line) => line.includes(user) || line.includes(pass)));
});

test('findExistingBySerial: encuentra la posicion real o devuelve null', () => {
  const raw = [
    'interface gpon-olt_1/2/2',
    ' onu 5 type GPT-2741GNAC sn HWTCABD21CB4',
    '!',
    'interface gpon-onu_1/2/2:5',
    ' description cliente',
    ' tcont 1 profile X',
    ' gemport 1 tcont 1',
    ' gemport 1 traffic-limit downstream Y',
    ' service-port 1 vport 1 user-vlan 120 vlan 120',
    '!',
    'pon-onu-mng gpon-onu_1/2/2:5',
    ' service 1 gemport 1 vlan 120',
    '!',
  ].join('\n');
  const config = parseFullRunningConfig(raw);
  const found = findExistingBySerial(config, 'HWTCABD21CB4');
  assert.deepEqual(found && { shelf: found.shelf, slot: found.slot, port: found.port, onuId: found.onuId }, {
    shelf: 1,
    slot: 2,
    port: 2,
    onuId: 5,
  });
  assert.equal(findExistingBySerial(config, 'NOEXISTE000'), null);
});

test('resolveFreeOnuId: devuelve el primero libre, y null si esta todo ocupado', () => {
  assert.equal(resolveFreeOnuId(new Set([1, 2, 4]), 1, 5), 3);
  assert.equal(resolveFreeOnuId(new Set([1, 2, 3, 4, 5]), 1, 5), null);
});

test('verifyProvisionedOnt: sin diferencias cuando todo coincide, y reporta cada campo distinto', () => {
  const entry = { onuType: 'GPT-2741GNAC', serial: 'HWTCABD21CB4', name: null, description: null, tcontProfile: 'UP', trafficProfile: 'DOWN', vlan: 120, serviceGemport: 1, serviceVlan: 120 };
  const expected = { serial: 'HWTCABD21CB4', onuType: 'GPT-2741GNAC', vlan: 120, tcontProfile: 'UP', trafficProfile: 'DOWN', serviceGemport: 1, serviceVlan: 120 };
  assert.deepEqual(verifyProvisionedOnt(entry, expected), []);

  const mismatches = verifyProvisionedOnt({ ...entry, vlan: 999, tcontProfile: 'OTRO', serviceVlan: null }, expected);
  assert.equal(mismatches.length, 3);
  assert.ok(mismatches.some((m) => m.field === 'vlan' && m.actual === '999'));
  assert.ok(mismatches.some((m) => m.field === 'tcontProfile' && m.actual === 'OTRO'));

  assert.deepEqual(verifyProvisionedOnt(undefined, expected), [{ field: 'existencia', expected: 'registrada en la OLT', actual: null }]);
});

test('classifyWriteError: distingue un rechazo CLI real de cualquier otro fallo', () => {
  assert.equal(classifyWriteError(new Error('La OLT rechazo el comando #3/4 (verbo "tcont"): %Error 20204')), 'rejected');
  assert.equal(classifyWriteError(new Error('La conexion Telnet se cerro antes de completar los comandos')), 'uncertain');
  assert.equal(classifyWriteError(new Error('Timeout de 30000ms esperando respuesta del equipo')), 'uncertain');
  assert.equal(classifyWriteError(new Error('ECONNREFUSED')), 'uncertain');
});

// ---------------------------------------------------------------------------
// 1) Aprovisionamiento exitoso con verificacion posterior
// ---------------------------------------------------------------------------

test('escenario 1 — aprovisionamiento exitoso: registra, verifica, y reporta cada etapa', async () => {
  await withServer({}, async (port) => {
    const stages: { stage: string; status: string }[] = [];
    const outcome = await provisionOnt(makeDeps(port, nextDeviceId(), stages), baseParams());

    assert.deepEqual(outcome, { kind: 'registered', onuId: 1 });
    assert.deepEqual(
      stages.map((s) => `${s.stage}:${s.status}`),
      ['validate:ok', 'scan:started', 'scan:ok', 'resolve_id:ok', 'write:started', 'write:ok', 'verify:started', 'verify:ok'],
    );
  });
});

// ---------------------------------------------------------------------------
// 2) Comando rechazado y configuracion parcial
// ---------------------------------------------------------------------------

test('escenario 2 — comando rechazado a mitad de secuencia: reporta "rejected" y detiene el resto (configuracion parcial, nunca "exito")', async () => {
  const commandsReceived: string[] = [];
  await withServer(
    {
      onCommand: (line) => commandsReceived.push(line),
      intercept: (line) => (line.startsWith('tcont 1 profile') ? { action: 'reject', message: '%Error 20204: Ambiguous command found' } : null),
    },
    async (port) => {
      const stages: { stage: string; status: string; detail?: string }[] = [];
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId(), stages), baseParams());

      assert.equal(outcome.kind, 'rejected');
      assert.match((outcome as { message: string }).message, /rechazo el comando/);
      assert.equal((outcome as { onuId: number }).onuId, 1, 'el id intentado debe quedar en el outcome, aunque el comando se haya rechazado');
      assert.ok(outcomeNeedsReconciliation(outcome), 'un rechazo CLI no prueba que los comandos ANTERIORES no se aplicaran — sigue siendo reconciliable');
      assert.ok(stages.some((s) => s.stage === 'resolve_id' && s.detail === '1'));
      assert.ok(stages.some((s) => s.stage === 'write' && s.status === 'failed'));

      // La secuencia se detuvo justo despues del rechazo: los comandos
      // POSTERIORES (gemport/service-port/exit final) nunca se mandaron.
      assert.ok(!commandsReceived.includes('gemport 1 tcont 1'));
      assert.ok(!commandsReceived.some((c) => c.startsWith('service-port')));
    },
  );
});

// ---------------------------------------------------------------------------
// 3) Timeout o conexion perdida despues de una escritura
// ---------------------------------------------------------------------------

test('escenario 3a — la conexion se cierra ANTES de aplicar el alta: resultado "uncertain", nunca "fallo" ni "exito", con el id intentado', async () => {
  await withServer(
    { intercept: (line) => (line.startsWith('onu ') && line.includes(' sn ') ? { action: 'close' } : null) },
    async (port) => {
      const stages: { stage: string; status: string }[] = [];
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId(), stages), baseParams());

      assert.equal(outcome.kind, 'uncertain');
      assert.match((outcome as { message: string }).message, /se cerro antes de completar/);
      assert.equal((outcome as { onuId: number }).onuId, 1);
      assert.ok(stages.some((s) => s.stage === 'write' && s.status === 'uncertain'));
    },
  );
});

test('escenario 3b — timeout real de escritura (nunca responde): resultado "uncertain", con el id intentado', async () => {
  await withServer(
    { intercept: (line) => (line.startsWith('onu ') && line.includes(' sn ') ? { action: 'hang' } : null) },
    async (port) => {
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams());
      assert.equal(outcome.kind, 'uncertain');
      assert.match((outcome as { message: string }).message, /Timeout de/);
      assert.equal((outcome as { onuId: number }).onuId, 1);
    },
  );
});

test('escenario 3c — reconciliar un "uncertain" cuando la escritura SI llego a aplicarse: el reescaneo lo descubre', async () => {
  // closeAfterApply: el simulador SI registra la ONU (como pasaria si el
  // comando real llego a la OLT) pero la conexion muere antes de que la
  // confirmacion vuelva — el primer intento debe ser "uncertain".
  await withServer(
    { intercept: (line) => (line.startsWith('onu ') && line.includes(' sn ') ? { action: 'closeAfterApply' } : null) },
    async (port) => {
      const deviceId = nextDeviceId();
      const first = await provisionOnt(makeDeps(port, deviceId), baseParams());
      assert.equal(first.kind, 'uncertain');
      assert.equal((first as { onuId: number }).onuId, 1);

      // Reconciliar (= volver a llamar con los mismos datos) reescanea
      // ANTES de decidir nada — como el alta SI se aplico, esta vez la
      // encuentra en la misma posicion. Pero la escritura se corto a medio
      // camino (nunca llego a "tcont profile"/"vlan"), asi que la config
      // esta INCOMPLETA: se reporta como conflicto (misma posicion, otra
      // config), NUNCA como "already_registered" sin verificar los campos.
      const reconciled = await provisionOnt(makeDeps(port, deviceId), baseParams());
      assert.equal(reconciled.kind, 'conflict_same_position_different_config');
      assert.equal((reconciled as { onuId: number }).onuId, 1);
      const mismatches = (reconciled as { mismatches: { field: string }[] }).mismatches;
      assert.ok(mismatches.some((m) => m.field === 'tcontProfile'), 'debe detectar que el perfil tcont nunca se aplico (secuencia cortada)');
    },
  );
});

test('escenario 3d — reconciliar un "uncertain" cuando la escritura NUNCA se aplico: el reescaneo confirma que sigue libre y la completa', async () => {
  // El cierre SOLO pasa la primera vez que se manda el alta — el reintento
  // (reconcile) debe comportarse normal, como si el problema de red que
  // causo el "uncertain" ya no estuviera.
  let onuAddAttempts = 0;
  await withServer(
    {
      intercept: (line) => {
        if (!(line.startsWith('onu ') && line.includes(' sn '))) return null;
        onuAddAttempts += 1;
        return onuAddAttempts === 1 ? { action: 'close' } : null;
      },
    },
    async (port) => {
      const deviceId = nextDeviceId();
      const first = await provisionOnt(makeDeps(port, deviceId), baseParams());
      assert.equal(first.kind, 'uncertain');

      // Sin "closeAfterApply" la entrada NUNCA se creo — reconciliar debe
      // completar el alta de verdad (no quedarse atascado en "incierto").
      const reconciled = await provisionOnt(makeDeps(port, deviceId), baseParams());
      assert.equal(reconciled.kind, 'registered');
      assert.equal((reconciled as { onuId: number }).onuId, 1);
    },
  );
});

// ---------------------------------------------------------------------------
// 4) Fallo de base de datos despues de configurar la OLT
// ---------------------------------------------------------------------------

test('escenario 4 — la OLT queda bien pero la BD falla: la OLT NO se revierte, el fallo queda aislado a esa etapa', async () => {
  await withServer({}, async (port) => {
    const deviceId = nextDeviceId();
    const stageLog: { stage: string; status: string; detail?: string }[] = [];

    const result = await runProvisioningPipeline({
      provision: () => provisionOnt(makeDeps(port, deviceId), baseParams()),
      persistDb: async () => {
        throw new Error('Supabase: conexion rechazada');
      },
      onStage: (stage, status, detail) => {
        stageLog.push({ stage, status, detail });
      },
    });

    assert.equal(result.olt.kind, 'registered');
    assert.equal(result.dbOk, false);
    assert.match(result.dbError ?? '', /Supabase/);
    assert.ok(stageLog.some((s) => s.stage === 'db' && s.status === 'failed'));

    // La OLT sigue registrada pese al fallo de BD — nunca se intento un
    // "no onu" (borrado) para revertir: confirmado reconsultando la OLT.
    const recheck = await provisionOnt(makeDeps(port, deviceId), baseParams());
    assert.equal(recheck.kind, 'already_registered');
  });
});

// ---------------------------------------------------------------------------
// 5) Fallo de MikroTik despues de completar la OLT
// ---------------------------------------------------------------------------

test('escenario 5 — la OLT y la BD quedan bien pero MikroTik falla: solo esa etapa queda pendiente', async () => {
  await withServer({}, async (port) => {
    const deviceId = nextDeviceId();
    const stageLog: { stage: string; status: string; detail?: string }[] = [];

    const result = await runProvisioningPipeline({
      provision: () => provisionOnt(makeDeps(port, deviceId), baseParams()),
      persistDb: async () => {},
      syncMikrotik: async () => {
        throw new Error('RouterOS: no se pudo conectar');
      },
      onStage: (stage, status, detail) => {
        stageLog.push({ stage, status, detail });
      },
    });

    assert.equal(result.olt.kind, 'registered');
    assert.equal(result.dbOk, true);
    assert.equal(result.mikrotikOk, false);
    assert.match(result.mikrotikError ?? '', /RouterOS/);
    assert.ok(stageLog.some((s) => s.stage === 'db' && s.status === 'ok'));
    assert.ok(stageLog.some((s) => s.stage === 'mikrotik' && s.status === 'failed'));
  });
});

test('escenario 5b — OLT, BD y MikroTik quedan bien pero WAN/PPPoE falla: solo esa etapa queda pendiente, el resto no se reporta como fallido', async () => {
  await withServer({}, async (port) => {
    const deviceId = nextDeviceId();
    const stageLog: { stage: string; status: string; detail?: string }[] = [];

    const result = await runProvisioningPipeline({
      provision: () => provisionOnt(makeDeps(port, deviceId), baseParams()),
      persistDb: async () => {},
      syncMikrotik: async () => {},
      syncWan: async () => {
        throw new Error('La OLT rechazo el comando de WAN/PPPoE');
      },
      onStage: (stage, status, detail) => {
        stageLog.push({ stage, status, detail });
      },
    });

    assert.equal(result.olt.kind, 'registered');
    assert.equal(result.dbOk, true);
    assert.equal(result.mikrotikOk, true);
    assert.equal(result.wanOk, false);
    assert.match(result.wanError ?? '', /WAN\/PPPoE/);
    assert.equal(isPipelineComplete(result), false, 'no debe marcarse completo con WAN pendiente');
    assert.ok(stageLog.some((s) => s.stage === 'wan' && s.status === 'failed'));
  });
});

test('isOltStageOk: solo "registered"/"already_registered" habilitan seguir con BD/MikroTik/WAN', () => {
  assert.equal(isOltStageOk({ kind: 'registered', onuId: 1 }), true);
  assert.equal(isOltStageOk({ kind: 'already_registered', onuId: 1 }), true);
  assert.equal(isOltStageOk({ kind: 'uncertain', onuId: 1, message: 'x' }), false);
  assert.equal(isOltStageOk({ kind: 'rejected', onuId: 1, message: 'x' }), false);
  assert.equal(isOltStageOk({ kind: 'verify_uncertain', onuId: 1, message: 'x' }), false);
  assert.equal(isOltStageOk({ kind: 'capacity_full' }), false);
});

test('outcomeNeedsReconciliation: incierto/rechazado/verify_uncertain/verify_mismatch si, el resto no', () => {
  assert.equal(outcomeNeedsReconciliation({ kind: 'uncertain', onuId: 1, message: 'x' }), true);
  assert.equal(outcomeNeedsReconciliation({ kind: 'rejected', onuId: 1, message: 'x' }), true);
  assert.equal(outcomeNeedsReconciliation({ kind: 'verify_uncertain', onuId: 1, message: 'x' }), true);
  assert.equal(outcomeNeedsReconciliation({ kind: 'verify_mismatch', onuId: 1, mismatches: [] }), true);
  assert.equal(outcomeNeedsReconciliation({ kind: 'registered', onuId: 1 }), false);
  assert.equal(outcomeNeedsReconciliation({ kind: 'capacity_full' }), false);
  assert.equal(outcomeNeedsReconciliation({ kind: 'conflict_elsewhere', at: { shelf: 1, slot: 1, port: 1, onuId: 1 } }), false);
});

test('isPipelineComplete: exige OLT ok + las 3 etapas (db/mikrotik/wan, cuando se pidieron)', () => {
  assert.equal(isPipelineComplete({ olt: { kind: 'registered', onuId: 1 }, dbOk: true, mikrotikOk: true, wanOk: true }), true);
  assert.equal(isPipelineComplete({ olt: { kind: 'registered', onuId: 1 }, dbOk: false, mikrotikOk: true, wanOk: true }), false);
  assert.equal(isPipelineComplete({ olt: { kind: 'registered', onuId: 1 }, dbOk: true, mikrotikOk: true, wanOk: false }), false);
  assert.equal(isPipelineComplete({ olt: { kind: 'uncertain', onuId: 1, message: 'x' }, dbOk: true, mikrotikOk: true, wanOk: true }), false);
});

// ---------------------------------------------------------------------------
// 6) Reintento y doble solicitud sin duplicados
// ---------------------------------------------------------------------------

test('escenario 6a — doble solicitud CONCURRENTE (doble clic): un solo comando de alta real llega a la OLT', async () => {
  const commandsReceived: string[] = [];
  await withServer({ onCommand: (l) => commandsReceived.push(l) }, async (port) => {
    const deviceId = nextDeviceId();
    const deps1 = makeDeps(port, deviceId);
    const deps2 = makeDeps(port, deviceId);

    const [r1, r2] = await Promise.all([provisionOnt(deps1, baseParams()), provisionOnt(deps2, baseParams())]);

    const kinds = [r1.kind, r2.kind].sort();
    assert.deepEqual(kinds, ['already_registered', 'registered']);
    const onuIds = new Set([(r1 as { onuId: number }).onuId, (r2 as { onuId: number }).onuId]);
    assert.equal(onuIds.size, 1, 'ambas respuestas deben referirse a LA MISMA onu-id, nunca a dos distintas');

    const altas = commandsReceived.filter((l) => l.startsWith('onu ') && l.includes(' sn '));
    assert.equal(altas.length, 1, 'el comando real de alta solo debio mandarse una vez, pese a las dos solicitudes concurrentes');
  });
});

test('escenario 6b — reintento SECUENCIAL (ej. el cliente reintenta tras creer que fallo): no duplica el alta', async () => {
  const commandsReceived: string[] = [];
  await withServer({ onCommand: (l) => commandsReceived.push(l) }, async (port) => {
    const deviceId = nextDeviceId();
    const first = await provisionOnt(makeDeps(port, deviceId), baseParams());
    const second = await provisionOnt(makeDeps(port, deviceId), baseParams());

    assert.equal(first.kind, 'registered');
    assert.equal(second.kind, 'already_registered');
    assert.equal((first as { onuId: number }).onuId, (second as { onuId: number }).onuId);

    const altas = commandsReceived.filter((l) => l.startsWith('onu ') && l.includes(' sn '));
    assert.equal(altas.length, 1, 'el comando real de alta solo debio mandarse una vez');
  });
});

// ---------------------------------------------------------------------------
// 7) Serial ya registrado e ID ocupado
// ---------------------------------------------------------------------------

test('escenario 7a — el serial ya esta registrado en OTRA posicion: conflicto, no se toca nada', async () => {
  const commandsReceived: string[] = [];
  await withServer(
    {
      initialEntries: {
        '1/2/5:3': { onuType: 'GPT-2741GNAC', serial: 'HWTCABD21CB4', description: 'ya existente en otro puerto' },
      },
      onCommand: (l) => commandsReceived.push(l),
    },
    async (port) => {
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams()); // pide registrar en 1/2/2
      assert.deepEqual(outcome, { kind: 'conflict_elsewhere', at: { shelf: 1, slot: 2, port: 5, onuId: 3 } });
      assert.ok(!commandsReceived.some((c) => c.startsWith('onu ') && c.includes(' sn ')), 'no debio escribirse nada');
    },
  );
});

test('escenario 7b — el onu-id forzado ya esta ocupado por OTRO serial en esa posicion: conflicto, no se sobreescribe', async () => {
  await withServer(
    { initialEntries: { '1/2/2:1': { onuType: 'GPT-2741GNAC', serial: 'OTROSERIAL99', description: '' } } },
    async (port) => {
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams({ forcedOnuId: 1 }));
      assert.deepEqual(outcome, { kind: 'conflict_elsewhere', at: { shelf: 1, slot: 2, port: 2, onuId: 1 } });
    },
  );
});

test('escenario 7c — capacidad llena (todos los onu-id del puerto ocupados): se reporta, no se intenta escribir', async () => {
  const initialEntries: Record<string, { onuType: string; serial: string; description: string }> = {};
  for (let id = 1; id <= 127; id += 1) {
    initialEntries[`1/2/2:${id}`] = { onuType: 'GPT-2741GNAC', serial: `SERIAL${String(id).padStart(6, '0')}`, description: '' };
  }
  const commandsReceived: string[] = [];
  await withServer({ initialEntries, onCommand: (l) => commandsReceived.push(l) }, async (port) => {
    const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams({ serial: 'NUEVOSERIAL1' }));
    assert.deepEqual(outcome, { kind: 'capacity_full' });
    assert.ok(!commandsReceived.some((c) => c.startsWith('onu ') && c.includes('NUEVOSERIAL1')));
  });
});

// ---------------------------------------------------------------------------
// 8) Lectura posterior que no coincide con lo solicitado
// ---------------------------------------------------------------------------

test('escenario 8 — la OLT escribe algo distinto de lo pedido: la verificacion posterior lo detecta, NUNCA se reporta exito', async () => {
  await withServer({ renderOverride: { vlan: 999, trafficProfile: 'OTRO-PERFIL' } }, async (port) => {
    const stages: { stage: string; status: string; detail?: string }[] = [];
    const outcome = await provisionOnt(makeDeps(port, nextDeviceId(), stages), baseParams());

    assert.equal(outcome.kind, 'verify_mismatch');
    const mismatches = (outcome as { mismatches: { field: string }[] }).mismatches;
    assert.ok(mismatches.some((m) => m.field === 'vlan'));
    assert.ok(mismatches.some((m) => m.field === 'trafficProfile'));
    const verifyFailedStage = stages.find((s) => s.stage === 'verify' && s.status === 'failed');
    assert.ok(verifyFailedStage, 'debe quedar registrada la etapa de verificacion fallida');
    assert.match(verifyFailedStage!.detail ?? '', /vlan/);
  });
});

test('escenario 8b — la RELECTURA de verificacion se cae (timeout/cierre): "verify_uncertain", no "fallo" ni "exito"', async () => {
  // "show running-config" se manda DOS veces en una operacion normal (el
  // escaneo previo, y la relectura de verificacion) — el problema debe
  // afectar SOLO la segunda (la de verificacion), no la primera (si afectara
  // a ambas, el escaneo previo mismo fallaria sin llegar siquiera a escribir).
  let fullConfigReads = 0;
  await withServer(
    {
      intercept: (line) => {
        if (line !== 'show running-config') return null;
        fullConfigReads += 1;
        return fullConfigReads === 2 ? { action: 'hang' } : null;
      },
    },
    async (port) => {
      const stages: { stage: string; status: string }[] = [];
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId(), stages), baseParams());
      assert.equal(outcome.kind, 'verify_uncertain');
      assert.equal((outcome as { onuId: number }).onuId, 1);
      assert.match((outcome as { message: string }).message, /Timeout de/);
      assert.ok(stages.some((s) => s.stage === 'verify' && s.status === 'uncertain'));
    },
  );
});

// ---------------------------------------------------------------------------
// Punto 6 (revision externa) — el simulador debe reflejar salidas
// VERIFICADAS y rechazar cualquier comando que no haya confirmado contra el
// equipo real, en vez de simular un exito silencioso.
// ---------------------------------------------------------------------------

test('el simulador RECHAZA un comando no confirmado (ej. "show running-config interface gpon-olt_...") en vez de simular un exito', async () => {
  await withServer({}, async (port) => {
    const target: TelnetTarget = { host: '127.0.0.1', port, username: TEST_USERNAME, password: TEST_PASSWORD };
    await assert.rejects(
      runTelnetCommands(target, ['enable', 'show running-config interface gpon-olt_1/2/2'], { timeoutMs: 2000 }),
      /rechazo el comando/,
      'el simulador debe rechazarlo como lo haria una CLI real con un comando no reconocido, no responder como si hubiera funcionado',
    );
  });
});

test('provisionOnt NUNCA usa portRunningConfigCommand (no confirmado) para verificar — usa el dump completo ya confirmado', async () => {
  // Si provisionOnt llegara a usar el comando acotado por puerto, este test
  // fallaria (el simulador lo rechaza, ver prueba de arriba) y el
  // aprovisionamiento normal (escenario 1) jamas podria dar "registered".
  // Esta prueba deja la intencion explicita, no solo implicita.
  await withServer({}, async (port) => {
    const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams());
    assert.equal(outcome.kind, 'registered', 'si esto falla, probablemente provisionOnt volvio a depender del comando no confirmado');
  });
});

// ---------------------------------------------------------------------------
// Punto 7 (revision externa) — proteger la eleccion de ID frente a escaneos
// vacios/incompletos/no reconocidos; combinar config+estado.
// ---------------------------------------------------------------------------

test('looksLikeParseFailure: distingue "no hay nada" de "no se pudo interpretar"', () => {
  assert.equal(looksLikeParseFailure('', 0), false, 'una respuesta realmente vacia no es un fallo de parsing, es un equipo sin nada');
  assert.equal(looksLikeParseFailure('ZXAN#', 0), false, 'solo el prompt tambien es un "no hay nada" normal');
  assert.equal(
    looksLikeParseFailure('Algo con contenido real que no matcheo ningun patron conocido del parser'.padEnd(50, '.'), 0),
    true,
    'contenido sustancial sin NINGUNA fila interpretada es sospechoso',
  );
  assert.equal(looksLikeParseFailure('cualquier cosa larga', 3), false, 'si se parseo algo, no es un fallo de parsing');
});

test('collectUsedOnuIds: combina el escaneo de ESTADO y el de CONFIGURACION para el shelf/slot/port correcto', () => {
  const globalOnts = [
    { slot: 2, port: 2, onuId: 1 },
    { slot: 2, port: 9, onuId: 1 }, // otro puerto — no debe contar
  ];
  const configRaw = ['interface gpon-olt_1/2/2', ' onu 5 type X sn Y', '!'].join('\n');
  const fullConfig = parseFullRunningConfig(configRaw);
  const used = collectUsedOnuIds(globalOnts, fullConfig, { shelf: 1, slot: 2, port: 2 });
  assert.deepEqual([...used].sort(), [1, 5], 'debe incluir el id 1 (visto por estado) Y el 5 (visto solo por configuracion)');
});

test('escenario 7d — una ONU que el escaneo de ESTADO no reporta (pero SI la configuracion) nunca se pisa al elegir id libre', async () => {
  await withServer(
    {
      initialEntries: { '1/2/2:1': { onuType: 'GPT-2741GNAC', serial: 'EXISTENTE0001', description: '' } },
      // El escaneo de estado "no ve" la onu-id 1 en este puerto (simula que
      // esta offline en este momento) — solo el running-config la reporta.
      omitFromStateScan: ['1/2/2:1'],
    },
    async (port) => {
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams({ serial: 'NUEVOSERIAL2' }));
      assert.equal(outcome.kind, 'registered');
      assert.equal(
        (outcome as { onuId: number }).onuId,
        2,
        'debe elegir el id 2 (no repetir el 1, que el escaneo de ESTADO no mostraba pero el de CONFIGURACION si)',
      );
    },
  );
});

test('escenario 7e — el escaneo de estado vuelve con un formato totalmente inesperado: "scan_unreliable", nunca se elige un id ni se escribe nada', async () => {
  const commandsReceived: string[] = [];
  await withServer(
    {
      onCommand: (l) => commandsReceived.push(l),
      intercept: (line) =>
        line === 'show gpon onu state'
          ? { action: 'customResponse', text: 'TOTALMENTE OTRO FORMATO DE RESPUESTA QUE EL PARSER NO RECONOCE EN ABSOLUTO, no una tabla vacia real' }
          : null,
    },
    async (port) => {
      const outcome = await provisionOnt(makeDeps(port, nextDeviceId()), baseParams());
      assert.equal(outcome.kind, 'scan_unreliable');
      assert.ok(!commandsReceived.some((c) => c.startsWith('onu ') && c.includes(' sn ')), 'no debio intentar escribir nada sin confiar en el escaneo');
    },
  );
});
