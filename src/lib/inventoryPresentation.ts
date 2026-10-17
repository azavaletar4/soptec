export const UNIT_LOCATION_LABELS: Record<string, string> = {
  in_stock: 'En almacén', assigned: 'Asignado a cliente', with_technician: 'Bajo custodia de técnico',
  pending_return: 'Devolución de custodia pendiente', pending_approval: 'Por revisar / pendiente de aprobación',
  en_recupero: 'Por recoger', damaged: 'Averiado', in_repair: 'En reparación', retired: 'Dado de baja',
};
export function matchesEquipmentFilter(unit: { status: string; serial_number: string | null; mac_address: string | null; clients?: { first_name: string; last_name: string } | null }, term: string, status: string) {
  const text = `${unit.serial_number ?? ''} ${unit.mac_address ?? ''} ${unit.clients?.first_name ?? ''} ${unit.clients?.last_name ?? ''}`.toLocaleLowerCase();
  const macTerm = term.replace(/[:.\-\s]/g, '').toUpperCase();
  const macMatch = /^[0-9A-F]{12}$/.test(macTerm) && (unit.mac_address ?? '').replace(/[:.\-\s]/g, '').toUpperCase() === macTerm;
  return (!status || status === unit.status) && (text.includes(term.trim().toLocaleLowerCase()) || macMatch);
}
