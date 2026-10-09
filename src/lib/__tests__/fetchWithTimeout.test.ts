import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { fetchWithTimeout } from '../fetchWithTimeout';

/** onResponse por defecto para la mayoria de las pruebas: lee el body como texto. */
const readText = (res: Response) => res.text();

/** Servidor que manda las cabeceras de inmediato y recien termina el body tras `bodyDelayMs`. */
function startSlowBodyServer(bodyDelayMs: number, body = 'tarde'): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.flushHeaders();
    setTimeout(() => res.end(body), bodyDelayMs);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** Servidor que tarda `headerDelayMs` en mandar siquiera las cabeceras. */
function startSlowHeaderServer(headerDelayMs: number, body = 'ok'): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);
    }, headerDelayMs);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

test('sin timeoutMs: se comporta igual que fetch normal (no aborta nunca)', async () => {
  const { url, close } = await startSlowHeaderServer(20, 'hola');
  try {
    const text = await fetchWithTimeout(url, {}, undefined, readText);
    assert.equal(text, 'hola');
  } finally {
    await close();
  }
});

test('respuesta rapida (cabeceras y body) dentro del timeout: resuelve normal', async () => {
  const { url, close } = await startSlowHeaderServer(20, 'rapido');
  try {
    const text = await fetchWithTimeout(url, {}, 2000, readText);
    assert.equal(text, 'rapido');
  } finally {
    await close();
  }
});

test('timeout mientras se esperan las cabeceras: rechaza con el mensaje preciso, sin esperar al servidor', async () => {
  const { url, close } = await startSlowHeaderServer(2000, 'tarde'); // el servidor tarda 2s en mandar cabeceras
  try {
    const start = Date.now();
    await assert.rejects(fetchWithTimeout(url, {}, 150, readText), /superó el tiempo de espera/i);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `tardo ${elapsed}ms en rechazar, esperado bien por debajo de los 2000ms del servidor`);
  } finally {
    await close();
  }
});

// Hallazgo de la revision: el timer se limpiaba apenas llegaban las
// cabeceras (cuando fetch() resuelve), asi que una lectura de BODY que se
// quedara a medio camino quedaba sin ninguna proteccion de timeout. Esta
// prueba reproduce exactamente eso: cabeceras casi instantaneas, body que
// nunca termina de llegar dentro del limite.
test('timeout con cabeceras rapidas pero BODY lento: tambien rechaza, no se queda esperando el body', async () => {
  const { url, close } = await startSlowBodyServer(2000, 'tarde'); // cabeceras ya, body recien a los 2s
  try {
    const start = Date.now();
    await assert.rejects(fetchWithTimeout(url, {}, 150, readText), /superó el tiempo de espera/i);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `tardo ${elapsed}ms en rechazar, esperado bien por debajo de los 2000ms del body`);
  } finally {
    await close();
  }
});

test('body lento pero DENTRO del timeout: resuelve normal con el contenido completo', async () => {
  const { url, close } = await startSlowBodyServer(100, 'completo-tarde');
  try {
    const text = await fetchWithTimeout(url, {}, 2000, readText);
    assert.equal(text, 'completo-tarde');
  } finally {
    await close();
  }
});

test('el mensaje de timeout es preciso: no le atribuye la causa a la OLT ni a la cola Telnet', async () => {
  const { url, close } = await startSlowHeaderServer(500, 'tarde');
  try {
    try {
      await fetchWithTimeout(url, {}, 50, readText);
      assert.fail('debio rechazar');
    } catch (e) {
      assert.ok(e instanceof Error, 'debe ser un Error normal, compatible con getErrorMessage');
      assert.match(e.message, /superó el tiempo de espera/i);
      assert.ok(!/ocupad|cola|sync automático/i.test(e.message), 'no debe inventar una causa (OLT/cola) sin evidencia');
    }
  } finally {
    await close();
  }
});

test('cancelacion EXTERNA (signal del caller) mientras se esperan cabeceras: se distingue del timeout', async () => {
  const { url, close } = await startSlowHeaderServer(2000, 'tarde');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50); // el CALLER cancela, no nuestro timer
    await assert.rejects(
      fetchWithTimeout(url, { signal: controller.signal }, 5000, readText), // timeoutMs generoso: si dispara, es un bug
      (e: unknown) => {
        assert.ok(e instanceof Error || (e as { name?: string })?.name === 'AbortError');
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(!/superó el tiempo de espera/i.test(msg), 'una cancelacion externa no debe reportarse como timeout');
        return true;
      },
    );
  } finally {
    await close();
  }
});

test('cancelacion EXTERNA mientras se lee el BODY: tambien se distingue del timeout', async () => {
  const { url, close } = await startSlowBodyServer(2000, 'tarde');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      fetchWithTimeout(url, { signal: controller.signal }, 5000, readText),
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        assert.ok(!/superó el tiempo de espera/i.test(msg), 'una cancelacion externa durante el body no debe reportarse como timeout');
        return true;
      },
    );
  } finally {
    await close();
  }
});

test('signal externo YA cancelado antes de empezar: rechaza de inmediato, sin llegar a conectar', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchWithTimeout('http://127.0.0.1:1', { signal: controller.signal }, 5000, readText));
});

test('un error de red real (no por timeout ni cancelacion) se propaga tal cual', async () => {
  // Puerto cerrado -> ECONNREFUSED, no un abort.
  await assert.rejects(fetchWithTimeout('http://127.0.0.1:1', {}, 5000, readText), (e: unknown) => {
    assert.ok(e instanceof Error);
    assert.ok(!/superó el tiempo de espera/i.test(e.message), 'un error de conexion real no debe confundirse con un timeout');
    return true;
  });
});

test('un error propio de onResponse (no un abort) se propaga sin reinterpretarse como timeout', async () => {
  const { url, close } = await startSlowHeaderServer(10, 'ok');
  try {
    await assert.rejects(
      fetchWithTimeout(url, {}, 5000, async () => {
        throw new Error('fallo al parsear, nada que ver con timeouts');
      }),
      /fallo al parsear/,
    );
  } finally {
    await close();
  }
});
