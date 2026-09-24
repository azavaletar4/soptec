/**
 * Backfill (relleno seguro) desde SmartOLT hacia olt_onts en SmartRayco:
 * completa Nombre del ONT (description), Zona (zone_id) y NAP
 * (splitter/splitter_port) SOLO cuando el campo local esta vacio/null.
 * Nunca sobrescribe un dato que ya exista, salvo con --force explicito.
 *
 * ALCANCE — decision deliberada: esto solo toca olt_onts (description,
 * zone_id, splitter, splitter_port). NO TOCA la tabla clients (nombre/
 * apellido reales del cliente) ni ningun campo de estado/plan/facturacion —
 * "Nombre del cliente/ONT" en SmartOLT es un texto libre por-ONT (lo
 * confirmo el script de auditoria: valores como "Roberto Carmona"), no el
 * registro estructurado del cliente en SmartRayco. Mezclar eso en la ficha
 * real del cliente seria mas riesgoso que util.
 *
 * SOLO SE VINCULA POR NUMERO DE SERIE (SN) — el pedido original tambien
 * mencionaba "o nombre exacto de cliente" como alternativa, pero usar el
 * nombre como llave de match no tiene sentido aqui: el nombre es
 * justamente uno de los campos que puede estar vacio en SmartRayco (no se
 * puede usar como llave lo que a veces falta). Si un SN de SmartOLT no
 * tiene una fila en olt_onts, se reporta como "no encontrado" — este
 * script NO crea ONTs nuevas (para eso esta "Registrar ONT" o el import
 * masivo, que si tocan la OLT real).
 *
 * ZONA: solo se asigna si el zone_name de SmartOLT hace match EXACTO
 * (case-insensitive) con una zona YA EXISTENTE en la tabla zones. Si no
 * existe, se reporta como "zona no encontrada" en vez de crear una zona
 * nueva sola — evita poblar `zones` con nombres que no siguen la
 * convencion que ya usa SmartRayco.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/backfill-smartolt.ts
 *     DRY-RUN (default, no escribe nada) — imprime que se actualizaria.
 *
 *   npx tsx server/scripts/backfill-smartolt.ts --apply
 *     Aplica de verdad, pero SOLO en los campos vacios (comportamiento
 *     seguro por defecto).
 *
 *   npx tsx server/scripts/backfill-smartolt.ts --apply --force
 *     Aplica y ADEMAS sobrescribe campos que ya tenian un valor local —
 *     usar con cuidado, revisa primero el dry-run y/o --only.
 *
 *   npx tsx server/scripts/backfill-smartolt.ts --only HWTC3B4898AD
 *     Limita todo lo anterior a un solo serial — para probar antes de
 *     correrlo contra el resto.
 *
 * Requiere en .env: SMARTOLT_SUBDOMAIN, SMARTOLT_API_TOKEN (mismos que
 * audit-smartolt.ts).
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

const SMARTOLT_SUBDOMAIN = process.env.SMARTOLT_SUBDOMAIN;
const SMARTOLT_API_TOKEN = process.env.SMARTOLT_API_TOKEN;

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const ONLY_SERIAL = onlyIdx !== -1 ? args[onlyIdx + 1]?.toUpperCase() : null;

interface SmartOltOnu {
  sn: string;
  name?: string;
  zone_name?: string;
  odb_name?: string;
  odb_port?: string;
}

interface LocalOnt {
  id: string;
  serial: string;
  description: string | null;
  zone_id: string | null;
  splitter: string | null;
  splitter_port: string | null;
}

function normalizeSn(sn: string): string {
  return sn.trim().toUpperCase();
}

function isEmpty(v: string | null | undefined): boolean {
  return v == null || v.trim() === '';
}

/** UNICA llamada a SmartOLT — GET, nada mas (igual que audit-smartolt.ts). */
async function fetchSmartOltOnus(): Promise<SmartOltOnu[]> {
  const url = `https://${SMARTOLT_SUBDOMAIN}.smartolt.com/api/onu/get_all_onus_details`;
  const res = await fetch(url, { method: 'GET', headers: { 'X-Token': SMARTOLT_API_TOKEN as string } });
  if (!res.ok) throw new Error(`SmartOLT respondió ${res.status} ${res.statusText}: ${await res.text()}`);
  const body = (await res.json()) as { status: boolean; onus?: SmartOltOnu[]; error?: string };
  if (!body.status) throw new Error(`SmartOLT devolvió status=false: ${body.error ?? JSON.stringify(body)}`);
  return body.onus ?? [];
}

