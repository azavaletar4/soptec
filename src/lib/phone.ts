/** Normaliza numeros ecuatorianos (celular con 0 inicial o ya con 593) a
 *  formato E.164 sin '+' para enlaces de WhatsApp (wa.me) y tel:. */
export function toWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('593')) return digits;
  if (digits.startsWith('0')) return `593${digits.slice(1)}`;
  return digits;
}

export function waLink(phone: string): string {
  return `https://wa.me/${toWhatsappNumber(phone)}`;
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

export function wazeLink(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}
