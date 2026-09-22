/**
 * Encola (via la API NBI de GenieACS) un cambio de usuario/contrasena PPPoE
 * en el WANPPPConnection real de una ONT, sin depender de la interfaz web
 * de GenieACS (confusa) ni de un "Connection Request" en vivo — este
 * laptop no tiene ruta hacia las IPs que la OLT reparte a los clientes
 * (solo hacia la propia OLT), asi que GenieACS marca los equipos como
 * "offline" para eso aunque esten conectados. La tarea igual se aplica
 * sola en el siguiente Inform periodico del equipo (CPE-iniciado, ese
 * sentido si funciona).
 *
 * Uso (desde la raiz del repo, para que dotenv encuentre el .env):
 *
 *   npx tsx server/scripts/set-tr069-pppoe.ts --client <client_id> --username <u> [--password <p>]
 *   npx tsx server/scripts/set-tr069-pppoe.ts --ont <olt_onts.id> --username <u> --password <p>
 *   npx tsx server/scripts/set-tr069-pppoe.ts --serial <numero_de_serie> --password <p>
 *     Dry-run por defecto: localiza la ONT, el dispositivo en GenieACS y
 *     el WANPPPConnection real, y muestra que cambiaria. No escribe nada
 *     hasta agregar --apply --yes (ambos requeridos a proposito).
 *
 *   ... --apply --yes
 *     Encola de verdad el/los cambios (setParameterValues). Se aplican
 *     solos en el proximo Inform del equipo — no es instantaneo.
 *
 * Identifica la ONT por --client (id de clients), --ont (id de olt_onts) o
 * --serial (numero de serie); usa el que ya tengas a mano.
 */
import 'dotenv/config';
import { supabaseAdmin } from '../src/lib/supabaseAdmin';

interface Args {
  client: string | null;
  ont: string | null;
  serial: string | null;
  username: string | null;
  password: string | null;
  apply: boolean;
  yes: boolean;
  nbi: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { client: null, ont: null, serial: null, username: null, password: null, apply: false, yes: false, nbi: 'http://localhost:7557' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--client') args.client = argv[(i += 1)];
    else if (a === '--ont') args.ont = argv[(i += 1)];
    else if (a === '--serial') args.serial = argv[(i += 1)];
    else if (a === '--username') args.username = argv[(i += 1)];
    else if (a === '--password') args.password = argv[(i += 1)];
    else if (a === '--apply') args.apply = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--nbi') args.nbi = argv[(i += 1)];
  }
  return args;
}

interface OntRow {
  id: string;
  serial: string;
  description: string | null;
  client_id: string | null;
  tr069_enabled: boolean;
}

interface GenieAcsParam {
  _value?: unknown;
  _writable?: boolean;
  [child: string]: unknown;
}

