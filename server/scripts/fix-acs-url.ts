/**
 * Diagnostica y corrige el ACS URL de TR-069 cuando la IP de este laptop de
 * desarrollo cambia (GenieACS corre aqui mismo mientras no se decida un
 * host fijo — ver memoria del proyecto "TR-069 live test 2026-09-11").
 *
 * Sintoma tipico: las ONTs con tr069_enabled=true dejan de aparecer en
 * GenieACS sin ningun error visible en la app, porque el ACS URL guardado
 * (olt_onts.tr069_acs_url / olt_tr069_acs_profiles.acs_url) ya no apunta a
 * una IP real de esta maquina.
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/fix-acs-url.ts
 *     Solo diagnostico — perfil(es) ACS por defecto, ONTs con TR-069
 *     habilitado y su URL guardada, y dispositivos actualmente registrados
 *     en GenieACS (para comparar). No escribe nada.
 *
 *   npx tsx server/scripts/fix-acs-url.ts --set http://<ip-actual>:7547
 *     Dry-run: muestra cuantos perfiles/ONTs quedarian desactualizados y
 *     que se haria, sin tocar nada todavia.
 *
 *   npx tsx server/scripts/fix-acs-url.ts --set http://<ip-actual>:7547 --apply --yes
 *     Aplica de verdad: actualiza el/los perfil(es) ACS por defecto Y
 *     reconfigura (via Telnet, EN VIVO contra la OLT real) cada ONT con
 *     tr069_enabled=true que no tenga ya esa URL. --apply y --yes son
 *     ambos requeridos a proposito (doble confirmacion antes de escribir
 *     en la OLT real).
 *
 *   ... --only <olt_onts.id>
 *     Limita la reconfiguracion de ONTs a una sola (por su id en
 *     olt_onts) — util para probar con un equipo de baja criticidad antes
 *     de aplicar al resto.
 *
 * La IP correcta NUNCA se adivina automaticamente (mismo criterio que
 * feedback_olt_no_live_writes: no inferir valores contra la OLT real) — se
 * confirma a mano (ipconfig / Get-NetIPAddress, la interfaz que tiene ruta
 * a la OLT) y se pasa explicitamente con --set.
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';
import { runTelnetCommands } from '../src/telnet/client';
import { setTr069AcsCommands } from '../src/ssh/zteCommands';

interface Args {
  set: string | null;
  apply: boolean;
  yes: boolean;
  only: string | null;
  nbi: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { set: null, apply: false, yes: false, only: null, nbi: 'http://localhost:7557' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--set') args.set = argv[(i += 1)];
    else if (a === '--apply') args.apply = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--only') args.only = argv[(i += 1)];
    else if (a === '--nbi') args.nbi = argv[(i += 1)];
  }
  return args;
}

interface AcsProfileRow {
  id: string;
  olt_device_id: string;
  profile_name: string;
  acs_url: string;
  is_default: boolean;
}

interface OntRow {
  id: string;
  olt_device_id: string;
  frame: number;
  slot: number;
  port: number;
  ont_id: number;
  serial: string;
  description: string | null;
  tr069_acs_url: string | null;
}

async function fetchGenieAcsDevices(nbiUrl: string): Promise<Array<{ _id: string; _lastInform?: string }> | null> {
  try {
    const res = await fetch(`${nbiUrl}/devices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Array<{ _id: string; _lastInform?: string }>;
  } catch (e) {
    console.warn(`  (no se pudo consultar GenieACS en ${nbiUrl}: ${e instanceof Error ? e.message : e})`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('=== Perfiles ACS por defecto (olt_tr069_acs_profiles) ===');
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from('olt_tr069_acs_profiles')
    .select('id, olt_device_id, profile_name, acs_url, is_default')
    .returns<AcsProfileRow[]>();
  if (profErr) throw new Error(profErr.message);
  if (!profiles?.length) console.log('  (ninguno)');
  for (const p of profiles ?? []) {
    console.log(`  ${p.is_default ? '[default] ' : ''}${p.profile_name}: ${p.acs_url}`);
  }

  console.log('\n=== ONTs con TR-069 habilitado (olt_onts) ===');
  const { data: onts, error: ontErr } = await supabaseAdmin
    .from('olt_onts')
    .select('id, olt_device_id, frame, slot, port, ont_id, serial, description, tr069_acs_url')
    .eq('tr069_enabled', true)
    .returns<OntRow[]>();
  if (ontErr) throw new Error(ontErr.message);
  if (!onts?.length) console.log('  (ninguna)');
  for (const o of onts ?? []) {
    console.log(`  ${o.description ?? o.serial} (${o.serial}, ${o.frame}/${o.slot}/${o.port}:${o.ont_id}) -> ${o.tr069_acs_url}`);
  }

  console.log(`\n=== Dispositivos registrados en GenieACS (${args.nbi}) ===`);
  const devices = await fetchGenieAcsDevices(args.nbi);
  if (devices) {
    if (!devices.length) console.log('  (ninguno)');
    for (const d of devices) console.log(`  ${d._id} — ultimo inform: ${d._lastInform ?? 'nunca'}`);
  }

  if (!args.set) {
    console.log('\nSolo diagnostico (sin --set). Pasa --set http://<ip-actual>:7547 para ver/aplicar la correccion.');
    return;
  }

  console.log(`\n=== Plan de correccion: ACS URL -> ${args.set} ===`);
  const staleProfiles = (profiles ?? []).filter((p) => p.acs_url !== args.set);
  const staleOnts = (onts ?? []).filter((o) => o.tr069_acs_url !== args.set && (!args.only || o.id === args.only));
  console.log(`  Perfiles a actualizar: ${staleProfiles.length}`);
  console.log(`  ONTs a reconfigurar via Telnet: ${staleOnts.length}${args.only ? ` (limitado a ${args.only})` : ''}`);

  if (!args.apply || !args.yes) {
    console.log(
      args.apply
        ? '\n--apply requiere tambien --yes (confirmacion explicita antes de escribir en la OLT real). Nada se modifico.'
        : '\nDry-run (sin --apply). Nada se modifico.',
    );
    return;
  }

  for (const p of staleProfiles) {
    const { error } = await supabaseAdmin.from('olt_tr069_acs_profiles').update({ acs_url: args.set }).eq('id', p.id);
    if (error) console.error(`  ERROR actualizando perfil ${p.profile_name}: ${error.message}`);
    else console.log(`  OK perfil ${p.profile_name} -> ${args.set}`);
  }

  // Secuencial a proposito, aunque varias ONTs compartan la misma OLT: ver
  // feedback_olt_no_concurrent_telnet (nunca Promise.all contra el mismo equipo).
  const deviceCache = new Map<string, { host: string; telnet_port: number; username: string; password: string }>();
  for (const o of staleOnts) {
    let device = deviceCache.get(o.olt_device_id);
    if (!device) {
      const { data, error } = await supabaseAdmin
        .from('olt_devices')
        .select('host, telnet_port, username, password')
        .eq('id', o.olt_device_id)
        .single();
      if (error || !data) {
        console.error(`  ERROR: OLT ${o.olt_device_id} no encontrada (${error?.message})`);
        continue;
      }
      device = data;
      deviceCache.set(o.olt_device_id, device);
    }

    const target = { host: device.host, port: device.telnet_port, username: device.username, password: device.password };
    const ref = { shelf: o.frame, slot: o.slot, port: o.port };
    console.log(`  Aplicando a ${o.description ?? o.serial} (${o.serial})...`);
    try {
      await runTelnetCommands(target, setTr069AcsCommands(ref, o.ont_id, 1, args.set), { timeoutMs: 25000 });
      const { error } = await supabaseAdmin.from('olt_onts').update({ tr069_acs_url: args.set }).eq('id', o.id);
      if (error) throw new Error(error.message);
      console.log('    OK');
    } catch (e) {
      console.error(`    ERROR: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log('\nListo. Espera unos segundos y vuelve a correr sin --set para confirmar que las ONTs aparecen en GenieACS.');
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
