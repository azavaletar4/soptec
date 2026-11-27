/** PEN exacto en centavos. La API usa cadenas decimales. */
export function penCents(value: string | number | null | undefined): number {
  const text = String(value ?? '0').trim();
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('Importe inválido: usa máximo dos decimales.');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const result = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(result)) throw new Error('Importe fuera de rango.');
  return text.startsWith('-') ? -result : result;
}
export function penDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Importe fuera de rango.');
  return `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}
export const formatPen = (value: string | number | null | undefined) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(penCents(value) / 100);
export function limaDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Formatea una fecha YYYY-MM-DD (DATE pura, ya calculada en hora de Perú
 * por el backend) como DD/MM/AAAA — reordena el texto directo, sin pasar
 * por `new Date()` (evita el corrimiento de un día que esa conversión
 * puede introducir según la zona horaria del navegador). Única fuente
 * para toda la UI financiera (Fase 30 — antes solo existía una copia
 * local en ContractFinanceSummary.vue, dejando fechas ISO crudas sin
 * formatear en PonCollections.vue y FinanceDueInvoices.vue).
 */
export function formatDateLima(v?: string | null): string {
  if (!v) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}
