// Integracion con el panel XUI.one (IPTV) del ISP, corriendo en
// http://172.168.1.253/RaycoAlex. XUI.one no expone una API REST formal
// para gestion de lineas (solo player_api.php, que es para los clientes
// finales/reproductores) — el panel admin usa AJAX contra su propio HTML:
//   - POST {base}/login              -> autenticacion (cookie PHPSESSID)
//   - POST {base}/table (id=lines)   -> listado/busqueda de lineas (DataTables server-side)
//   - GET  {base}/line?id=X          -> formulario de edicion (HTML) de una linea existente
//   - GET  {base}/api?action=line&sub=<enable|disable|ban|unban|kill|delete>&user_id=X
//   - POST {base}/post.php?action=line&referer=<line?id=X o vacio> -> crear/editar linea
//
// Por eso este servicio scrapea HTML en vez de llamar una API tipada. Para
// evitar borrar datos de un cliente real al editar, saveLine() SIEMPRE parte
// del estado actual de la linea (getLine) y solo pisa los campos que el
// caller pide cambiar — igual que hace el propio formulario del panel.

const BASE_URL = (process.env.XUI_BASE_URL || '').replace(/\/+$/, '');
const XUI_USER = process.env.XUI_USERNAME || '';
const XUI_PASS = process.env.XUI_PASSWORD || '';

const SESSION_TTL_MS = 10 * 60 * 1000;

let cachedCookie: string | null = null;
let cachedAt = 0;
let loginPromise: Promise<string> | null = null;

function assertConfigured() {
  if (!BASE_URL || !XUI_USER || !XUI_PASS) {
    throw new Error('XUI no configurado: definir XUI_BASE_URL, XUI_USERNAME y XUI_PASSWORD en el .env del backend');
  }
}

