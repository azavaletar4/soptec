import { Hono } from 'hono';

// Receptor generico de alertas (pensado para el transporte "API"/webhook de
// LibreNMS, que hoy NO esta instalado — ver docs/mikrotik-librenms.md). No
// depende de ningun SDK de LibreNMS: solo lee los campos mas comunes de su
// payload de forma defensiva, para no romper si cambia el formato exacto.
//
// El envio real a WhatsApp queda pendiente a proposito (decision del
// 2026-09-25: sin gateway elegido todavia, ver sendWhatsAppAlert abajo) —
// por ahora la alerta ya formateada solo se loguea, lista para conectar el
// gateway que se elija despues sin tocar el resto de este archivo.

export const alertsRoutes = new Hono();

interface LibreNmsAlertPayload {
  title?: string;
  name?: string;
  rule?: string;
  hostname?: string;
  device?: string;
  sysName?: string;
  ip?: string;
  severity?: string;
  state?: number | string; // LibreNMS: 0 = alerta, 1 = recuperado (RECOVERY)
  timestamp?: string;
  msg?: string;
  message?: string;
  [key: string]: unknown;
}

function formatWhatsAppMessage(p: LibreNmsAlertPayload): string {
  const title = p.title ?? p.name ?? p.rule ?? 'Alerta de red';
  const hostname = p.hostname ?? p.device ?? p.sysName ?? '—';
  const ip = p.ip ?? '—';
  const isRecovery = p.state === 1 || p.state === '1' || String(p.severity).toLowerCase() === 'ok';
  const severity = isRecovery ? 'RECUPERADO ✅' : (p.severity ?? 'CRITICAL').toString().toUpperCase();
  const timestamp = p.timestamp ?? new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' });
  const message = p.msg ?? p.message ?? '—';

  return [
    isRecovery ? '✅ *RECUPERADO - SMARTRAYCO* ✅' : '🚨 *ALERTA DE RED - SMARTRAYCO* 🚨',
    `• *Evento:* ${title}`,
    `• *Dispositivo:* ${hostname} (${ip})`,
    `• *Estado:* ${severity}`,
    `• *Hora:* ${timestamp}`,
    `• *Detalle:* ${message}`,
  ].join('\n');
}

/**
 * TODO: conectar el gateway de WhatsApp elegido (pendiente al 2026-09-25).
 * Con una API paga (ej. UltraMsg): un solo POST con fetch/undici, usando
 * ALERTS_WHATSAPP_* del .env. Con Baileys/Evolution API (autoalojado): un
 * POST a tu instancia local. Mientras tanto, solo se loguea.
 */
async function sendWhatsAppAlert(formattedMessage: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[alerts] (WhatsApp aun no configurado) mensaje que se hubiera enviado:\n' + formattedMessage);
}

alertsRoutes.post('/librenms', async (c) => {
  const secret = process.env.ALERTS_WEBHOOK_SECRET;
  if (secret) {
    const provided = c.req.header('x-alert-secret') ?? new URL(c.req.url).searchParams.get('secret');
    if (provided !== secret) return c.json({ error: 'Secreto invalido' }, 401);
  }

  let payload: LibreNmsAlertPayload;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Body invalido, se esperaba JSON' }, 400);
  }

  const formatted = formatWhatsAppMessage(payload);
  try {
    await sendWhatsAppAlert(formatted);
  } catch (e) {
    // No se falla el webhook por esto — LibreNMS reintentaria y no hay nada
    // que el remitente pueda corregir del lado suyo.
    // eslint-disable-next-line no-console
    console.error('[alerts] error enviando a WhatsApp:', e);
  }

  return c.json({ ok: true });
});
