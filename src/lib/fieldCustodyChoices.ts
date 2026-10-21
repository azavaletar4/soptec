import type { MyInventoryCustody } from '../types/domain';
import type { MaterialCustodyLoadState } from './materialCustodyAvailability';

// Source must be my_inventory_custody(): the session, never a crew leader's ID.
export function custodyEquipmentUnits(units: MyInventoryCustody['units'], productId: string, state: MaterialCustodyLoadState) {
  return state === 'ready' && productId
    ? units.filter(u => u.status === 'with_technician' && u.product.id === productId) : [];
}
export function custodyEquipmentModels(units: MyInventoryCustody['units'], state: MaterialCustodyLoadState) {
  return state === 'ready'
    ? [...new Map(units.filter(u => u.status === 'with_technician').map(u => [u.product.id, u.product])).values()] : [];
}
export function custodyMaterialChoices(materials: MyInventoryCustody['materials'], state: MaterialCustodyLoadState) {
  // A failed/unfinished read is not a zero balance and never exposes the general catalog.
  return state === 'ready' ? materials.filter(m => Number.isFinite(m.quantity) && m.quantity > 0).map(m => m.product) : [];
}
export function custodyUnitLabel(unit: MyInventoryCustody['units'][number]) {
  return [unit.product.name, unit.serial_number, unit.mac_address].filter(Boolean).join(' — ');
}
