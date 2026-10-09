import { Socket } from 'node:net';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

export interface TelnetTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

// Mismas heuristicas que el cliente SSH (ver server/src/ssh/client.ts).
const PROMPT_RE = /[#>]\s*$/;
const MORE_RE = /--\s*more\s*--|press\s+.q.\s+to\s+break/i;
const MORE_CLEAN_RE = /--\s*more\s*--/gi;
const USERNAME_RE = /username\s*:?\s*$/i;
const PASSWORD_RE = /password\s*:?\s*$/i;

/**
 * Detecta errores CLI conocidos/verificados en la salida de la ZXA10 C300.
 *
 * Patrones confirmados contra el equipo real (ver zteCommands.ts/zteParsers.ts):
 * "%Error 20204: ..." (comando ambiguo), "Error 20202: Invalid input detected"
 * (comando inexistente en este firmware), "Incomplete command." (ej. "tcont 1
 * name ..." sin perfil). Se agregan ademas las variantes estilo Cisco
 * ("Unrecognized command"/"Ambiguous command") que la C300 hereda de esa
 * convencion de CLI, por si otra version de firmware las usa — para esas DOS
 * ultimas (nunca confirmadas contra este equipo, son puro respaldo) se exige
 * el "%" inicial tipico de Cisco, para no ampliar de mas la superficie de
 * falsos positivos con algo que ni siquiera esta confirmado.
 *
 * A proposito NO se usa un simple "^%?\s*error\b": eso clasificaba como error
 * cualquier linea de ESTADISTICAS que arranca con la palabra "Error" sin
 * serlo (ej. "Error packets: 0" en una salida de contadores) — confirmado
 * como falso positivo real. Un rechazo real de este equipo siempre trae un
 * CODIGO NUMERICO pegado a "Error" (ej. "Error 20202:"), nunca una palabra.
 *
 * Solo se revisa el INICIO de cada linea (tras recortar espacios) — el eco
 * del comando enviado queda SIEMPRE despues del prompt en la misma linea
 * (ej. 'ZXAN(config)#description "Error de instalacion"'), nunca al
 * principio de una linea nueva, asi que un valor de texto libre que
 * contenga la palabra "error" en medio de la linea tampoco puede disparar
 * un falso positivo aqui. No es una lista exhaustiva (no hay manual oficial
 * ZTE disponible, ver advertencia en zteCommands.ts) — mantenerla acotada a
 * salidas ya confirmadas en vez de adivinar evita falsos positivos nuevos.
 */
const CLI_ERROR_LINE_RE =
  /^(%\s*error\s+\d+\s*:|error\s+\d+\s*:|%?\s*incomplete command\b|%?\s*invalid input detected\b|%\s*unrecognized command\b|%\s*ambiguous command\b)/i;

export function detectCliError(output: string): string | null {
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (CLI_ERROR_LINE_RE.test(line)) return line;
  }
  return null;
}

/**
 * Oculta credenciales en texto que SI se expone (la linea de error que
 * devuelve el propio equipo, ver uso mas abajo) — defensa adicional por si
 * algun firmware llega a repetir el comando rechazado dentro del mensaje de
 * error. El log de timeout y el resto de mensajes de error YA NO imprimen
 * comandos ni buffers crudos (ver runTelnetCommands) — esto ya no es la
 * unica barrera contra filtrar una clave, solo una capa extra.
 */
export function redactSensitive(text: string): string {
  return text.replace(/(password\s+)\S+/gi, '$1[REDACTED]').replace(/(username\s+)\S+/gi, '$1[REDACTED]');
}

/** Primer token de un comando CLI (ej. "wan-ip" de "wan-ip 1 mode pppoe username X password Y ...")
 * — nunca puede ser una credencial (esas son siempre VALORES de argumentos,
 * nunca el verbo), asi que es seguro usarlo en logs/mensajes de error sin
 * redaccion, a diferencia del comando completo. */
function commandVerb(cmd: string | undefined): string {
  if (!cmd) return '(desconocido)';
  return cmd.trim().split(/\s+/)[0] || '(desconocido)';
}

/**
 * Cliente Telnet minimo para automatizar la CLI de la OLT ZTE C300.
 *
 * La OLT real de este proyecto solo tiene Telnet habilitado (no SSH,
 * confirmado manualmente: banner real "Welcome to ZXAN product C300 of
 * ZTE Corporation"). Este cliente:
 * - filtra/declina la negociacion Telnet (IAC) sin bloquear el flujo,
 *   manteniendo estado entre paquetes TCP (ver stripIac mas abajo),
 * - hace login automatico (Username / Password),
 * - maneja paginacion "--More--",
 * - detecta el prompt igual que el cliente SSH (misma limitacion conocida:
 *   heuristica de linea terminada en # o >),
 * - detecta errores CLI centralizados (detectCliError) y NUNCA manda el
 *   siguiente comando de la secuencia si el actual fue rechazado,
 * - solo resuelve exitosamente si TODOS los comandos terminaron; un cierre
 *   de conexion a mitad de la secuencia (o un timeout) siempre rechaza la
 *   promesa, nunca devuelve exito parcial,
 * - si el equipo rechaza "terminal length 0" (desactivar paginacion), NO
 *   aborta la conexion ni lo ignora en silencio: lo deja constancia en un
 *   log (sin contenido sensible) y sigue — la paginacion "--More--" ya se
 *   maneja de forma generica para cualquier comando, asi que la sesion
 *   sigue siendo funcional aunque mas lenta,
 * - nunca imprime comandos completos ni buffers crudos en logs/errores
 *   (podrian llevar una clave, ej. wan-ip ... password ...) — solo
 *   metadatos seguros: fase de la conexion, indice del comando, duracion y
 *   cantidad de bytes pendientes.
 */
