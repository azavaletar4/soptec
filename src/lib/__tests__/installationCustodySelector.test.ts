import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallationCustodySelector, isInstallableOwnCustody } from '../installationCustodySelector';
import type { FieldInventoryContext, FieldInventoryUnit } from '../../types/fieldInventory';
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
