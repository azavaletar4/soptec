import type { Socket } from 'node:net';
import { startFakeOlt, TEST_PROMPT } from '../../telnet/__tests__/fakeOltServer';

/**
 * Mini simulador de la CLI de la ZXA10 C300 (encima del login/negociacion
 * IAC ya probado en la Fase 1, ver telnet/__tests__/fakeOltServer.ts) — solo
 * entiende la secuencia de comandos real que manda registerOntCommands() y
 * los "show" de solo lectura YA CONFIRMADOS contra el equipo real (ver
 * zteCommands.ts). Mantiene un registro en memoria de las ONUs "dadas de
 * alta" para que un escaneo posterior (en una conexion NUEVA, como hace el
 * motor real: cada runTelnetCommands() abre su propia conexion) refleje lo
 * que se escribio antes.
 *
 * A proposito NO modela "show running-config interface gpon-olt_S/L/P"
 * (portRunningConfigCommand en zteCommands.ts) — esa sintaxis nunca se
 * confirmo contra el equipo real (ver advertencia ahi mismo), asi que este
 * simulador la trata como cualquier otro comando NO reconocido: la rechaza
 * (ver el `default` mas abajo), igual que haria una CLI real con algo que
 * no entiende. Si algun dia se confirma el formato real, se agrega aqui a
 * proposito, con evidencia.
 */
export interface FakeOltCliEntry {
  onuType: string;
  serial: string;
  description: string;
  tcontProfile?: string;
  trafficProfile?: string;
  vlan?: number;
  serviceGemport?: number;
  serviceVlan?: number;
}

export type InterceptResult =
  | { action: 'reject'; message: string }
  | { action: 'hang' }
  | { action: 'close' }
  | { action: 'closeAfterApply' }
  | { action: 'customResponse'; text: string }
  | null
  | undefined;

export interface FakeOltCliOptions {
  initialEntries?: Record<string, FakeOltCliEntry>;
  /**
   * Se llama con CADA linea de comando antes de mandar su respuesta —
   * {action:'reject'} simula un rechazo CLI real a mitad de secuencia (el
   * efecto de esa linea NO se aplica); {action:'hang'} nunca responde
   * (timeout real); {action:'close'} cierra la conexion SIN aplicar el
   * efecto de esa linea (igual que antes de que el comando llegara a
   * procesarse); {action:'closeAfterApply'} SI aplica el efecto normal de
   * la linea (ej. de verdad registra la ONU) pero la conexion se cierra
   * ANTES de que la confirmacion vuelva — simula que el comando SI llego a
   * la OLT real y se aplico, solo que la respuesta nunca volvio. Devolver
   * null/undefined deja el comportamiento normal del simulador.
   */
  intercept?: (line: string) => InterceptResult;
  /** Cada linea de comando recibida, en orden — para que el test cuente cuantas veces se escribio de verdad. */
  onCommand?: (line: string) => void;
  /**
   * Al RENDERIZAR running-config (nunca al guardar internamente), fuerza
   * estos campos a un valor distinto del realmente aplicado — simula que la
   * OLT real termino con una configuracion diferente de la pedida (ej. un
   * firmware que redondea/trunca un valor), para probar que la verificacion
   * posterior lo detecta en vez de asumir exito.
   */
  renderOverride?: Partial<{ onuType: string; vlan: number; tcontProfile: string; trafficProfile: string }>;
  /**
   * Claves ("shelf/slot/port:onuId") que existen en `entries` pero se
   * OMITEN de "show gpon onu state" (nunca de "show running-config") — para
   * simular una ONU que esta configurada pero que el escaneo de ESTADO no
   * reporta (ej. offline en ese momento). Prueba que resolveFreeOnuId()
   * combine ambas fuentes en vez de confiar solo en el escaneo de estado.
   */
  omitFromStateScan?: string[];
}

type Mode = 'top' | 'config' | 'if-olt' | 'if-onu' | 'if-mng';

