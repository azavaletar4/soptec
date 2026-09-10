import { Client } from 'ssh2';

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Contrasena de "enable" si el equipo la pide por separado (algunos ZTE/V-SOL). */
  enablePassword?: string;
}

// Coincide cuando el buffer termina en un prompt tipo "ZXAN#", "ZXAN(config)#", "OLT>", etc.
const PROMPT_RE = /[#>]\s*$/;
// Paginacion tipo "---- More ( Press 'Q' to break ) ----" o variantes "--More--".
const MORE_RE = /--\s*more\s*--|press\s+.q.\s+to\s+break/i;
const MORE_CLEAN_RE = /-+\s*more.*?-+\r?\n?/gi;
const PASSWORD_PROMPT_RE = /password\s*:?\s*$/i;
const CONFIRM_RE = /\(y\/n\)\s*\[?[yn]?\]?\s*:?\s*$/i;

/**
 * Abre una sesion SSH interactiva (shell) y envia una lista de comandos en
 * secuencia, esperando el prompt del equipo despues de cada uno. Devuelve
 * el output de cada comando (uno por entrada del array `commands`).
 *
 * Maneja automaticamente:
 * - el banner/prompt inicial de login (no se envia el primer comando hasta
 *   que aparece el primer prompt real),
 * - paginacion ("--More--" / "Press Q to break") enviando espacio,
 * - un prompt de contrasena adicional para "enable" si se paso enablePassword,
 * - confirmaciones tipo "(y/n)" respondiendo automaticamente "y".
 *
 * Limitacion conocida: PROMPT_RE es una heuristica (linea que termina en
 * # o >). Si el output de un comando contiene una linea que por casualidad
 * termina en esos caracteres, se podria cortar antes de tiempo. Es el mismo
 * enfoque que documenta el curso de referencia para Huawei/V-SOL.
 */
export function runSshCommands(
  target: SshTarget,
  commands: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 30000;

  return new Promise((resolve, reject) => {
    if (commands.length === 0) {
      resolve([]);
      return;
    }

    const conn = new Client();
    const outputs: string[] = [];
    let buffer = '';
    let commandIndex = 0;
    let started = false;
    let settled = false;

    const timer = setTimeout(() => {
      fail(new Error(`Timeout de ${timeoutMs}ms esperando respuesta del equipo`));
    }, timeoutMs);

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      reject(err);
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.end();
      resolve(outputs);
    }

    conn
      .on('ready', () => {
        // eslint-disable-next-line no-console
        console.log(`[ssh] Conexion SSH establecida con ${target.host}:${target.port}, abriendo shell...`);
        conn.shell((err, stream) => {
          if (err) return fail(err);

          stream.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');

            if (MORE_RE.test(buffer)) {
              stream.write(' ');
              buffer = buffer.replace(MORE_CLEAN_RE, '');
              return;
            }

            if (target.enablePassword && PASSWORD_PROMPT_RE.test(buffer)) {
              stream.write(`${target.enablePassword}\n`);
              buffer = '';
              return;
            }

            if (CONFIRM_RE.test(buffer)) {
              stream.write('y\n');
              buffer = '';
              return;
            }

            if (PROMPT_RE.test(buffer)) {
              if (!started) {
                // Banner/prompt inicial de login: se descarta, no es respuesta a un comando.
                started = true;
                buffer = '';
                stream.write(`${commands[0]}\n`);
                return;
              }

              outputs.push(buffer);
              buffer = '';
              commandIndex += 1;

              if (commandIndex >= commands.length) {
                stream.end();
                finish();
                return;
              }
              stream.write(`${commands[commandIndex]}\n`);
            }
          });

          stream.on('close', () => {
            if (!settled) finish();
          });
        });
      })
      .on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error(`[ssh] Error conectando a ${target.host}:${target.port}:`, err.message);
        fail(err);
      })
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        readyTimeout: timeoutMs,
        // Muchos equipos GPON (OLTs) embebidos, incluida la ZTE C300, solo
        // soportan algoritmos SSH viejos que Node deshabilita por defecto
        // (por seguridad). Sin esto, el handshake falla con ECONNRESET.
        algorithms: {
          kex: [
            'diffie-hellman-group1-sha1',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group14-sha256',
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group-exchange-sha256',
            'ecdh-sha2-nistp256',
            'ecdh-sha2-nistp384',
            'ecdh-sha2-nistp521',
          ],
          cipher: [
            '3des-cbc',
            'aes128-cbc',
            'aes192-cbc',
            'aes256-cbc',
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
            'aes128-gcm',
            'aes256-gcm',
          ],
          serverHostKey: [
            'ssh-rsa',
            'ssh-dss',
            'ecdsa-sha2-nistp256',
            'ecdsa-sha2-nistp384',
            'ecdsa-sha2-nistp521',
            'ssh-ed25519',
          ],
          hmac: ['hmac-sha1', 'hmac-sha2-256', 'hmac-sha2-512', 'hmac-md5'],
        },
        // Temporal, para diagnosticar el handshake real contra la ZTE. Quitar
        // (o condicionar a una env var) una vez confirmado que conecta bien.
        debug: (msg: string) => {
          // eslint-disable-next-line no-console
          console.log(`[ssh:debug] ${msg}`);
        },
      });

    // eslint-disable-next-line no-console
    console.log(`[ssh] Intentando conectar a ${target.host}:${target.port} como ${target.username}...`);
  });
}
