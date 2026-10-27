import type { Tr069Device } from '@/types/domain';
import type { Tr069InventorySnapshot } from '@/types/tr069Inventory';

export type Tr069ListedDevice = Tr069Device & { registeredLocally: boolean };

export function validateTr069Snapshot(value: Tr069InventorySnapshot): Tr069InventorySnapshot {
  if (!value || !Number.isFinite(Date.parse(value.checkedAt)) || !Number.isSafeInteger(value.total)
    || !Array.isArray(value.devices) || value.total !== value.devices.length
    || value.devices.some(d => !d || typeof d.genieacs_id !== 'string' || !d.genieacs_id.trim() || typeof d.cpe_serial !== 'string')
    || new Set(value.devices.map(d => d.genieacs_id)).size !== value.total) {
    throw Error('No se pudo verificar el inventario completo de GenieACS.');
  }
  return value;
}

/** Identidad ACS exacta. Nunca asocia por modelo, serie parecida o contrato anterior. */
export function partitionTr069Inventory(cache: Tr069Device[], snapshot: Tr069InventorySnapshot | null) {
  if (!snapshot) return { current: [] as Tr069ListedDevice[], historical: [] as Tr069Device[], unverified: cache };
  const checked = validateTr069Snapshot(snapshot);
  const saved = new Map(cache.map(d => [d.genieacs_id, d]));
  const ids = new Set(checked.devices.map(d => d.genieacs_id));
  const current: Tr069ListedDevice[] = checked.devices.map(live => {
    const row = saved.get(live.genieacs_id);
    return row ? { ...row, ...live, registeredLocally: true } : {
      ...live, id: 'acs:' + live.genieacs_id, service_contract_id: null, notes: null,
      created_at: checked.checkedAt, updated_at: checked.checkedAt, contracts: null, registeredLocally: false,
    };
  });
  const absent = cache.filter(d => !ids.has(d.genieacs_id));
  const checkedAt = Date.parse(checked.checkedAt);
  const observed = (d: Tr069Device) => Number.isFinite(Date.parse(d.created_at)) && Date.parse(d.created_at) <= checkedAt;
  return { current, historical: absent.filter(observed), unverified: absent.filter(d => !observed(d)) };
}