async function doLogin(): Promise<string> {
  assertConfigured();

  const getRes = await fetch(`${BASE_URL}/login`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  const initialCookie = getRes.headers.get('set-cookie')?.match(/PHPSESSID=[^;]+/)?.[0];
  if (!initialCookie) throw new Error('XUI: no se pudo iniciar sesion (sin cookie en /login)');

  const form = new URLSearchParams({ username: XUI_USER, password: XUI_PASS, referrer: '', login: 'Login' });
  const postRes = await fetch(`${BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: initialCookie },
    body: form.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  const location = postRes.headers.get('location');
  if (postRes.status !== 302 || !location || location.includes('login')) {
    throw new Error('XUI: login rechazado (usuario/password invalidos)');
  }

  cachedCookie = initialCookie;
  cachedAt = Date.now();
  return initialCookie;
}

async function getSessionCookie(forceLogin = false): Promise<string> {
  if (!forceLogin && cachedCookie && Date.now() - cachedAt < SESSION_TTL_MS) return cachedCookie;
  if (!loginPromise) loginPromise = doLogin().finally(() => (loginPromise = null));
  return loginPromise;
}

/** Ejecuta una peticion autenticada; si la sesion expiro (redirige a /login) reintenta una vez. */
async function xuiFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<string> {
  const cookie = await getSessionCookie(attempt > 0);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (attempt === 0 && (text.includes('XUI | Login') || text.includes('name="login"'))) {
    return xuiFetch(path, init, attempt + 1);
  }
  return text;
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

export interface XuiLineSummary {
  id: number;
  username: string;
  password: string;
  owner: string;
  status: string | null;
  maxConnections: string;
  expiration: string | null;
  lastConnection: string | null;
}

/** Busca lineas por username (o parte de el) via el listado server-side del panel. */
export async function findLinesByUsername(search: string, limit = 25): Promise<XuiLineSummary[]> {
  const body = new URLSearchParams({
    id: 'lines',
    draw: '1',
    start: '0',
    length: String(limit),
    'search[value]': search,
  });
  const text = await xuiFetch('/table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  let json: { data?: string[][] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('XUI: respuesta inesperada al buscar lineas (revisar sesion/credenciales)');
  }

  return (json.data ?? []).map((cols) => {
    const idMatch = cols[0]?.match(/id=(\d+)/);
    const statusMatch = cols[4]?.match(/title="([^"]+)"/);
    return {
      id: idMatch ? Number(idMatch[1]) : 0,
      username: stripTags(cols[1] ?? ''),
      password: stripTags(cols[2] ?? ''),
      owner: stripTags(cols[3] ?? ''),
      status: statusMatch ? statusMatch[1] : null,
      maxConnections: stripTags(cols[9] ?? ''),
      expiration: cols[10]?.includes('infin') ? null : stripTags(cols[10] ?? ''),
      lastConnection: stripTags(cols[11] ?? '') || null,
    };
  });
}

export interface XuiBouquet {
  id: number;
  name: string;
  streamCount: number;
}

// A diferencia de /table (server-side, DataTables), /bouquets renderiza la
// tabla completa en el HTML (DataTable client-side sin ajax) — no hay
// endpoint JSON, asi que se parsean las filas <tr id="bouquet-N"> del tbody.
export async function listBouquets(): Promise<XuiBouquet[]> {
  const html = await xuiFetch('/bouquets');
  const rows = [...html.matchAll(/<tr id="bouquet-(\d+)">[\s\S]*?<td>([^<]+)<\/td>[\s\S]*?>(\d+)<\/button>/g)];
  return rows.map((r) => ({ id: Number(r[1]), name: stripTags(r[2]), streamCount: Number(r[3]) }));
}

// Campos del formulario de linea que se preservan al editar (ver comentario de arriba).
const LINE_FORM_FIELDS = ['username', 'password', 'exp_date', 'max_connections', 'contact', 'isp_clear', 'access_token', 'bouquets_selected'] as const;
const LINE_FORM_SELECT_FIELDS = ['member_id', 'force_server_id', 'forced_country'] as const;
const LINE_FORM_CHECKBOXES = ['no_expire', 'is_stalker', 'is_restreamer', 'is_trial', 'is_isplock', 'bypass_ua'] as const;

export interface XuiLineForm {
  id?: number;
  username: string;
  password: string;
  member_id: string;
  exp_date: string;
  max_connections: string;
  contact: string;
  force_server_id: string;
  isp_clear: string;
  access_token: string;
  forced_country: string;
  bouquets_selected: string;
  no_expire: boolean;
  is_stalker: boolean;
  is_restreamer: boolean;
  is_trial: boolean;
  is_isplock: boolean;
  bypass_ua: boolean;
  access_output: string[];
}

function extractInputValue(html: string, name: string): string {
  const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const alt = new RegExp(`id="${name}"[^>]*value="([^"]*)"`, 'i');
  return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? '';
}

// member_id, force_server_id y forced_country son <select>, no <input> — no
// tienen "value" en la etiqueta, el valor esta en <option selected value="...">
// dentro del bloque. extractInputValue no los puede leer (bug real: hacia
// que cada edicion reescribiera estos campos como "", rompiendo en cascada
// otros campos del guardado — ver comentario en saveLine).
function extractSelectValue(html: string, name: string): string {
  const block = html.match(new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)<\\/select>`, 'i'))?.[1];
  if (!block) return '';
  const selected = block.match(/<option selected(?:="selected")? value="([^"]*)"/) ?? block.match(/<option value="([^"]*)" selected/);
  return selected?.[1] ?? '';
}

function extractChecked(html: string, name: string): boolean {
  const re = new RegExp(`name="${name}"[^>]*checked`, 'i');
  return re.test(html);
}

/** Trae el estado actual de una linea existente parseando su formulario de edicion. */
export async function getLineForm(id: number): Promise<XuiLineForm> {
  const html = await xuiFetch(`/line?id=${id}`);
  if (!html.includes(`onClick="editModal(event, 'line', ${id}`) && !html.includes('id="bouquets_selected"')) {
    throw new Error(`XUI: linea ${id} no encontrada`);
  }

  const form: Record<string, string> = {};
  for (const field of LINE_FORM_FIELDS) form[field] = extractInputValue(html, field);
  for (const field of LINE_FORM_SELECT_FIELDS) form[field] = extractSelectValue(html, field);

  return {
    id,
    username: form.username,
    password: form.password,
    member_id: form.member_id,
    exp_date: form.exp_date,
    max_connections: form.max_connections,
    contact: form.contact,
    force_server_id: form.force_server_id,
    isp_clear: form.isp_clear,
    access_token: form.access_token,
    forced_country: form.forced_country,
    bouquets_selected: form.bouquets_selected,
    no_expire: extractChecked(html, 'no_expire'),
    is_stalker: extractChecked(html, 'is_stalker'),
    is_restreamer: extractChecked(html, 'is_restreamer'),
    is_trial: extractChecked(html, 'is_trial'),
    is_isplock: extractChecked(html, 'is_isplock'),
    bypass_ua: extractChecked(html, 'bypass_ua'),
    access_output: ['1', '2', '3'].filter((v) => extractChecked(html, `access_output_${v}`) || html.includes(`id="access_output_${v}"`)),
  };
}