export function runTelnetCommands(
  target: TelnetTarget,
  commands: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 30000;

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const outputs: string[] = [];
    let buffer = '';
    // Acumula paginas ya leidas cuando el comando pagina con "--More--"
    // (sin esto, cada pagina nueva pisaba a la anterior y solo sobrevivia
    // la ultima — bug real encontrado al listar "show gpon onu state" sin
    // filtro de puerto, que devuelve cientos de lineas paginadas).
    let accumulated = '';
    let commandIndex = 0;
    let loggedIn = false;
    let usernameSent = false;
    let warmupDone = false;
    let settled = false;

    // Metadatos seguros para logs/errores (nunca contenido crudo, ver
    // comentario de la funcion arriba): en que fase de la conexion estamos
    // y desde cuando estamos esperando una respuesta en esa fase.
    let phaseStartedAt = Date.now();
    function currentPhase(): string {
      if (!loggedIn) return usernameSent ? 'login:clave' : 'login:usuario';
      if (!warmupDone) return 'post-login:terminal-length';
      return 'comandos';
    }

    // Estado del filtro de negociacion Telnet (IAC), persistente ENTRE
    // llamadas a stripIac (es decir, entre paquetes TCP distintos) — antes
    // cada chunk se procesaba de forma aislada, asi que una secuencia IAC
    // (sobre todo IAC SB ... IAC SE, que puede ser larga) cortada justo en
    // el limite de un paquete se interpretaba mal o dejaba bytes de control
    // colados en el texto. Ver docs/auditoria/fase-1-telnet.html.
    let negState: 'data' | 'iac' | 'negotiate' | 'sub' | 'subIac' = 'data';
    let pendingNegotiation = 0;

    const timer = setTimeout(() => {
      // Solo metadatos — JAMAS el comando ni el buffer crudo: un timeout
      // puede caer en medio del login (ver PASSWORD_RE arriba), con la
      // clave real ya tecleada y pendiente de eco en "buffer" — imprimirla
      // tal cual (como hacia la version anterior, incluso con redactSensitive
      // encima) la expone si el equipo la repite de un modo que el regex de
      // redaccion no cubre. Con solo estos 4 datos ya se puede diagnosticar
      // donde se atasco la sesion sin arriesgar nada.
      const pendingBytes = Buffer.byteLength(accumulated + buffer, 'utf8');
      // eslint-disable-next-line no-console
      console.error(
        `[telnet] TIMEOUT — fase=${currentPhase()} comando=#${commandIndex}/${commands.length} ` +
          `duracionMs=${Date.now() - phaseStartedAt} bytesPendientes=${pendingBytes}`,
      );
      fail(new Error(`Timeout de ${timeoutMs}ms esperando respuesta del equipo (fase=${currentPhase()})`));
    }, timeoutMs);

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outputs);
    }

    /**
     * Filtra secuencias IAC del buffer y declina toda negociacion Telnet,
     * manteniendo estado entre invocaciones (ver negState arriba) para
     * tolerar fragmentacion arbitraria entre paquetes TCP: un IAC suelto al
     * final de un chunk, un DO/WILL sin su byte de opcion todavia, o una
     * subnegociacion (IAC SB ... IAC SE) partida a la mitad, todos quedan
     * resueltos correctamente en el/los proximos chunk(s).
     */
    function stripIac(chunk: Buffer): string {
      const out: number[] = [];
      for (let i = 0; i < chunk.length; i += 1) {
        const b = chunk[i];
        switch (negState) {
          case 'data':
            if (b === IAC) negState = 'iac';
            else out.push(b);
            break;
          case 'iac':
            if (b === IAC) {
              // IAC IAC => byte de datos 0xFF literal (muy raro en la salida
              // de este equipo, pero es lo que exige el protocolo).
              out.push(IAC);
              negState = 'data';
            } else if (b === SB) {
              negState = 'sub';
            } else if (b === DO || b === WILL || b === WONT || b === DONT) {
              pendingNegotiation = b;
              negState = 'negotiate';
            } else {
              // Otros comandos Telnet de 2 bytes (NOP, GA, AYT, etc.): no
              // llevan byte de opcion, se descartan sin responder.
              negState = 'data';
            }
            break;
          case 'negotiate': {
            const option = b;
            if (pendingNegotiation === DO) socket.write(Buffer.from([IAC, WONT, option]));
            else if (pendingNegotiation === WILL) socket.write(Buffer.from([IAC, DONT, option]));
            // WONT/DONT que manda el equipo no requieren respuesta.
            negState = 'data';
            break;
          }
          case 'sub':
            // Datos de subnegociacion: no le interesan al CLI, se descartan.
            if (b === IAC) negState = 'subIac';
            break;
          case 'subIac':
            if (b === SE) negState = 'data';
            else negState = 'sub'; // IAC IAC (0xFF escapado) u otro byte: seguir dentro de la subnegociacion
            break;
        }
      }
      return Buffer.from(out).toString('utf8');
    }

    socket.on('data', (chunk: Buffer) => {
      buffer += stripIac(chunk);

      if (MORE_RE.test(buffer)) {
        accumulated += buffer.replace(MORE_CLEAN_RE, '');
        buffer = '';
        socket.write(' ');
        return;
      }

      if (!loggedIn) {
        if (!usernameSent && USERNAME_RE.test(buffer)) {
          usernameSent = true;
          buffer = '';
          phaseStartedAt = Date.now();
          socket.write(`${target.username}\r\n`);
          return;
        }
        if (usernameSent && PASSWORD_RE.test(buffer)) {
          buffer = '';
          phaseStartedAt = Date.now();
          socket.write(`${target.password}\r\n`);
          return;
        }
        if (usernameSent && PROMPT_RE.test(buffer)) {
          loggedIn = true;
          buffer = '';
          phaseStartedAt = Date.now();
          // "terminal length 0" desactiva la paginacion "--More--" para toda
          // la sesion. Sin esto, un bug real encontrado en produccion: en
          // comandos largos y paginados (ej. "show gpon onu state" sin
          // filtro, cientos de filas) se pierde ~1 fila por cada salto de
          // pagina (24 lineas), descuadrando los conteos silenciosamente
          // (confirmado contra el equipo real: 646/675 ONUs capturadas sin
          // esto, 675/675 con esto). Se envia una sola vez por conexion,
          // antes de los comandos del caller.
          socket.write('terminal length 0\r\n');
          return;
        }
        return;
      }

      if (!warmupDone) {
        if (PROMPT_RE.test(buffer)) {
          // Verificacion explicita de la respuesta a "terminal length 0" —
          // antes se ignoraba en silencio. Si el firmware lo rechaza (otra
          // sintaxis, version distinta, etc.) NO se aborta la conexion: la
          // paginacion "--More--" ya se maneja de forma generica para
          // CUALQUIER comando (ver MORE_RE arriba), asi que la sesion sigue
          // siendo funcional sin este atajo, solo un poco mas lenta en
          // comandos largos. Se deja constancia con un log sin contenido
          // sensible (esta respuesta nunca puede traer una credencial).
          const terminalLengthError = detectCliError(buffer);
          if (terminalLengthError) {
            // eslint-disable-next-line no-console
            console.error(
              `[telnet] La OLT rechazo "terminal length 0" (paginacion seguira activa, se maneja por pagina) — ` +
                `duracionMs=${Date.now() - phaseStartedAt}`,
            );
          }

          warmupDone = true;
          buffer = '';
          phaseStartedAt = Date.now();
          if (commands.length === 0) {
            finish();
            return;
          }
          socket.write(`${commands[0]}\r\n`);
        }
        return;
      }

      if (PROMPT_RE.test(buffer)) {
        const fullOutput = accumulated + buffer;

        // Error CLI detectado en la respuesta de ESTE comando: se detiene la
        // secuencia aqui mismo (fail() destruye el socket, nunca se llega a
        // mandar commands[commandIndex + 1]) en vez de seguir como si nada
        // y terminar resolviendo un "exito" con comandos a medio aplicar.
        const cliError = detectCliError(fullOutput);
        if (cliError) {
          fail(
            new Error(
              `La OLT rechazo el comando #${commandIndex + 1}/${commands.length} ` +
                `(verbo "${commandVerb(commands[commandIndex])}"): ${redactSensitive(cliError)}`,
            ),
          );
          return;
        }

        outputs.push(fullOutput);
        accumulated = '';
        buffer = '';
        commandIndex += 1;
        phaseStartedAt = Date.now();

        if (commandIndex >= commands.length) {
          finish();
          return;
        }
        socket.write(`${commands[commandIndex]}\r\n`);
      }
    });

    socket.on('error', (err) => fail(err));
    socket.on('close', () => {
      // Antes: un close siempre resolvia exito si todavia no se habia
      // "settled" (p.ej. la OLT corta la conexion a mitad de la secuencia de
      // comandos por un problema de red/sesion) — el caller recibia
      // outputs incompleto como si todo hubiera salido bien. Ahora cualquier
      // close que llegue ANTES de que la secuencia termine normalmente
      // (finish()) es siempre un fallo.
      if (settled) return;
      fail(
        new Error(
          `La conexion Telnet se cerro antes de completar los comandos ` +
            `(fase=${currentPhase()}, comando #${commandIndex + 1}/${commands.length}).`,
        ),
      );
    });

    socket.connect(target.port, target.host);
  });
}
