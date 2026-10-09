import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect, type Socket } from 'node:net';
import { runTelnetCommands, type TelnetTarget } from '../client';
import { startFakeOlt, writeChunksFragmented, TEST_USERNAME, TEST_PASSWORD, TEST_PROMPT } from './fakeOltServer';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

/** Espera hasta que el texto acumulado recibido por `socket` contenga `needle`
 * (busqueda simple, sin preocuparse por bytes de control: alcanza para
 * ubicar los prompts de texto plano "Username:"/"Password:"/el prompt). */
function waitForText(socket: Socket, needle: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      socket.off('data', onData);
      reject(new Error(`timeout esperando "${needle}" (recibido hasta ahora: ${JSON.stringify(buf)})`));
    }, timeoutMs);
    function onData(chunk: Buffer) {
      buf += chunk.toString('latin1');
      if (buf.includes(needle)) {
        clearTimeout(timer);
        socket.off('data', onData);
        resolve();
      }
    }
    socket.on('data', onData);
  });
}

function target(port: number): TelnetTarget {
  return { host: '127.0.0.1', port, username: TEST_USERNAME, password: TEST_PASSWORD };
}

test('ejecucion completa exitosa: resuelve con el output de cada comando, en orden', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd === 'enable') {
        socket.write(`\r\n${TEST_PROMPT}`);
      } else if (cmd === 'show gpon onu uncfg') {
        socket.write(`\r\nOnuIndex                 Sn                  State\r\ngpon-onu_1/2/4:1         MSTC8CBF86B4        unknown\r\n${TEST_PROMPT}`);
      } else {
        socket.write(`\r\n${TEST_PROMPT}`);
      }
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['enable', 'show gpon onu uncfg'], { timeoutMs: 2000 });
    assert.equal(outputs.length, 2);
    assert.match(outputs[1], /MSTC8CBF86B4/);
  } finally {
    await close();
  }
});

test('cierre antes de terminar los comandos: rechaza, nunca resuelve exito parcial', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd === 'enable') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      // El 2do comando nunca recibe respuesta: la OLT corta la conexion.
      socket.end();
    },
  });
  try {
    await assert.rejects(
      runTelnetCommands(target(port), ['enable', 'configure terminal'], { timeoutMs: 2000 }),
      /se cerro antes de completar/,
    );
  } finally {
    await close();
  }
});

test('error CLI detectado: detiene la secuencia y NO manda el comando siguiente', async () => {
  const received: string[] = [];
  const { port, close } = await startFakeOlt({
    receivedCommands: received,
    handleCommand(cmd, socket) {
      if (cmd === 'enable') socket.write(`\r\n${TEST_PROMPT}`);
      else if (cmd === 'configure terminal') socket.write('\r\nZXAN(config)#');
      else if (cmd === 'bogus-command') {
        socket.write("\r\n%Error 20204: Unrecognized command found at '^' marker.\r\nZXAN(config)#");
      } else socket.write('\r\nZXAN(config)#');
    },
  });
  try {
    await assert.rejects(
      runTelnetCommands(target(port), ['enable', 'configure terminal', 'bogus-command', 'exit'], { timeoutMs: 2000 }),
      /rechazo el comando #3\/4/,
    );
    assert.ok(!received.includes('exit'), 'el comando posterior al error jamas debio mandarse');
  } finally {
    await close();
  }
});

test('timeout: rechaza si la OLT nunca responde', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand() {
      // 'enable' nunca recibe respuesta a proposito.
    },
  });
  try {
    await assert.rejects(runTelnetCommands(target(port), ['enable'], { timeoutMs: 300 }), /Timeout de 300ms/);
  } finally {
    await close();
  }
});

