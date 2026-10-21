import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface SignalReference { identity: string; rx: number; at: number }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Dedicated local evidence. Legacy olt_onts/last_synced_at cannot prove serial attribution.
export function loadSignalCheckpoint(path: string): Map<string, SignalReference> {
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.length > 8 * 1024 * 1024) throw Error('checkpoint too large');
    const envelope = JSON.parse(raw);
    if (envelope.version !== 1 || typeof envelope.payload !== 'string' || hash(envelope.payload) !== envelope.sha256) throw Error('invalid checkpoint');
    const entries = JSON.parse(envelope.payload);
    if (!Array.isArray(entries)) throw Error('invalid entries');
    const result = new Map<string, SignalReference>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) throw Error('invalid entry');
      const [id, value] = entry;
      if (typeof id !== 'string' || !id || result.has(id) || !value || typeof value.identity !== 'string' || !value.identity || !Number.isFinite(value.rx) || !Number.isFinite(value.at)) throw Error('invalid reference');
      result.set(id, { identity: value.identity, rx: value.rx, at: value.at });
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[olt-signal-checkpoint] No se pudo verificar el checkpoint; no se reutilizaron referencias.');
    return new Map();
  }
}
export function saveSignalCheckpoint(path: string, references: Map<string, SignalReference>) {
  const payload = JSON.stringify([...references]);
  const data = JSON.stringify({ version: 1, sha256: hash(payload), payload });
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  // Persist the rename on Linux; Windows does not support fsync of a directory.
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