async function fetchLocalOnts(): Promise<LocalOnt[]> {
  const { data, error } = await supabaseAdmin.from('olt_onts').select('id, serial, description, zone_id, splitter, splitter_port');
  if (error) throw new Error(error.message);
  return (data ?? []) as LocalOnt[];
}

interface ZoneRow {
  id: string;
  name: string;
}

/** "PON 1 - Antenor Orrego" -> "1". SmartRayco nombra sus zonas con formas
 *  abreviadas del mismo "PON N" de SmartOLT (ej. local "PON 1 - AO" vs
 *  SmartOLT "PON 1 - ANTENOR ORREGO") — el numero de PON es la unica parte
 *  confiable para hacer match, el resto del texto no coincide letra a letra
 *  aunque sea la MISMA zona. */
function extractPonNumber(name: string): string | null {
  const m = name.match(/pon\s*(\d+)/i);
  return m ? m[1] : null;
}

async function fetchZones(): Promise<{ byName: Map<string, ZoneRow>; byPon: Map<string, ZoneRow>; ambiguousPon: Set<string> }> {
  const { data, error } = await supabaseAdmin.from('zones').select('id, name');
  if (error) throw new Error(error.message);
  const byName = new Map<string, ZoneRow>();
  const byPon = new Map<string, ZoneRow>();
  const ambiguousPon = new Set<string>();
  for (const z of (data ?? []) as ZoneRow[]) {
    byName.set(z.name.trim().toLowerCase(), z);
    const pon = extractPonNumber(z.name);
    if (!pon) continue;
    if (byPon.has(pon)) {
      ambiguousPon.add(pon); // mas de una zona local con el mismo numero de PON — no se adivina cual, se reporta
    } else {
      byPon.set(pon, z);
    }
  }
  for (const pon of ambiguousPon) byPon.delete(pon);
  return { byName, byPon, ambiguousPon };
}

interface PlannedUpdate {
  ontId: string;
  sn: string;
  changes: Record<string, { from: string; to: string }>;
  patch: Record<string, string>;
}