export function startFakeOltCli(opts: FakeOltCliOptions = {}) {
  const entries = new Map<string, FakeOltCliEntry>(Object.entries(opts.initialEntries ?? {}));
  let mode: Mode = 'top';
  let currentOltRef: { shelf: number; slot: number; port: number } | null = null;
  let currentOnuKey: string | null = null;
  let hung = false;

  function promptFor(m: Mode): string {
    if (m === 'top') return TEST_PROMPT;
    if (m === 'config') return 'ZXAN(config)#';
    return 'ZXAN(config-if)#';
  }

  function buildGlobalState(): string {
    const omit = new Set(opts.omitFromStateScan ?? []);
    const lines: string[] = [];
    for (const key of entries.keys()) {
      if (omit.has(key)) continue;
      lines.push(`${key}    enable       enable      working      1(GPON)`);
    }
    return lines.join('\r\n');
  }

  function buildRunningConfig(): string {
    const byOlt = new Map<string, string[]>();
    for (const [key, entry] of entries) {
      const pos = key.split(':')[0];
      if (!byOlt.has(pos)) byOlt.set(pos, []);
      const onuType = opts.renderOverride?.onuType ?? entry.onuType;
      byOlt.get(pos)!.push(`onu ${key.split(':')[1]} type ${onuType} sn ${entry.serial}`);
    }
    const blocks: string[] = [];
    for (const [pos, lines] of byOlt) {
      blocks.push(`interface gpon-olt_${pos}`, ...lines.map((l) => ` ${l}`), '!');
    }
    for (const [key, entry] of entries) {
      const tcontProfile = opts.renderOverride?.tcontProfile ?? entry.tcontProfile;
      const trafficProfile = opts.renderOverride?.trafficProfile ?? entry.trafficProfile;
      const vlan = opts.renderOverride?.vlan ?? entry.vlan;
      blocks.push(`interface gpon-onu_${key}`);
      blocks.push(` description ${entry.description || ''}`);
      if (tcontProfile) blocks.push(` tcont 1 profile ${tcontProfile}`);
      blocks.push(' gemport 1 tcont 1');
      if (trafficProfile) blocks.push(` gemport 1 traffic-limit downstream ${trafficProfile}`);
      if (vlan != null) blocks.push(` service-port 1 vport 1 user-vlan ${vlan} vlan ${vlan}`);
      blocks.push('!');
      blocks.push(`pon-onu-mng gpon-onu_${key}`);
      if (entry.serviceGemport != null && entry.serviceVlan != null) {
        blocks.push(` service 1 gemport ${entry.serviceGemport} vlan ${entry.serviceVlan}`);
      }
      blocks.push('!');
    }
    return blocks.join('\r\n');
  }

  return startFakeOlt({
    handleCommand(line: string, socket: Socket) {
      opts.onCommand?.(line);
      if (hung) return; // conexion ya "colgada" a proposito, no responder mas

      const intercepted = opts.intercept?.(line);
      if (intercepted?.action === 'hang') {
        hung = true;
        return;
      }
      if (intercepted?.action === 'close') {
        socket.end();
        return;
      }
      if (intercepted?.action === 'reject') {
        socket.write(`\r\n${intercepted.message}\r\n${promptFor(mode === 'top' ? 'config' : mode)}`);
        return;
      }
      if (intercepted?.action === 'customResponse') {
        // Para simular una respuesta con un formato totalmente inesperado
        // (ej. para probar looksLikeParseFailure/scan_unreliable de extremo
        // a extremo) sin modelar ese formato como un comportamiento "real".
        socket.write(`\r\n${intercepted.text}\r\n${promptFor(mode)}`);
        return;
      }

      // closeAfterApply: deja que el resto de esta funcion aplique el
      // efecto normal de la linea (entries.set, cambios de modo, etc.) pero
      // cualquier `send(...)` de aqui en adelante cierra la conexion en vez
      // de mandar la respuesta — el comando SI se proceso, solo que la
      // confirmacion nunca vuelve (igual que un timeout/corte real).
      const closeAfterApply = intercepted?.action === 'closeAfterApply';
      const send = (text: string) => {
        if (closeAfterApply) socket.end();
        else socket.write(text);
      };

      // 'enable' es siempre el primer comando real de cualquier secuencia
      // (ver zteCommands.ts) — se usa como señal de "arranca una conexion
      // logica nueva" para resetear la navegacion de modos (nunca el
      // registro de ONUs, que debe sobrevivir entre conexiones).
      if (line === 'enable') {
        mode = 'top';
        currentOltRef = null;
        currentOnuKey = null;
        send(`\r\n${TEST_PROMPT}`);
        return;
      }

      if (line === 'configure terminal') {
        mode = 'config';
        send(`\r\nZXAN(config)#`);
        return;
      }

      if (line === 'exit') {
        mode = mode === 'top' ? 'top' : 'config';
        currentOltRef = null;
        currentOnuKey = null;
        send(`\r\n${promptFor(mode)}`);
        return;
      }

      let m = line.match(/^interface gpon-olt_(\d+)\/(\d+)\/(\d+)$/);
      if (m) {
        currentOltRef = { shelf: Number(m[1]), slot: Number(m[2]), port: Number(m[3]) };
        mode = 'if-olt';
        send(`\r\nZXAN(config-if)#`);
        return;
      }

      m = line.match(/^onu (\d+) type (\S+) sn (\S+)$/);
      if (m && mode === 'if-olt' && currentOltRef) {
        const onuId = Number(m[1]);
        const key = `${currentOltRef.shelf}/${currentOltRef.slot}/${currentOltRef.port}:${onuId}`;
        entries.set(key, { onuType: m[2], serial: m[3], description: '' });
        send(`\r\nZXAN(config-if)#`);
        return;
      }

      m = line.match(/^interface gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/);
      if (m) {
        currentOnuKey = `${m[1]}/${m[2]}/${m[3]}:${m[4]}`;
        if (!entries.has(currentOnuKey)) entries.set(currentOnuKey, { onuType: '', serial: '', description: '' });
        mode = 'if-onu';
        send(`\r\nZXAN(config-if)#`);
        return;
      }

      m = line.match(/^pon-onu-mng gpon-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/);
      if (m) {
        currentOnuKey = `${m[1]}/${m[2]}/${m[3]}:${m[4]}`;
        if (!entries.has(currentOnuKey)) {
          send(`\r\n% ONU not found\r\n${promptFor(mode)}`);
          return;
        }
        mode = 'if-mng';
        send(`\r\nZXAN(gpon-onu-mng)#`);
        return;
      }

      if (mode === 'if-onu' && currentOnuKey) {
        const entry = entries.get(currentOnuKey)!;
        let mm = line.match(/^description\s+"?(.*?)"?$/);
        if (mm) {
          entry.description = mm[1];
          send(`\r\nZXAN(config-if)#`);
          return;
        }
        mm = line.match(/^tcont 1 profile (\S+)$/);
        if (mm) {
          entry.tcontProfile = mm[1];
          send(`\r\nZXAN(config-if)#`);
          return;
        }
        if (line === 'gemport 1 tcont 1') {
          send(`\r\nZXAN(config-if)#`);
          return;
        }
        mm = line.match(/^gemport 1 traffic-limit downstream (\S+)$/);
        if (mm) {
          entry.trafficProfile = mm[1];
          send(`\r\nZXAN(config-if)#`);
          return;
        }
        mm = line.match(/^service-port 1 vport 1 user-vlan (\d+) vlan \d+$/);
        if (mm) {
          entry.vlan = Number(mm[1]);
          send(`\r\nZXAN(config-if)#`);
          return;
        }
      }

      if (mode === 'if-mng' && currentOnuKey) {
        const entry = entries.get(currentOnuKey)!;
        const service = line.match(/^service 1 gemport (\d+) vlan (\d+)$/);
        if (service) {
          entry.serviceGemport = Number(service[1]);
          entry.serviceVlan = Number(service[2]);
          send(`\r\nZXAN(gpon-onu-mng)#`);
          return;
        }
      }

      if (line === 'show gpon onu state') {
        send(`\r\n${buildGlobalState()}\r\n${TEST_PROMPT}`);
        return;
      }
      if (line === 'show running-config') {
        send(`\r\n${buildRunningConfig()}\r\n${TEST_PROMPT}`);
        return;
      }

      // Cualquier otro comando (incluido "show running-config interface
      // gpon-olt_S/L/P", NUNCA confirmado contra el equipo real — ver
      // advertencia en zteCommands.ts) se RECHAZA como lo haria una CLI
      // real con algo que no reconoce — nunca se simula un exito silencioso
      // para un comando que este simulador no tiene evidencia de como se
      // comporta de verdad.
      send(`\r\n% Unrecognized command\r\n${promptFor(mode)}`);
    },
  });
}