const STATUS_NAMES = [
  'STATUS_FAILURE',
  'STATUS_SUCCESS',
  'STATUS_SUCCESS_MULTI',
  'STATUS_CODE_LENGTH',
  'STATUS_NO_SOURCES',
  'STATUS_DISABLED',
  'STATUS_NOT_ADMIN',
  'STATUS_INVALID_EMAIL',
  'STATUS_INVALID_PASSWORD',
  'STATUS_INVALID_IP',
  'STATUS_INVALID_PLAYLIST',
  'STATUS_INVALID_NAME',
  'STATUS_INVALID_CAPTCHA',
  'STATUS_INVALID_CODE',
  'STATUS_INVALID_DATE',
  'STATUS_INVALID_FILE',
  'STATUS_INVALID_GROUP',
  'STATUS_INVALID_DATA',
  'STATUS_INVALID_DIR',
  'STATUS_INVALID_MAC',
  'STATUS_EXISTS_CODE',
  'STATUS_EXISTS_NAME',
  'STATUS_EXISTS_USERNAME',
  'STATUS_EXISTS_MAC',
  'STATUS_EXISTS_SOURCE',
  'STATUS_EXISTS_IP',
  'STATUS_EXISTS_DIR',
  'STATUS_SUCCESS_REPLACE',
  'STATUS_FLUSH',
  'STATUS_TOO_MANY_RESULTS',
  'STATUS_SPACE_ISSUE',
  'STATUS_INVALID_USER',
];

export interface SaveLineOverrides {
  username?: string;
  password?: string;
  expDate?: string; // 'YYYY-MM-DD HH:MM:SS', ignorado si noExpire=true
  noExpire?: boolean;
  maxConnections?: string;
  contact?: string;
  bouquetIds?: number[]; // canales a asignar (ver listBouquets); por defecto se preservan los actuales
  forceServerId?: string; // '0' = Disabled, '1' = Main Server (ver select del formulario)
}

/**
 * Crea (id=null) o edita (id) una linea, preservando todo lo que no venga en
 * overrides. Para editar, primero lee el estado actual (getLineForm) y solo
 * pisa los campos indicados — asi una renovacion de vencimiento no borra
 * bouquets/config existentes de un cliente real.
 */