test('negociacion IAC fragmentada entre paquetes TCP: login y comandos funcionan igual', async () => {
  // Cada secuencia de negociacion se manda partida en varios chunks chicos
  // (incluso byte a byte), para forzar que stripIac() reciba trozos
  // incompletos en distintos eventos 'data', igual que fragmentaria TCP real.
  const negotiationChunks = [
    Buffer.from([IAC]),
    Buffer.from([DO]),
    Buffer.from([24]), // IAC DO 24 (terminal-type), partido en 3 chunks de 1 byte
    Buffer.from([IAC, WILL]),
    Buffer.from([1]), // IAC WILL 1 (echo), partido en 2
    Buffer.from([IAC, SB, 24, 0]),
    Buffer.from('ANSI'),
    Buffer.from([IAC, SE]), // subnegociacion partida en 3 chunks
  ];
  const { port, close } = await startFakeOlt({
    negotiationChunks,
    handleCommand(cmd, socket) {
      socket.write(`\r\n${TEST_PROMPT}`);
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['enable'], { timeoutMs: 2000 });
    assert.equal(outputs.length, 1);
    // Ningun byte de control de la negociacion debe colarse en el texto.
    assert.ok(!/[\x00-\x08\x0e-\x1f]/.test(outputs[0]));
  } finally {
    await close();
  }
});

test('fakeOltServer: respuestas de negociacion tardias o mezcladas con el login/comandos se separan del texto real', async () => {
  // Bug real encontrado (revision externa, ChatGPT): el test anterior
  // ("negociacion IAC fragmentada...") dependia de que las respuestas de
  // negociacion del CLIENTE llegaran antes de que fakeOltServer mandara
  // "Username:" — una carrera de timing que fallaba de forma aislada en
  // otras corridas/maquinas (Node 24, "cierre durante login:clave"). Esta
  // prueba fuerza el caso de forma DETERMINISTA, sin depender de ninguna
  // pausa: actuamos como el "cliente" nosotros mismos y mandamos bytes de
  // negociacion IAC (declinaciones WONT/DONT, como las que mandaria el
  // cliente real) PEGADOS en el mismo chunk, antes y despues del usuario,
  // la clave y un comando — exactamente lo que antes contaminaba lineBuf.
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      socket.write(`\r\n${TEST_PROMPT}`);
    },
  });

  const socket = connect({ host: '127.0.0.1', port });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    await waitForText(socket, 'Username:');
    // Negociacion tardia ANTES y DESPUES del usuario, en el mismo escrito.
    socket.write(
      Buffer.concat([
        Buffer.from([IAC, WONT, 24]),
        Buffer.from(`${TEST_USERNAME}\r\n`),
        Buffer.from([IAC, DONT, 1]),
      ]),
    );

    await waitForText(socket, 'Password:');
    // Mas negociacion tardia alrededor de la clave.
    socket.write(
      Buffer.concat([Buffer.from([IAC, WILL, 3, IAC, WONT, 31]), Buffer.from(`${TEST_PASSWORD}\r\n`)]),
    );

    await waitForText(socket, TEST_PROMPT);

    // Y otra vez alrededor de un comando real, para probar que no es algo
    // exclusivo de la fase de login.
    socket.write(Buffer.concat([Buffer.from([IAC, DO, 1]), Buffer.from('enable\r\n')]));
    await waitForText(socket, TEST_PROMPT);
  } finally {
    socket.destroy();
    await close();
  }
});

test('respuesta de un comando dividida en varios paquetes TCP se reensambla completa', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd !== 'show gpon onu uncfg') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      void writeChunksFragmented(
        socket,
        ['\r\nOnuIndex', '                 Sn                  State\r\n', 'gpon-onu_1/2/4:1         MSTC8CBF86B4', `        unknown\r\n${TEST_PROMPT}`],
        10,
      );
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['show gpon onu uncfg'], { timeoutMs: 2000 });
    assert.equal(outputs.length, 1);
    assert.match(outputs[0], /gpon-onu_1\/2\/4:1\s+MSTC8CBF86B4\s+unknown/);
  } finally {
    await close();
  }
});

test('paginacion --More-- con paginas entregadas en paquetes separados: se acumula sin perder filas', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd !== 'show gpon onu state') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      void writeChunksFragmented(
        socket,
        ['\r\n1/2/4:1    enable   enable   working   1(GPON)\r\n--More--', '\r', `1/2/4:2    enable   enable   working   1(GPON)\r\n${TEST_PROMPT}`],
        10,
      );
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['show gpon onu state'], { timeoutMs: 3000 });
    assert.equal(outputs.length, 1);
    assert.match(outputs[0], /1\/2\/4:1/);
    assert.match(outputs[0], /1\/2\/4:2/);
    assert.ok(!/more/i.test(outputs[0]), 'el marcador "--More--" no debe quedar en el resultado final');
  } finally {
    await close();
  }
});

test('timeout: el log y el error nunca incluyen el comando ni el buffer crudo (solo metadatos seguros)', async () => {
  const originalError = console.error;
  const logs: string[] = [];
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  const SECRET = 'MiClaveSuperSecreta123';

  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd === 'enable') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      // El comando con password nunca recibe respuesta -> timeout.
    },
  });
  let caught: Error | undefined;
  try {
    await runTelnetCommands(
      target(port),
      ['enable', `wan-ip 1 mode pppoe username cliente1 password ${SECRET} vlan-profile 120 host 1`],
      { timeoutMs: 300 },
    );
  } catch (e) {
    caught = e as Error;
  } finally {
    console.error = originalError;
    await close();
  }

  assert.ok(caught, 'runTelnetCommands debio rechazar por timeout');
  const joined = logs.join('\n');
  // Ni el log ni el mensaje de error deben incluir la clave, el comando
  // completo, o siquiera la palabra "password" (que delataria que el
  // comando se imprimio) — solo metadatos (fase/comando/duracion/bytes).
  assert.ok(!joined.includes(SECRET), 'la clave en texto plano nunca debe aparecer en los logs de timeout');
  assert.ok(!joined.toLowerCase().includes('password'), 'el log de timeout ya no debe imprimir el comando completo');
  assert.ok(!(caught as Error).message.includes(SECRET), 'el mensaje de error tampoco debe incluir la clave');
  assert.match(joined, /fase=comandos/);
  assert.match(joined, /comando=#1\/2/);
  assert.match(joined, /duracionMs=\d+/);
  assert.match(joined, /bytesPendientes=\d+/);
});

