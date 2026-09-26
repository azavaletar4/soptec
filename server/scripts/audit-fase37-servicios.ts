/**
 * Auditoria de solo lectura para las Fases 37 y 38 (servicios independientes:
 * ubicacion, ONT, equipo, descuentos, zona, caja NAP y fotos por servicio en
 * vez de por cliente).
 *
 * Ambas migraciones agregan contract_id a varias tablas y lo autocompletan
 * SOLO para clientes con un unico contrato (caso no ambiguo). Este script
 * lista los clientes con 2+ contratos donde algo quedo sin contract_id — eso
 * es lo que el staff debe revisar a mano desde la ficha de cada servicio
 * (/clientes/:id/servicios/:contractId).
 *
 * GARANTIA DE SOLO LECTURA: este archivo solo hace .select(...) contra
 * Supabase. No debe contener jamas un .insert/.update/.delete/.upsert.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/audit-fase37-servicios.ts
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

interface ClientRow {
  id: string;
  first_name: string;
  last_name: string;
  document_number: string;
}

async function main() {
  const { data: clients, error: clientsErr } = await supabaseAdmin
    .from('clients')
    .select('id, first_name, last_name, document_number');
  if (clientsErr) throw clientsErr;

  const { data: contracts, error: contractsErr } = await supabaseAdmin
    .from('service_contracts')
    .select('id, client_id, contract_number, installation_address, latitude, longitude, zone_id');
  if (contractsErr) throw contractsErr;

  const { data: onts, error: ontsErr } = await supabaseAdmin.from('olt_onts').select('id, client_id, contract_id, serial');
  if (ontsErr) throw ontsErr;

  const { data: units, error: unitsErr } = await supabaseAdmin
    .from('inventory_units')
    .select('id, client_id, contract_id, serial_number, mac_address')
    .not('client_id', 'is', null);
  if (unitsErr) throw unitsErr;

  const { data: discounts, error: discountsErr } = await supabaseAdmin
    .from('descuentos_compensacion')
    .select('id, client_id, contract_id, monto, motivo')
    .eq('estado', 'pendiente');
  if (discountsErr) throw discountsErr;

  const { data: napPorts, error: napErr } = await supabaseAdmin
    .from('fo_nap_puertos')
    .select('id, client_id, contract_id, puerto_numero, infra_elemento_id')
    .not('client_id', 'is', null);
  if (napErr) throw napErr;

  const { data: photos, error: photosErr } = await supabaseAdmin
    .from('client_photos')
    .select('id, client_id, contract_id, category');
  if (photosErr) throw photosErr;

  const contractsByClient = new Map<string, typeof contracts>();
  for (const c of contracts ?? []) {
    const list = contractsByClient.get(c.client_id) ?? [];
    list.push(c);
    contractsByClient.set(c.client_id, list);
  }

  const multiClients = (clients as ClientRow[]).filter((c) => (contractsByClient.get(c.id)?.length ?? 0) > 1);

  console.log(`Clientes totales: ${clients?.length ?? 0}`);
  console.log(`Clientes con 2+ contratos (candidatos a revision): ${multiClients.length}\n`);

  let flagged = 0;
  for (const client of multiClients) {
    const clientContracts = contractsByClient.get(client.id) ?? [];
    const pendingOnts = (onts ?? []).filter((o) => o.client_id === client.id && !o.contract_id);
    const pendingUnits = (units ?? []).filter((u) => u.client_id === client.id && !u.contract_id);
    const pendingDiscounts = (discounts ?? []).filter((d) => d.client_id === client.id && !d.contract_id);
    const pendingNapPorts = (napPorts ?? []).filter((p) => p.client_id === client.id && !p.contract_id);
    const pendingPhotos = (photos ?? []).filter((p) => p.client_id === client.id && !p.contract_id);
    // Ubicacion "sin revisar" = mismo lat/lng en 2+ contratos de este cliente
    // (senal de que el backfill copio el mismo punto del titular a todos y
    // nadie la ha corregido todavia para las lineas que no son la principal).
    const coordsSeen = new Set(clientContracts.map((c) => `${c.latitude},${c.longitude}`));
    const sameCoordsAcrossContracts = clientContracts.length > 1 && coordsSeen.size === 1 && clientContracts[0].latitude != null;
    // Misma logica para zona: si todos los contratos comparten zona, es el
    // backfill sin revisar (puede ser correcto o no, hay que confirmarlo).
    const zonesSeen = new Set(clientContracts.map((c) => c.zone_id));
    const sameZoneAcrossContracts = clientContracts.length > 1 && zonesSeen.size === 1 && clientContracts[0].zone_id != null;

    if (
      !pendingOnts.length &&
      !pendingUnits.length &&
      !pendingDiscounts.length &&
      !pendingNapPorts.length &&
      !pendingPhotos.length &&
      !sameCoordsAcrossContracts &&
      !sameZoneAcrossContracts
    )
      continue;

    flagged += 1;
    console.log(`- ${client.first_name} ${client.last_name} (${client.document_number}) — ${clientContracts.length} contratos`);
    if (sameCoordsAcrossContracts) {
      console.log(`    Ubicacion: los ${clientContracts.length} contratos tienen el mismo GPS/direccion (revisar cual es cual)`);
    }
    if (sameZoneAcrossContracts) {
      console.log(`    Zona: los ${clientContracts.length} contratos tienen la misma zona (revisar si corresponde)`);
    }
    for (const o of pendingOnts) console.log(`    ONT sin linea: ${o.serial}`);
    for (const u of pendingUnits) console.log(`    Equipo sin linea: ${u.serial_number || u.mac_address}`);
    for (const d of pendingDiscounts) console.log(`    Descuento sin linea: ${d.motivo} — S/ ${d.monto}`);
    for (const p of pendingNapPorts) console.log(`    Puerto NAP sin linea: puerto ${p.puerto_numero} (caja ${p.infra_elemento_id})`);
    for (const p of pendingPhotos) console.log(`    Foto sin linea: ${p.category}`);
  }

  console.log(`\nClientes que necesitan revision manual: ${flagged}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
