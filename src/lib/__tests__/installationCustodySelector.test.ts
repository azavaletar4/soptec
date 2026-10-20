import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallationCustodySelector, isInstallableOwnCustody, installableEquipmentModelIds } from '../installationCustodySelector';
import type { FieldInventoryContext, FieldInventoryUnit } from '../../types/fieldInventory';
import type { MyInventoryCustody } from '../../types/domain';
const context: FieldInventoryContext = { jobType: 'installation', jobId: 'alta', actorId: 'ruber', clientId: 'client', contractId: 'contract' };
const unit = (changes: Partial<FieldInventoryUnit> = {}) => ({ id: 'own', product_id: 'huawei', status: 'with_technician', custody_technician_id: 'ruber', client_id: null, contract_id: null, installation_id: null, ticket_id: null, routine_id: null, ...changes }) as FieldInventoryUnit;
test('solo custodia propia vigente: nunca bodega, instalada, devuelta, pendiente ni ajena', () => {
  assert(isInstallableOwnCustody(unit(), 'ruber', 'huawei'));
  for (const status of ['in_stock','assigned','pending_return','retired','pending_approval','damaged'] as const) assert(!isInstallableOwnCustody(unit({ status }), 'ruber', 'huawei'));
  assert(!isInstallableOwnCustody(unit({ custody_technician_id: 'otro' }), 'ruber', 'huawei'));
  assert(!isInstallableOwnCustody(unit({ custody_technician_id: undefined }), 'ruber', 'huawei'));
  assert(!isInstallableOwnCustody(unit({ client_id: 'ya-asignado' }), 'ruber', 'huawei'));
  assert(!isInstallableOwnCustody(unit(), 'ruber', 'otro-producto'));
});
function fixture() {
  let actor = 'ruber', product = 'huawei', published: FieldInventoryUnit[] = [], loading = false;
  const pending: Array<(units: FieldInventoryUnit[]) => void> = [], errors: unknown[] = [];
  const selector = createInstallationCustodySelector({ read: () => new Promise(resolve => pending.push(resolve)),
    isCurrent: (ctx, pid) => ctx.actorId === actor && pid === product,
    clear: () => { published = []; }, publish: units => { published = units; }, loading: v => { loading = v; }, error: e => errors.push(e) });
  return { selector, pending, errors, get items() { return published; }, get loading() { return loading; }, actor: (v:string) => { actor = v; }, product: (v:string) => { product = v; } };
}
test('respuesta antigua no repuebla lista en un cambio A → B → A', async () => {
  const f = fixture(); const first = f.selector.load(context,'huawei');
  f.product('tv'); const second = f.selector.load(context,'tv');
  f.product('huawei'); const third = f.selector.load(context,'huawei');
  f.pending[2]!([unit({ id:'latest' })]); assert(await third);
  f.pending[0]!([unit({ id:'old' })]); f.pending[1]!([unit({ product_id:'tv' })]);
  assert.equal(await first,false); assert.equal(await second,false); assert.equal(f.items[0]!.id,'latest');
});
test('cambio de sesión o invalidación al ocultar/recargar descarta listas viejas', async () => {
  const f = fixture(); const first = f.selector.load(context,'huawei'); f.actor('otro'); f.pending[0]!([unit()]);
  assert.equal(await first,false); assert.equal(f.items.length,0);
  f.actor('ruber'); const second=f.selector.load(context,'huawei'); f.selector.invalidate(); f.pending[1]!([unit()]);
  assert.equal(await second,false); assert.equal(f.items.length,0); assert.equal(f.loading,false);
});
test('actualización global usa el mismo filtro y anula lecturas previas', async () => {
  const f=fixture(); const pending=f.selector.load(context,'huawei');
  assert(f.selector.accept(context,'huawei',[unit(),unit({id:'warehouse',status:'in_stock'}),unit({id:'foreign',custody_technician_id:'otro'})]));
  f.pending[0]!([unit({id:'obsolete'})]); assert.equal(await pending,false);
  assert.deepEqual(f.items.map(u=>u.id),['own']);
});

// ---- installableEquipmentModelIds (selector de modelos de Altas, Fase 165b) ----
type MyUnit = MyInventoryCustody['units'][number];
const myUnit = (changes: Partial<MyUnit> = {}): MyUnit => ({ id: 'u1', serial_number: 'SN-1', mac_address: null, status: 'with_technician', product: { id: 'huawei', name: 'Huawei ONT' }, ...changes });

test('sin equipos en custodia: ningun modelo (cero)', () => {
  assert.deepEqual([...installableEquipmentModelIds([])], []);
});
test('un modelo con una unidad disponible', () => {
  assert.deepEqual([...installableEquipmentModelIds([myUnit()])], ['huawei']);
});
test('varios modelos distintos, cada uno con al menos una unidad disponible', () => {
  const ids = installableEquipmentModelIds([
    myUnit({ id: 'u1', product: { id: 'huawei', name: 'Huawei ONT' } }),
    myUnit({ id: 'u2', product: { id: 'tvbox', name: 'TV Box' } }),
    myUnit({ id: 'u3', product: { id: 'mesh', name: 'Mesh' } }),
  ]);
  assert.deepEqual([...ids].sort(), ['huawei', 'mesh', 'tvbox']);
});
test('el mismo modelo con varias unidades no se repite (Set)', () => {
  const ids = installableEquipmentModelIds([myUnit({ id: 'u1' }), myUnit({ id: 'u2' })]);
  assert.deepEqual([...ids], ['huawei']);
});
test('equipos sin disponibilidad real (ya instalado, devuelto, pendiente de devolver) no cuentan el modelo', () => {
  for (const status of ['in_stock', 'assigned', 'pending_return', 'retired', 'pending_approval', 'damaged'] as const) {
    assert.deepEqual([...installableEquipmentModelIds([myUnit({ status })])], [], `status=${status} no debe contar`);
  }
});
test('un modelo sin disponibilidad junto a otro disponible: solo el disponible aparece', () => {
  const ids = installableEquipmentModelIds([
    myUnit({ id: 'u1', status: 'pending_return', product: { id: 'sin-stock', name: 'Sin disponibilidad' } }),
    myUnit({ id: 'u2', status: 'with_technician', product: { id: 'huawei', name: 'Huawei ONT' } }),
  ]);
  assert.deepEqual([...ids], ['huawei']);
});
test('cambio de técnico: la lista se recalcula por completo a partir de la custodia del nuevo técnico, sin residuos del anterior', () => {
  const tecnicoA = installableEquipmentModelIds([myUnit({ product: { id: 'huawei', name: 'Huawei ONT' } })]);
  const tecnicoB = installableEquipmentModelIds([myUnit({ product: { id: 'tvbox', name: 'TV Box' } })]);
  assert.deepEqual([...tecnicoA], ['huawei']);
  assert.deepEqual([...tecnicoB], ['tvbox']);
  assert(!tecnicoB.has('huawei'));
});