test('timeout durante el login: una credencial "recibida" en el buffer (Password:\\nSECRETO) nunca aparece en logs ni en el error', async () => {
  // Escenario pedido en la revision: el equipo manda el prompt "Password:"
  // seguido de texto que JAMAS deberia terminar en un log (ac aqui
  // simulamos algo que luce como una credencial filtrada por el propio
  // equipo) y despues se queda callado — el cliente se queda esperando en
  // plena fase de login hasta el timeout, con ese texto todavia en el
  // buffer interno.
  const originalError = console.error;
  const logs: string[] = [];
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  const FAKE_SECRET = 'DEMO_SECRET_123';

  let responded = false;
  const server = createServer((socket) => {
    socket.write('Username:');
    socket.on('data', () => {
      if (responded) return;
      responded = true;
      // "Password:" + la credencial fantasma pegada, en un solo chunk, y
      // nunca se manda el prompt final -> el cliente se queda esperando.
      socket.write(`Password:\r\n${FAKE_SECRET}`);
    });
  });
  const port: number = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });

  let caught: Error | undefined;
  try {
    await runTelnetCommands({ host: '127.0.0.1', port, username: TEST_USERNAME, password: TEST_PASSWORD }, ['enable'], {
      timeoutMs: 300,
    });
  } catch (e) {
    caught = e as Error;
  } finally {
    console.error = originalError;
    await new Promise<void>((r) => server.close(() => r()));
  }

  assert.ok(caught, 'runTelnetCommands debio rechazar por timeout durante el login');
  const joined = logs.join('\n');
  assert.ok(!joined.includes(FAKE_SECRET), 'la credencial fantasma nunca debe aparecer en los logs');
  assert.ok(!(caught as Error).message.includes(FAKE_SECRET), 'la credencial fantasma tampoco debe aparecer en el mensaje de error');
  assert.match(joined, /fase=login:clave/);
});

test('"terminal length 0" rechazado: no aborta la conexion, deja constancia y sigue con paginacion generica', async () => {
  const originalError = console.error;
  const logs: string[] = [];
  // eslint-disable-next-line no-console
  console.error = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };

  const { port, close } = await startFakeOlt({
    rejectTerminalLength: true,
    handleCommand(cmd, socket) {
      if (cmd !== 'show gpon onu state') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      // La paginacion sigue viva pese al rechazo de arriba: esto prueba que
      // el fallback generico (MORE_RE) sigue funcionando igual.
      void writeChunksFragmented(
        socket,
        ['\r\n1/2/4:1    enable   enable   working   1(GPON)\r\n--More--', '\r', `1/2/4:2    enable   enable   working   1(GPON)\r\n${TEST_PROMPT}`],
        10,
      );
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['show gpon onu state'], { timeoutMs: 3000 });
    assert.equal(outputs.length, 1);
    assert.match(outputs[0], /1\/2\/4:1/);
    assert.match(outputs[0], /1\/2\/4:2/);
  } finally {
    console.error = originalError;
    await close();
  }

  assert.ok(
    logs.some((l) => l.includes('terminal length 0') && l.includes('rechazo')),
    'debe quedar constancia explicita de que "terminal length 0" fue rechazado',
  );
});

test('una linea de estadisticas que empieza con "Error" (ej. contador de paquetes) no aborta la secuencia', async () => {
  const { port, close } = await startFakeOlt({
    handleCommand(cmd, socket) {
      if (cmd !== 'show pon power onu-rx gpon-olt_1/2/2') {
        socket.write(`\r\n${TEST_PROMPT}`);
        return;
      }
      socket.write(
        `\r\nOnu                 Rx power\r\ngpon-onu_1/2/2:1    -21.368(dbm)\r\nError packets       : 0\r\n${TEST_PROMPT}`,
      );
    },
  });
  try {
    const outputs = await runTelnetCommands(target(port), ['show pon power onu-rx gpon-olt_1/2/2'], { timeoutMs: 2000 });
    assert.equal(outputs.length, 1);
    assert.match(outputs[0], /-21\.368\(dbm\)/);
  } finally {
    await close();
  }
});