function findWanPppConnectionPaths(root: GenieAcsParam): string[] {
  const found: string[] = [];
  function walk(obj: GenieAcsParam, path: string) {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      const val = obj[key] as GenieAcsParam;
      if (!val || typeof val !== 'object') continue;
      const newPath = path ? `${path}.${key}` : key;
      if (key === 'WANPPPConnection') {
        for (const instance of Object.keys(val)) {
          if (instance.startsWith('_')) continue;
          found.push(`${newPath}.${instance}`);
        }
        continue;
      }
      if (!('_value' in val)) walk(val, newPath);
    }
  }
  walk(root, '');
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.client && !args.ont && !args.serial) {
    throw new Error('Pasa --client <id>, --ont <olt_onts.id> o --serial <numero_de_serie> para identificar la ONT');
  }
  if (!args.username && !args.password) {
    throw new Error('Pasa --username y/o --password (al menos uno)');
  }

  let query = supabaseAdmin.from('olt_onts').select('id, serial, description, client_id, tr069_enabled');
  if (args.ont) query = query.eq('id', args.ont);
  else if (args.serial) query = query.eq('serial', args.serial);
  else query = query.eq('client_id', args.client as string);
  const { data: onts, error: ontErr } = await query.returns<OntRow[]>();
  if (ontErr) throw new Error(ontErr.message);
  if (!onts?.length) throw new Error('No se encontro ninguna ONT con ese criterio');
  if (onts.length > 1) {
    console.log('Hay mas de una ONT con ese criterio, usa --ont con el id exacto:');
    for (const o of onts) console.log(`  ${o.id} — ${o.description ?? o.serial} (${o.serial})`);
    return;
  }
  const ont = onts[0];
  console.log(`ONT: ${ont.description ?? ont.serial} (serie ${ont.serial})`);
  if (!ont.tr069_enabled) {
    console.log('AVISO: esta ONT no tiene tr069_enabled=true en olt_onts (puede que TR-069 nunca se le haya asignado).');
  }

  console.log(`\nBuscando en GenieACS (${args.nbi}) por numero de serie...`);
  const devRes = await fetch(`${args.nbi}/devices/?query=${encodeURIComponent(JSON.stringify({ '_deviceId._SerialNumber': ont.serial }))}`);
  if (!devRes.ok) throw new Error(`GenieACS respondio HTTP ${devRes.status} al buscar el dispositivo`);
  const devices = (await devRes.json()) as Array<GenieAcsParam & { _id: string; _lastInform?: string }>;
  if (!devices.length) {
    console.log('No aparece ningun dispositivo en GenieACS con esa serie todavia (nunca informo, o el ACS URL esta mal).');
    console.log('Revisa primero con: npm run tr069:fix-acs');
    return;
  }
  const device = devices[0];
  console.log(`Dispositivo GenieACS: ${device._id} (ultimo inform: ${device._lastInform ?? 'nunca'})`);

  const igd = (device.InternetGatewayDevice ?? device.Device) as GenieAcsParam | undefined;
  const paths = igd ? findWanPppConnectionPaths(igd).map((p) => (device.InternetGatewayDevice ? `InternetGatewayDevice.${p}` : `Device.${p}`)) : [];
  if (!paths.length) {
    console.log(
      '\nNo se encontro ningun WANPPPConnection en el arbol conocido de este dispositivo todavia ' +
        '(la primera conexion de un CPE solo informa un set minimo de parametros).',
    );
    console.log('Encolando un refreshObject sobre WANConnectionDevice para descubrirlo en el proximo Inform...');
    if (args.apply && args.yes) {
      const objectName = device.InternetGatewayDevice
        ? 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1'
        : 'Device.IP.Interface.1';
      const res = await fetch(`${args.nbi}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'refreshObject', objectName }),
      });
      console.log(res.ok ? '  Encolado. Vuelve a correr este script en unos minutos.' : `  ERROR: HTTP ${res.status}`);
    } else {
      console.log('  (dry-run: pasa --apply --yes para encolarlo de verdad)');
    }
    return;
  }
  if (paths.length > 1) {
    console.log(`\nOJO: se encontraron ${paths.length} objetos WANPPPConnection, se usara el primero: ${paths[0]}`);
  }
  const basePath = paths[0];
  console.log(`\nWANPPPConnection encontrado: ${basePath}`);

  const parameterValues: [string, string, string][] = [];
  if (args.username) parameterValues.push([`${basePath}.Username`, args.username, 'xsd:string']);
  if (args.password) parameterValues.push([`${basePath}.Password`, args.password, 'xsd:string']);

  console.log('\n=== Cambios a encolar ===');
  for (const [path, value] of parameterValues) console.log(`  ${path} = ${path.endsWith('.Password') ? '(oculto)' : value}`);

  if (!args.apply || !args.yes) {
    console.log(args.apply ? '\n--apply requiere tambien --yes. Nada se modifico.' : '\nDry-run (sin --apply). Nada se modifico.');
    return;
  }

  const res = await fetch(`${args.nbi}/devices/${encodeURIComponent(device._id)}/tasks?connection_request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'setParameterValues', parameterValues }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GenieACS respondio HTTP ${res.status}: ${JSON.stringify(body)}`);
  console.log(`\nOK, tarea encolada (${(body as { _id?: string })._id ?? 'sin id'}).`);
  console.log('Se aplicara sola en el proximo Inform del equipo (no es instantaneo — este laptop no tiene');
  console.log('connection request hacia la red de clientes, ver memoria del proyecto TR-069).');
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
