/** Normaliza celulares peruanos (9 digitos, ej. 987654321) a formato E.164
 *  sin '+' para enlaces de WhatsApp (wa.me) y tel:. Sin el codigo de pais
 *  (51) wa.me no resuelve el contacto correcto. */
export function toWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('51') && digits.length > 9) return digits;
  if (digits.length === 9) return `51${digits}`;
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
