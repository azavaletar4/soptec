import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMaterialCustodyShortfalls,
  linkMaterialCorrections,
  classifyShortfallRecency,
  MATERIAL_CUSTODY_DETECTION_LIVE_SINCE,
  type MaterialCustodyEventInput,
  type MaterialConsumptionMovementInput,
} from '../materialCustodyShortfall';

const TECH = 'tech-1';
const PRODUCT = 'product-1';

function movement(partial: Partial<MaterialConsumptionMovementInput> & { id: string }): MaterialConsumptionMovementInput {
  return {
    technicianId: TECH,
    productId: PRODUCT,
    movementType: 'egreso',
    quantity: 1,
    createdAt: '2026-10-18T20:00:00.000Z',
    jobType: 'installation',
    jobId: 'job-1',
    reversesMovementId: null,
    reason: null,
    ...partial,
  };
}

// ---- Caso real confirmado: Jadir Zavaleta, 18/10/2026 — cero entregas de material, consumo igual se registro ----

test('detectMaterialCustodyShortfalls: sin ninguna entrega previa -> todo el consumo es deficit', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', quantity: 1 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 0);
  assert.equal(found[0].shortfall, 1);
  assert.equal(found[0].technicianId, TECH);
  assert.equal(found[0].productId, PRODUCT);
  assert.equal(found[0].jobType, 'installation');
  assert.equal(found[0].jobId, 'job-1');
});

test('detectMaterialCustodyShortfalls: expone el motivo real del Kardex, nunca inventa uno', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', reason: 'Kit base de Alta desde Campo' })]);
  assert.equal(found[0].reason, 'Kit base de Alta desde Campo');
  const sinMotivo = detectMaterialCustodyShortfalls([], [movement({ id: 'm2', reason: null })]);
  assert.equal(sinMotivo[0].reason, null);
});