export async function saveLine(id: number | null, overrides: SaveLineOverrides): Promise<{ id: number | null; status: string }> {
  const base: XuiLineForm = id
    ? await getLineForm(id)
    : {
        username: '',
        password: '',
        member_id: '',
        exp_date: '',
        max_connections: '1',
        contact: '',
        force_server_id: '0',
        isp_clear: '',
        access_token: '',
        forced_country: '',
        bouquets_selected: '',
        no_expire: false,
        is_stalker: false,
        is_restreamer: false,
        is_trial: false,
        is_isplock: false,
        bypass_ua: false,
        access_output: ['1', '2', '3'],
      };

  // XUI no devuelve el id de la linea creada en la respuesta del POST (ver
  // mas abajo) — solo la forma de recuperarlo es buscarla por username
  // despues, asi que si va a crear una linea necesitamos un username propio
  // (no podemos dejar que XUI lo autogenere y despues no saber cual eligio).
  const requestedUsername = overrides.username?.trim();
  const username = requestedUsername || base.username || (id ? '' : generateLineUsername());

  // Al editar, XUI valida "username ya existe" SIN excluir la propia linea
  // (probado: reenviar el mismo username sin cambios rechaza el guardado
  // con STATUS_EXISTS_USERNAME incluso en lineas reales ya existentes) — asi
  // que si no se pide cambiar el username, el campo se omite del POST.
  const usernameChanged = !id || (!!requestedUsername && requestedUsername !== base.username);

  const merged: XuiLineForm = {
    ...base,
    username,
    password: overrides.password ?? base.password,
    max_connections: overrides.maxConnections ?? base.max_connections,
    contact: overrides.contact ?? base.contact,
    bouquets_selected: overrides.bouquetIds ? JSON.stringify(overrides.bouquetIds) : base.bouquets_selected,
    force_server_id: overrides.forceServerId ?? base.force_server_id,
    no_expire: overrides.noExpire ?? base.no_expire,
    exp_date: overrides.noExpire ? '' : (overrides.expDate ?? base.exp_date),
  };

  const form = new URLSearchParams();
  if (usernameChanged) form.set('username', merged.username);
  form.set('password', merged.password);
  form.set('member_id', merged.member_id);
  form.set('exp_date', merged.exp_date);
  if (merged.no_expire) form.set('no_expire', 'on');
  form.set('max_connections', merged.max_connections);
  form.set('contact', merged.contact);
  form.set('force_server_id', merged.force_server_id);
  if (merged.is_stalker) form.set('is_stalker', 'on');
  if (merged.is_restreamer) form.set('is_restreamer', 'on');
  if (merged.is_trial) form.set('is_trial', 'on');
  if (merged.is_isplock) form.set('is_isplock', 'on');
  form.set('isp_clear', merged.isp_clear);
  form.set('access_token', merged.access_token);
  form.set('forced_country', merged.forced_country);
  for (const v of merged.access_output) form.append('access_output[]', v);
  if (merged.bypass_ua) form.set('bypass_ua', 'on');
  form.set('bouquets_selected', merged.bouquets_selected);
  form.set('submit_line', id ? 'Edit' : 'Add');
  if (id) form.set('edit', '1');

  const referer = id ? `line?id=${id}` : '';
  const text = await xuiFetch(`/post.php?action=line&referer=${encodeURIComponent(referer)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  let json: { status?: number; location?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('XUI: respuesta inesperada al guardar la linea');
  }

  const statusName = json.status !== undefined ? (STATUS_NAMES[json.status] ?? `STATUS_${json.status}`) : 'UNKNOWN';
  if (json.status !== 1 && json.status !== 2) {
    throw new Error(`XUI: no se pudo guardar la linea (${statusName})`);
  }

  // Al crear, XUI solo devuelve {location: "lines?status=1"} (sin id) — hay
  // que resolverlo buscando la linea recien creada por su username exacto.
  let newId: number | null = id;
  if (!newId) {
    const matches = await findLinesByUsername(merged.username);
    newId = matches.find((l) => l.username.toLowerCase() === merged.username.toLowerCase())?.id ?? null;
  }
  return { id: newId, status: statusName };
}

function generateLineUsername(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 10; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return `sr_${suffix}`;
}

export type XuiLineAction = 'enable' | 'disable' | 'ban' | 'unban' | 'kill' | 'delete';

/** Acciones puntuales que no tocan el resto de la linea (activar/suspender/banear/matar conexiones). */
export async function performLineAction(id: number, action: XuiLineAction): Promise<void> {
  const text = await xuiFetch(`/api?action=line&sub=${action}&user_id=${id}`);
  let json: { result?: boolean };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`XUI: respuesta inesperada al ejecutar '${action}' sobre la linea ${id}`);
  }
  if (json.result !== true) {
    throw new Error(`XUI: la accion '${action}' fallo sobre la linea ${id}`);
  }
}
