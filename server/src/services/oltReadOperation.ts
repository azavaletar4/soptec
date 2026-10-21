import type { MiddlewareHandler } from 'hono';
import { runTelnetCommands } from '../telnet/client';
import { telnetTargetFor, type OltDeviceRow } from '../lib/oltDevice';
import { withOltLock } from './oltTelnetLock';

const operations = new Set<string>();
export const isOltReadOperationRunning = (id: string) => operations.has(id);
export function beginOltReadOperation(id: string): (() => void) | null {
  if (operations.has(id)) return null;
  operations.add(id);
  return () => operations.delete(id);
}
// Protect logical scans as well as the individual Telnet sessions. One process only.
export const guardOltReadOperation: MiddlewareHandler = async (c, next) => {
  const release = beginOltReadOperation(c.req.param('id')!);
  if (!release) return c.json({error:'Ya hay una lectura o importación de esta OLT en curso.'},409);
  try { await next(); } finally { release(); }
};

export function createOltReadBudget(device: OltDeviceRow, milliseconds = 150000) {
  const deadline = Date.now() + milliseconds, signal = AbortSignal.timeout(milliseconds);
  return { signal, read: (commands: string[], timeoutMs: number) => withOltLock(device.id, () => {
    const remaining = deadline - Date.now();
    if (remaining < 100 || signal.aborted) throw Error('Presupuesto de lectura OLT agotado.');
    return runTelnetCommands(telnetTargetFor(device), commands, { timeoutMs: Math.min(remaining, timeoutMs) });
  }, { signal }) };
}