test('detectMaterialCustodyShortfalls: con entrega suficiente antes del consumo -> no hay hallazgo', () => {
  const delivery: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-18T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([delivery], [movement({ id: 'm1', quantity: 2 })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: entrega parcial -> deficit es exactamente lo que falta', () => {
  const delivery: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 1, createdAt: '2026-10-18T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([delivery], [movement({ id: 'm1', quantity: 4 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 1);
  assert.equal(found[0].shortfall, 3);
});

test('detectMaterialCustodyShortfalls: la entrega llega DESPUES del consumo -> igual queda marcado (orden cronologico real)', () => {
  const deliveryAfter: MaterialCustodyEventInput = { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-19T10:00:00.000Z' };
  const found = detectMaterialCustodyShortfalls([deliveryAfter], [movement({ id: 'm1', quantity: 2, createdAt: '2026-10-18T20:00:00.000Z' })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 0);
});

test('detectMaterialCustodyShortfalls: devolucion reduce el saldo simulado antes del consumo', () => {
  const events: MaterialCustodyEventInput[] = [
    { technicianId: TECH, productId: PRODUCT, eventType: 'delivery', quantity: 5, createdAt: '2026-10-18T09:00:00.000Z' },
    { technicianId: TECH, productId: PRODUCT, eventType: 'return', quantity: 4, createdAt: '2026-10-18T10:00:00.000Z' },
  ];
  const found = detectMaterialCustodyShortfalls(events, [movement({ id: 'm1', quantity: 2 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].availableBefore, 1);
  assert.equal(found[0].shortfall, 1);
});

test('detectMaterialCustodyShortfalls: una reversion (ingreso que corrige un egreso) repone el saldo para el siguiente consumo', () => {
  const movements: MaterialConsumptionMovementInput[] = [
    movement({ id: 'm1', quantity: 2, createdAt: '2026-10-18T10:00:00.000Z' }),
    movement({ id: 'm2', movementType: 'ingreso', quantity: 2, reversesMovementId: 'm1', createdAt: '2026-10-18T10:05:00.000Z' }),
    movement({ id: 'm3', quantity: 2, createdAt: '2026-10-18T10:10:00.000Z' }),
  ];
  const found = detectMaterialCustodyShortfalls([], movements);
  // Ninguno tuvo entrega. La reversion NO puede inventar 2 de custodia.
  assert.equal(found.length, 2);
  assert.equal(found[0].movementId, 'm3');
  assert.equal(found[1].movementId, 'm1');
});

test('detectMaterialCustodyShortfalls: consumo sin tecnico atribuible (edicion administrativa directa) se ignora', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', technicianId: null })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: consumo sin orden (jobType/jobId null) se ignora', () => {
  const found = detectMaterialCustodyShortfalls([], [movement({ id: 'm1', jobType: null, jobId: null })]);
  assert.deepEqual(found, []);
});

test('detectMaterialCustodyShortfalls: tecnicos y productos distintos no se mezclan', () => {
  const events: MaterialCustodyEventInput[] = [
    { technicianId: 'tech-2', productId: PRODUCT, eventType: 'delivery', quantity: 10, createdAt: '2026-10-18T09:00:00.000Z' },
  ];
  const found = detectMaterialCustodyShortfalls(events, [movement({ id: 'm1', technicianId: TECH, quantity: 1 })]);
  assert.equal(found.length, 1); // la entrega de tech-2 no cubre a TECH
});

test('detectMaterialCustodyShortfalls: el saldo nunca queda negativo para el siguiente consumo (no infla el deficit)', () => {
  const found = detectMaterialCustodyShortfalls([], [
    movement({ id: 'm1', quantity: 5, createdAt: '2026-10-18T10:00:00.000Z' }),
    movement({ id: 'm2', quantity: 1, createdAt: '2026-10-18T11:00:00.000Z' }),
  ]);
  assert.equal(found.length, 2);
  assert.equal(found[0].movementId, 'm2'); // orden: mas reciente primero
  assert.equal(found[0].availableBefore, 0); // no -5
  assert.equal(found[1].movementId, 'm1');
  assert.equal(found[1].availableBefore, 0);
});

for (const jobType of ['installation','ticket','routine'] as const) {
  test(`${jobType}: correcciones sucesivas por admin y cuadrilla mantienen responsable verificable`, () => {
    const events: MaterialCustodyEventInput[]=[{technicianId:TECH,productId:PRODUCT,eventType:'delivery',quantity:50,createdAt:'2026-10-18T09:00:00Z'}];
    const rows=[
      movement({id:'m1',jobType,quantity:20}),
      movement({id:'r1',jobType,technicianId:'admin',quantity:20,movementType:'ingreso',reversesMovementId:'m1'}),
      movement({id:'m2',jobType,technicianId:'admin',quantity:40,correctsMovementId:'m1'}),
      movement({id:'r2',jobType,technicianId:'support',quantity:40,movementType:'ingreso',reversesMovementId:'m2'}),
      movement({id:'m3',jobType,technicianId:'support',quantity:45,correctsMovementId:'m2'}),
    ];
    assert.deepEqual(detectMaterialCustodyShortfalls(events, rows.reverse()),[]); // mismo timestamp, orden de BD no garantizado
    const deficit=detectMaterialCustodyShortfalls(events,rows.map(m=>m.id==='m3'?{...m,quantity:55}:m));
    assert.equal(deficit.length,1);assert.equal(deficit[0].technicianId,TECH);assert.equal(deficit[0].shortfall,5);
  });
}

test('eventos rastreados resuelven responsable sin contar consumo y reversion por duplicado', () => {
  const events: MaterialCustodyEventInput[]=[
    {technicianId:TECH,productId:PRODUCT,eventType:'delivery',quantity:50,createdAt:'2026-10-18T09:00:00Z'},
    {technicianId:TECH,productId:PRODUCT,eventType:'consumption',quantity:20,sourceMovementId:'m1',createdAt:'2026-10-18T10:00:00Z'},
    {technicianId:TECH,productId:PRODUCT,eventType:'consumption_reversal',quantity:20,sourceMovementId:'m1',createdAt:'2026-10-18T11:00:00Z'},
    {technicianId:TECH,productId:PRODUCT,eventType:'consumption',quantity:40,sourceMovementId:'m2',createdAt:'2026-10-18T11:00:00Z'},
  ];
  const rows=[movement({id:'m1',quantity:20,createdAt:'2026-10-18T10:00:00Z'}),
    movement({id:'r',quantity:20,technicianId:'admin',movementType:'ingreso',reversesMovementId:'m1',createdAt:'2026-10-18T11:00:00Z'}),
    movement({id:'m2',quantity:40,technicianId:'admin',createdAt:'2026-10-18T11:00:01Z'})];
  assert.deepEqual(detectMaterialCustodyShortfalls(events,rows),[]);
});

test('vinculo corrupto entre ordenes y ciclos no inventan responsable ni faltantes', () => {
  assert.deepEqual(detectMaterialCustodyShortfalls([], [movement({id:'a',correctsMovementId:'b'}),movement({id:'b',correctsMovementId:'a'})]),[]);
  assert.deepEqual(detectMaterialCustodyShortfalls([], [movement({id:'a',correctsMovementId:'ausente',technicianId:'admin'})]),[]);
});

test('recibos Campo y operation_id de Rutinas reconstruyen parentesco sin inferir por autor/hora', () => {
  const rows=[movement({id:'original'}),movement({id:'rev',movementType:'ingreso',reversesMovementId:'original'}),movement({id:'nuevo',technicianId:'admin'})];
  const linked=linkMaterialCorrections(rows,[{action:'correct',payload:{movementId:'original'},result:{ids:['rev','nuevo']}}]);
  assert.equal(linked[2].correctsMovementId,'original');
  assert.equal(linkMaterialCorrections(rows,[])[2].correctsMovementId,undefined);
  const routines=rows.map(m=>({...m,jobType:'routine' as const,operationId:m.id==='original'?'op-original':'op-correct'}));
  assert.equal(linkMaterialCorrections(routines,[])[2].correctsMovementId,'original');
});

// ---- classifyShortfallRecency ----

test('classifyShortfallRecency: mientras la deteccion no este activada (LIVE_SINCE null por defecto, sin VITE_MATERIAL_CUSTODY_LIVE_SINCE configurado), todo es historico', () => {
  assert.equal(MATERIAL_CUSTODY_DETECTION_LIVE_SINCE, null);
  assert.equal(classifyShortfallRecency('2026-10-18T20:00:00.000Z'), 'historico');
  assert.equal(classifyShortfallRecency('2099-01-01T00:00:00.000Z'), 'historico');
});

// ---- classifyShortfallRecency con un cutoff explicito (mismo mecanismo que
// usara MATERIAL_CUSTODY_DETECTION_LIVE_SINCE una vez fijado por build-env) ----

test('classifyShortfallRecency: consumo ANTES del cutoff de activacion -> historico', () => {
  assert.equal(classifyShortfallRecency('2026-10-18T23:59:59.999Z', '2026-10-19T00:00:00.000Z'), 'historico');
});

test('classifyShortfallRecency: consumo EN o DESPUES del cutoff de activacion -> nuevo', () => {
  assert.equal(classifyShortfallRecency('2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z'), 'nuevo');
  assert.equal(classifyShortfallRecency('2026-10-20T00:00:00.000Z', '2026-10-19T00:00:00.000Z'), 'nuevo');
});

test('classifyShortfallRecency: el cutoff es el mismo valor para cualquier llamada -- no depende de Date.now() ni del reloj local', () => {
  const cutoff = '2026-10-19T00:00:00.000Z';
  const a = classifyShortfallRecency('2026-10-18T10:00:00.000Z', cutoff);
  const b = classifyShortfallRecency('2026-10-18T10:00:00.000Z', cutoff);
  assert.equal(a, b);
  assert.equal(a, 'historico');
});