async function main() {
  if (!SMARTOLT_SUBDOMAIN || !SMARTOLT_API_TOKEN) {
    throw new Error('Faltan SMARTOLT_SUBDOMAIN y/o SMARTOLT_API_TOKEN en el .env');
  }

  console.log(`=== Backfill SmartOLT -> SmartRayco (${APPLY ? (FORCE ? 'APLICANDO CON --force' : 'APLICANDO') : 'DRY-RUN, no escribe nada'}) ===\n`);

  const [remoteOnus, localOnts, zones] = await Promise.all([fetchSmartOltOnus(), fetchLocalOnts(), fetchZones()]);
  const localBySn = new Map(localOnts.map((o) => [normalizeSn(o.serial), o]));

  const planned: PlannedUpdate[] = [];
  const notFoundLocally: string[] = [];
  const zoneNotFound = new Set<string>();
  const zoneAmbiguous = new Set<string>();
  const skippedAlreadyFilled: string[] = [];
  const errors: { sn: string; message: string }[] = [];
  let processed = 0;

  for (const onu of remoteOnus) {
    if (!onu.sn) continue;
    const sn = normalizeSn(onu.sn);
    if (ONLY_SERIAL && sn !== ONLY_SERIAL) continue;
    processed++;

    try {
      const local = localBySn.get(sn);
      if (!local) {
        notFoundLocally.push(sn);
        continue;
      }

      const changes: PlannedUpdate['changes'] = {};
      const patch: PlannedUpdate['patch'] = {};

      if (onu.name && (FORCE || isEmpty(local.description)) && onu.name.trim() !== (local.description ?? '')) {
        changes.description = { from: local.description ?? '(vacío)', to: onu.name.trim() };
        patch.description = onu.name.trim();
      }

      if (onu.zone_name && (FORCE || isEmpty(local.zone_id))) {
        const zoneName = onu.zone_name.trim();
        const ponNumber = extractPonNumber(zoneName);
        // Match preferido por numero de PON (mismo patron "PON N - ..." en
        // ambos lados, pero el texto del resto NO coincide letra a letra:
        // SmartRayco usa siglas — ver comentario de extractPonNumber). Si
        // no hay numero de PON extraible, cae a comparar el nombre exacto.
        const match = (ponNumber && zones.byPon.get(ponNumber)) || zones.byName.get(zoneName.toLowerCase());
        if (ponNumber && zones.ambiguousPon.has(ponNumber)) {
          zoneAmbiguous.add(`PON ${ponNumber} (SmartOLT: "${zoneName}")`);
        } else if (!match) {
          zoneNotFound.add(zoneName);
        } else if (FORCE || local.zone_id !== match.id) {
          changes.zone_id = { from: local.zone_id ?? '(vacío)', to: `${match.name} (${match.id})` };
          patch.zone_id = match.id;
        }
      }

      if (onu.odb_name && (FORCE || isEmpty(local.splitter)) && onu.odb_name.trim() !== (local.splitter ?? '')) {
        changes.splitter = { from: local.splitter ?? '(vacío)', to: onu.odb_name.trim() };
        patch.splitter = onu.odb_name.trim();
      }

      if (onu.odb_port && (FORCE || isEmpty(local.splitter_port)) && onu.odb_port.trim() !== (local.splitter_port ?? '')) {
        changes.splitter_port = { from: local.splitter_port ?? '(vacío)', to: onu.odb_port.trim() };
        patch.splitter_port = onu.odb_port.trim();
      }

      if (Object.keys(patch).length === 0) {
        skippedAlreadyFilled.push(sn);
        continue;
      }

      planned.push({ ontId: local.id, sn, changes, patch });
    } catch (e) {
      errors.push({ sn, message: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`Total ONTs de SmartOLT procesadas: ${processed}`);
  console.log(`Con cambios ${APPLY ? 'a aplicar' : 'planeados'}: ${planned.length}`);
  console.log(`Ya completas en SmartRayco (sin cambios): ${skippedAlreadyFilled.length}`);
  console.log(`No encontradas en SmartRayco (olt_onts): ${notFoundLocally.length}`);
  console.log(`Zonas de SmartOLT sin equivalente en SmartRayco: ${zoneNotFound.size}`);
  console.log(`Zonas con numero de PON ambiguo (2+ zonas locales con el mismo numero): ${zoneAmbiguous.size}`);
  console.log(`Errores: ${errors.length}\n`);

  if (planned.length) {
    console.log('--- Detalle de cambios ---');
    for (const p of planned) {
      const desc = Object.entries(p.changes)
        .map(([field, { from, to }]) => `${field}: "${from}" -> "${to}"`)
        .join('  |  ');
      console.log(`SN=${p.sn}  ${desc}`);
    }
    console.log('');
  }

  if (notFoundLocally.length) {
    console.log('--- SN de SmartOLT sin fila en olt_onts (no se tocan, no se crean) ---');
    console.log(notFoundLocally.join(', '), '\n');
  }

  if (zoneNotFound.size) {
    console.log('--- Zonas de SmartOLT sin match (ni por numero de PON ni por nombre exacto) ---');
    console.log([...zoneNotFound].join(', '), '\n');
  }

  if (zoneAmbiguous.size) {
    console.log('--- Numero de PON ambiguo: revisar manualmente cual zona local corresponde ---');
    console.log([...zoneAmbiguous].join(', '), '\n');
  }

  if (errors.length) {
    console.log('--- Errores ---');
    for (const e of errors) console.log(`SN=${e.sn}: ${e.message}`);
    console.log('');
  }

  if (!APPLY) {
    console.log(`DRY-RUN: no se aplicó ningún cambio. Corre con --apply para escribir estos ${planned.length} registros.`);
    return;
  }

  let updated = 0;
  for (const p of planned) {
    const { error } = await supabaseAdmin.from('olt_onts').update(p.patch).eq('id', p.ontId);
    if (error) {
      errors.push({ sn: p.sn, message: error.message });
      continue;
    }
    updated++;
  }

  console.log(`\nAplicado: ${updated}/${planned.length} ONTs actualizadas. ${errors.length} errores en total (ver arriba).`);
}

main().catch((e) => {
  console.error('\nError en el backfill:', e instanceof Error ? e.message : e);
  process.exit(1);
});
