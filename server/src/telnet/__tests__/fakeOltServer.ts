import { createServer, type Socket, type Server } from 'node:net';

// Servidor Telnet simulado para las pruebas de server/src/telnet/client.ts —
// imita lo minimo necesario del flujo real de la ZXA10 C300 (login
// Username/Password, "terminal length 0", prompt terminado en # o >) sin
// conectarse al equipo real. Ver docs/auditoria/fase-1-telnet.html.

export const TEST_USERNAME = 'admin';
export const TEST_PASSWORD = 'S3cr3t-Pass';
export const TEST_PROMPT = 'ZXAN#';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

/**
 * Escribe cada chunk en una llamada socket.write() SEPARADA, con una
 * pequeña espera entre cada una — el objetivo es forzar que el cliente los
 * reciba como eventos 'data' distintos (simula fragmentacion real de
 * paquetes TCP), no un solo buffer completo de una vez.
 */
export function writeChunksFragmented(socket: Socket, chunks: (string | Buffer)[], delayMs = 5): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (socket.destroyed || i >= chunks.length) {
        resolve();
        return;
      }
      socket.write(chunks[i]);
      i += 1;
      setTimeout(next, delayMs);
    };
    next();
  });
}

export interface FakeOltOptions {
  username?: string;
  password?: string;
  prompt?: string;
  /** Bytes de negociacion IAC a mandar justo despues de conectar (antes del login), opcional. */
  negotiationChunks?: (string | Buffer)[];
  /** Cada comando recibido (string, sin \r\n) se entrega aqui para decidir la respuesta. */
  handleCommand: (command: string, socket: Socket) => void | Promise<void>;
  /** Comandos realmente recibidos por el server, en orden (para que el test verifique que NO se mando algo). */
  receivedCommands?: string[];
  /** Si true, "terminal length 0" se responde con un rechazo CLI (estilo Cisco)
   * en vez de aceptarlo en silencio — para probar que el cliente lo detecta y
   * sigue la sesion de todas formas (ver runTelnetCommands). */
  rejectTerminalLength?: boolean;
}

export function startFakeOlt(opts: FakeOltOptions): Promise<{ port: number; server: Server; close: () => Promise<void> }> {
  const username = opts.username ?? TEST_USERNAME;
  const password = opts.password ?? TEST_PASSWORD;
  const prompt = opts.prompt ?? TEST_PROMPT;

  const server = createServer((socket) => {
    let stage: 'username' | 'password' | 'commands' = 'username';
    let lineBuf = '';

    // Filtro IAC persistente para TODA la conexion, no solo "antes del
    // login" — bug real encontrado (revision externa): las respuestas de
    // negociacion del cliente real (declina DO/WILL con WONT/DONT) pueden
    // llegar en cualquier momento, inclusive DESPUES de que este server ya
    // mando "Username:"/"Password:" (son dos flujos de bytes independientes
    // sobre el mismo socket, sin orden garantizado entre lo que este server
    // escribe y lo que el cliente responde). La version anterior solo
    // descartaba bytes ANTES de escribir "Username:" (via una bandera
    // "acceptInput"), asi que una respuesta de negociacion tardia quedaba
    // sin filtrar y se colaba cruda en "lineBuf", rompiendo la comparacion
    // de usuario/clave (sintoma real reportado: cierre durante
    // "login:clave" en corridas aisladas). Con este filtro corriendo SIEMPRE
    // sobre cada chunk entrante (con estado persistente entre chunks, igual
    // que stripIac() en client.ts), cualquier byte de negociacion se separa
    // del texto real sin importar cuando llegue.
    let negState: 'data' | 'iac' | 'opt' | 'sub' | 'subIac' = 'data';
    function stripIacFromClient(chunk: Buffer): string {
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
              out.push(IAC); // IAC IAC => byte de datos 0xFF literal
              negState = 'data';
            } else if (b === SB) {
              negState = 'sub';
            } else if (b === DO || b === WILL || b === WONT || b === DONT) {
              negState = 'opt';
            } else {
              negState = 'data'; // otros comandos de 2 bytes (NOP, GA, etc.)
            }
            break;
          case 'opt':
            // Byte de opcion de un DO/WILL/WONT/DONT — este server no
            // necesita responder (son declinaciones del cliente a algo que
            // este server propuso, o viceversa), solo consumirlo.
            negState = 'data';
            break;
          case 'sub':
            if (b === IAC) negState = 'subIac';
            break;
          case 'subIac':
            if (b === SE) negState = 'data';
            else negState = 'sub'; // IAC IAC escapado u otro byte: seguir en la subnegociacion
            break;
        }
      }
      return Buffer.from(out).toString('utf8');
    }

    const start = async () => {
      if (opts.negotiationChunks?.length) {
        await writeChunksFragmented(socket, opts.negotiationChunks);
      }
      socket.write('Username:');
    };

    socket.on('data', (chunk: Buffer) => {
      lineBuf += stripIacFromClient(chunk);
      let idx = lineBuf.indexOf('\n');
      while (idx !== -1) {
        const line = lineBuf.slice(0, idx).replace(/\r$/, '');
        lineBuf = lineBuf.slice(idx + 1);

        if (stage === 'username') {
          if (line !== username) {
            socket.end();
            return;
          }
          socket.write('Password:');
          stage = 'password';
        } else if (stage === 'password') {
          if (line !== password) {
            socket.end();
            return;
          }
          socket.write(`\r\n${prompt}`);
          stage = 'commands';
        } else if (stage === 'commands') {
          if (line === 'terminal length 0') {
            if (opts.rejectTerminalLength) {
              socket.write(`\r\n% Unrecognized command\r\n${prompt}`);
            } else {
              socket.write(`\r\n${prompt}`);
            }
          } else {
            opts.receivedCommands?.push(line);
            void opts.handleCommand(line, socket);
          }
        }

        idx = lineBuf.indexOf('\n');
      }
    });

    void start();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, server, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
