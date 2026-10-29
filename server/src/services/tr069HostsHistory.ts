import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeHostMac } from '../../../src/lib/tr069Hosts';
import type { HostEntry, HostsInventory } from '../../../src/lib/tr069Hosts';

type HistoryRecord = { entry: HostEntry; lastSeenAt: string };
type HistoryMap = Record<string, HistoryRecord>;

// Un fantasma que el equipo no vuelve a reportar en este plazo deja de
// mostrarse — evita acumular para siempre un dispositivo que claramente no
// va a volver (router reemplazado, vecino que se mudó, etc.).
export const HOSTS_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000;
// Límite defensivo del historial "solo conocido" (nunca de los hosts en vivo,
// que el propio equipo ya acota); evita una lista sin control por acumulación.
export const HOSTS_HISTORY_MAX_GHOSTS = 64;

function historyFile(directory: string, deviceId: string): string {
  const hash = crypto.createHash('sha256').update(deviceId).digest('hex');
  return path.join(directory, hash + '.hosts-history.json');
}

function load(file: string): HistoryMap {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as HistoryMap : {};
  } catch {
    return {};
  }
}

function save(file: string, map: HistoryMap) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(map), { mode: 0o600 });
  fs.renameSync(temp, file);
}

/**
 * Conserva visibles los dispositivos ya conocidos cuando el propio equipo
 * deja de reportarlos (p. ej. su entrada DHCP/ARP caducó y el CPE retiró la
 * instancia Hosts.{i}) — nunca lo confunde con una desconexión confirmada:
 * jamás inventa un valor nuevo, solo conserva tal cual la última lectura real
 * de ese host. `hostStatusLabel`/`hostConnectionLabel` ya resuelven solos a
 * «Sin confirmar» para datos viejos (ver src/lib/tr069Hosts.ts); esta función
 * únicamente decide qué dispositivos permanecen en la lista.
 *
 * Solo lectura/escritura de un archivo local propio (nunca TR-069 ni GenieACS).
 * Un host sin MAC no se puede identificar de forma estable entre lecturas:
 * se devuelve tal cual en esta respuesta, pero no se recuerda si desaparece.
 */
export function applyHostsHistory(
  inventory: HostsInventory,
  directory: string,
  now: () => number = Date.now,
): HostsInventory {
  if (!inventory.found || !inventory.deviceId) return inventory;
  const file = historyFile(directory, inventory.deviceId);
  const history = load(file);
  const liveMacs = new Set<string>();
  for (const host of inventory.hosts) {
    const mac = normalizeHostMac(host.macAddress);
    if (!mac) continue;
    liveMacs.add(mac);
    history[mac] = { entry: host, lastSeenAt: new Date(now()).toISOString() };
  }
  const cutoff = now() - HOSTS_HISTORY_RETENTION_MS;
  const ghostMacs: string[] = [];
  for (const [mac, record] of Object.entries(history)) {
    if (liveMacs.has(mac)) continue;
    if (!Number.isFinite(Date.parse(record.lastSeenAt)) || Date.parse(record.lastSeenAt) < cutoff) { delete history[mac]; continue; }
    ghostMacs.push(mac);
  }
  ghostMacs.sort((a, b) => history[b]!.lastSeenAt.localeCompare(history[a]!.lastSeenAt));
  for (const mac of ghostMacs.slice(HOSTS_HISTORY_MAX_GHOSTS)) delete history[mac];
  const ghosts = ghostMacs.slice(0, HOSTS_HISTORY_MAX_GHOSTS).map(mac => history[mac]!.entry);
  save(file, history);
  return { ...inventory, hosts: [...inventory.hosts, ...ghosts] };
}
