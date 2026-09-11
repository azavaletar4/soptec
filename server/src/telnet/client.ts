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
 * Cliente Telnet minimo para automatizar la CLI de la OLT ZTE C300.
 *
 * La OLT real de este proyecto solo tiene Telnet habilitado (no SSH,
 * confirmado manualmente: banner real "Welcome to ZXAN product C300 of
 * ZTE Corporation"). Este cliente:
 * - filtra/declina la negociacion Telnet (IAC) sin bloquear el flujo,
 * - hace login automatico (Username / Password),
 * - maneja paginacion "--More--",
 * - detecta el prompt igual que el cliente SSH (misma limitacion conocida:
 *   heuristica de linea terminada en # o >).
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
    let settled = false;

    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(
        `[telnet] TIMEOUT en comando #${commandIndex} ("${commands[commandIndex]}"). ` +
          `Buffer pendiente sin coincidir con prompt:\n---\n${accumulated + buffer}\n---`,
      );
      fail(new Error(`Timeout de ${timeoutMs}ms esperando respuesta del equipo`));
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

    /** Filtra secuencias IAC del buffer y declina toda negociacion Telnet. */
    function stripIac(chunk: Buffer): string {
      const out: number[] = [];
      let i = 0;
      while (i < chunk.length) {
        if (chunk[i] === IAC && i + 1 < chunk.length) {
          const cmd = chunk[i + 1];

          if ((cmd === DO || cmd === WILL) && i + 2 < chunk.length) {
            const option = chunk[i + 2];
            const reply = cmd === DO ? WONT : DONT;
            socket.write(Buffer.from([IAC, reply, option]));
            i += 3;
            continue;
          }

          if (cmd === SB) {
            let j = i + 2;
            while (j < chunk.length - 1 && !(chunk[j] === IAC && chunk[j + 1] === SE)) j += 1;
            i = j + 2;
            continue;
          }

          // WONT/DONT u otros comandos de 3 bytes; si no hay suficientes bytes, cortar aqui.
          i += 3;
          continue;
        }
        out.push(chunk[i]);
        i += 1;
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
          socket.write(`${target.username}\r\n`);
          return;
        }
        if (usernameSent && PASSWORD_RE.test(buffer)) {
          buffer = '';
          socket.write(`${target.password}\r\n`);
          return;
        }
        if (usernameSent && PROMPT_RE.test(buffer)) {
          loggedIn = true;
          buffer = '';
          if (commands.length === 0) {
            finish();
            return;
          }
          socket.write(`${commands[0]}\r\n`);
          return;
        }
        return;
      }

      if (PROMPT_RE.test(buffer)) {
        outputs.push(accumulated + buffer);
        accumulated = '';
        buffer = '';
        commandIndex += 1;

        if (commandIndex >= commands.length) {
          finish();
          return;
        }
        socket.write(`${commands[commandIndex]}\r\n`);
      }
    });

    socket.on('error', (err) => fail(err));
    socket.on('close', () => {
      if (!settled) finish();
    });

    socket.connect(target.port, target.host);
  });
}
