/**
 * Auditoria de solo lectura: compara los ONUs registrados en la cuenta de
 * SmartOLT (el sistema que este ISP usaba ANTES de SmartRayco para
 * gestionar la OLT — ver README y el comentario de import masivo en
 * server/src/routes/olt.ts) contra los que hoy existen en la tabla local
 * olt_onts, para detectar ONUs que quedaron sin migrar o que difieren en
 * algun dato (nombre/VLAN).
 *
 * GARANTIA DE SOLO LECTURA:
 *  - A SmartOLT solo se le hace UN request GET (get_all_onus_details).
 *    Nunca se llama aqui ningun endpoint de authorize/add/edit/delete.
 *  - A Supabase solo se hace .select(...). Este archivo no debe contener
 *    jamas un .insert/.update/.delete/.upsert — si en algun momento hace
 *    falta escribir el resultado de la auditoria, hazlo en un script
 *    APARTE que revise el log generado aqui, nunca agregando writes a este.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/audit-smartolt.ts
 *
 * Requiere en .env:
 *   SMARTOLT_SUBDOMAIN=tuisp        (la parte antes de ".smartolt.com" en tu URL de SmartOLT)
 *   SMARTOLT_API_TOKEN=xxxxxxxxxxxx (Configuracion > API Access dentro de SmartOLT)
 *
 * Limite de la API de SmartOLT: "get_all_onus_details" es un export
 * completo de su base — SmartOLT recomienda como maximo ~15 llamadas/hora a
 * este endpoint. Este script hace UNA sola llamada por corrida; no lo
 * pongas a correr en un loop/cron sin espaciarlo.
 *
 * OJO — campos no verificados contra una cuenta real: el ejemplo publico de
 * "get_all_onus_details" no incluye VLAN ni estado online/offline en su
 * respuesta (solo sn/board/port/onu/zone/name/olt). Si tu cuenta SI los
 * expone, ajusta SmartOltOnu y las lineas marcadas "// AJUSTAR" mas abajo
 * con los nombres reales de esos campos una vez veas la respuesta real
 * (el script imprime el primer ONU crudo al inicio para facilitar esto).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

const SMARTOLT_SUBDOMAIN = process.env.SMARTOLT_SUBDOMAIN;
const SMARTOLT_API_TOKEN = process.env.SMARTOLT_API_TOKEN;

interface SmartOltOnu {
  sn: string;
  name?: string;
  zone_name?: string;
  olt_name?: string;
  board?: string;
  port?: string;
  onu?: string;
  vlan?: string | number; // AJUSTAR: nombre real del campo si tu cuenta lo trae
  status?: string; // AJUSTAR: idem para el estado online/offline
}

interface LocalOnt {
  id: string;
  serial: string;
  description: string | null;
  vlan: number | null;
  status: string;
  ont_id: number;
  slot: number;
  port: number;
  frame: number;
  clients: { first_name: string; last_name: string } | null;
  zones: { name: string } | null;
}

function normalizeSn(sn: string): string {
  return sn.trim().toUpperCase();
}

/** UNICA llamada a SmartOLT — GET, nada mas. */
async function fetchSmartOltOnus(): Promise<SmartOltOnu[]> {
  const url = `https://${SMARTOLT_SUBDOMAIN}.smartolt.com/api/onu/get_all_onus_details`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-Token': SMARTOLT_API_TOKEN as string },
  });
  if (!res.ok) {
    throw new Error(`SmartOLT respondió ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  const body = (await res.json()) as { status: boolean; onus?: SmartOltOnu[]; error?: string };
  if (!body.status) {
    throw new Error(`SmartOLT devolvió status=false: ${body.error ?? JSON.stringify(body)}`);
  }
  return body.onus ?? [];
}

/** UNICAMENTE select — jamas agregar un write aqui. */
async function fetchLocalOnts(): Promise<LocalOnt[]> {
  const { data, error } = await supabaseAdmin
    .from('olt_onts')
    .select('id, serial, description, vlan, status, ont_id, slot, port, frame, clients(first_name, last_name), zones(name)');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LocalOnt[];
}

interface Mismatch {
  sn: string;
  campo: string;
  smartolt: string;
  smartrayco: string;
}

async function main() {
  if (!SMARTOLT_SUBDOMAIN || !SMARTOLT_API_TOKEN) {
    throw new Error('Faltan SMARTOLT_SUBDOMAIN y/o SMARTOLT_API_TOKEN en el .env (ver comentario al inicio de este archivo)');
  }

  console.log('=== Auditoría SmartOLT vs SmartRayco (SOLO LECTURA) ===\n');
  console.log('Consultando SmartOLT (get_all_onus_details)...');
  console.log('Consultando olt_onts local...');

  const [remoteOnus, localOnts] = await Promise.all([fetchSmartOltOnus(), fetchLocalOnts()]);

  if (remoteOnus.length) {
    console.log('\nEjemplo de ONU cruda de SmartOLT (para verificar nombres de campo de VLAN/estado):');
    console.log(JSON.stringify(remoteOnus[0], null, 2), '\n');
  }

  const localBySn = new Map(localOnts.map((o) => [normalizeSn(o.serial), o]));
  const missingInSmartRayco: SmartOltOnu[] = [];
  const mismatches: Mismatch[] = [];

  for (const onu of remoteOnus) {
    if (!onu.sn) continue;
    const sn = normalizeSn(onu.sn);
    const local = localBySn.get(sn);

    if (!local) {
      missingInSmartRayco.push(onu);
      continue;
    }

    const localName = local.clients ? `${local.clients.first_name} ${local.clients.last_name}` : (local.description ?? '');
    if (onu.name && localName && onu.name.trim() !== localName.trim()) {
      mismatches.push({ sn, campo: 'nombre', smartolt: onu.name, smartrayco: localName });
    }
    // AJUSTAR: si tu SmartOLT expone vlan con otro nombre de campo, cambialo aqui tambien.
    if (onu.vlan != null && local.vlan != null && String(onu.vlan) !== String(local.vlan)) {
      mismatches.push({ sn, campo: 'vlan', smartolt: String(onu.vlan), smartrayco: String(local.vlan) });
    }
  }

  const lines: string[] = [];
  lines.push(`Fecha: ${new Date().toISOString()}`);
  lines.push(`Total ONTs en SmartOLT: ${remoteOnus.length}`);
  lines.push(`Total ONTs en SmartRayco (olt_onts): ${localOnts.length}`);
  lines.push(`Faltantes en SmartRayco: ${missingInSmartRayco.length}`);
  lines.push(`Inconsistencias leves (existen en ambos, difiere un campo): ${mismatches.length}`);
  lines.push('');

  lines.push('--- ONUs en SmartOLT que FALTAN en SmartRayco ---');
  if (!missingInSmartRayco.length) lines.push('(ninguna)');
  for (const o of missingInSmartRayco) {
    lines.push(
      `SN=${o.sn}  Cliente/Nombre=${o.name ?? '—'}  Zona=${o.zone_name ?? '—'}  OLT=${o.olt_name ?? '—'}  Puerto=${o.board ?? '?'}/${o.port ?? '?'}/${o.onu ?? '?'}  VLAN=${o.vlan ?? '—'}  Estado=${o.status ?? '—'}`,
    );
  }

  lines.push('');
  lines.push('--- Inconsistencias (existe en ambos, difiere algo) ---');
  if (!mismatches.length) lines.push('(ninguna)');
  for (const m of mismatches) {
    lines.push(`SN=${m.sn}  Campo=${m.campo}  SmartOLT="${m.smartolt}"  SmartRayco="${m.smartrayco}"`);
  }

  const report = lines.join('\n');
  console.log('\n' + report);

  const outPath = path.join(process.cwd(), `audit-smartolt-${new Date().toISOString().slice(0, 10)}.log`);
  fs.writeFileSync(outPath, report, 'utf-8');
  console.log(`\nReporte guardado en: ${outPath}`);
}

main().catch((e) => {
  console.error('\nError en la auditoría (no se escribió ni modificó nada):', e instanceof Error ? e.message : e);
  process.exit(1);
});
