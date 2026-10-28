import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from '@vue/server-renderer';
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript';
import { hostConnectionLabel, hostStatusLabel, hostStatusReadAt, hostWifiSignalPresentation, latestHostsReport, type HostEntry } from '../tr069Hosts';
import { emptyHostsPanelState } from '../tr069HostsPanel';

// Renderiza el fragmento REAL de Hosts: sin ejecutar la página, stores ni APIs.
const source = fs.readFileSync(new URL('../../views/tr069/Tr069View.vue', import.meta.url), 'utf8');
const labelAt = source.indexOf('Dispositivos conectados ·');
const start = source.lastIndexOf('<div class="mt-4 pt-4 border-t border-slate-200">', labelAt);
const end = source.indexOf('\n              </td>', labelAt);
assert.ok(start > 0 && end > start);
const compiled = compile(source.slice(start, end), { mode: 'function', prefixIdentifiers: true, expressionPlugins: ['typescript'] }).code;
const javascript = transpileModule(compiled, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
const render = new Function('Vue', javascript)(Vue);
const rawFormatter = source.match(/function formatHostDate\(value: string \| null\) \{[\s\S]*?\n\}/)![0];
const formatHostDate = new Function('return (' + rawFormatter.replace('value: string | null', 'value') + ')')();
const at = '2026-10-28T22:03:39.213Z', recent = Date.parse(at) + 1000;
const row: HostEntry = { hostName: 'Equipo real', ipAddress: '192.168.100.35', macAddress: '56:b9:d2:f2:e7:c1',
  connection: 'WiFi', connectionReportedAt: at, active: true, activeReportedAt: at, band: null, reportedAt: at };

async function html(opened: boolean, now = recent, error: string | null = null) {
  const state = emptyHostsPanelState(); state.opened.id = opened; state.errors.id = error;
  state.inventory.id = { found: true, deviceId: 'exact-id', serial: 'HWTC1D3691B7', lastInform: at, hostsReportedAt: null, hosts: [row] };
  state.result.id = { state: 'completed', requestedAt: at, checkedAt: at, message: 'Lectura recibida del equipo.', inventory: state.inventory.id };
  let requests = 0;
  const app = Vue.createSSRApp({ render, setup: () => ({ hostsPanel: state, hostsById: state.inventory,
    device: { id: 'id', cpe_serial: 'HWTC1D3691B7' }, canReadHostsActively: true, ontEvidenceNow: now,
    hostConnectionLabel, hostStatusLabel, hostStatusReadAt, hostWifiSignalPresentation, latestHostsReport, formatHostDate,
    signalColors: { good: 'text-emerald-700', fair: 'text-amber-600', poor: 'text-red-700' },
    signalLabels: { good: 'Buena', fair: 'Regular', poor: 'Débil' },
    hostsController: { toggle: () => requests++, refresh: () => requests++ },
  }) });
  const warnings: string[] = []; app.config.warnHandler = message => { warnings.push(message); };
  const result = await renderToString(app);
  assert.deepEqual(warnings, [], 'La plantilla real no debe acceder a propiedades inexistentes');
  assert.equal(requests, 0, 'El render no puede iniciar lecturas'); return result;
}

test('render de Hosts cerrado no contiene tabla, datos o botón de consulta ni ejecuta peticiones', async () => {
  const rendered = await html(false);
  assert.match(rendered, /Mostrar/); assert.ok(!rendered.includes('<table')); assert.ok(!rendered.includes('Actualizar'));
});

test('tabla real: seis columnas, estado/fecha legibles, señal desconocida sin datos técnicos visibles', async () => {
  const rendered = await html(true);
  const headings = [...rendered.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map(m => m[1]);
  assert.deepEqual(headings, ['Dispositivo', 'IP', 'MAC', 'Conexión', 'Estado', 'Señal WiFi']);
  assert.match(rendered, /Conectado/); assert.match(rendered, /WiFi/); assert.match(rendered, /Última lectura:/);
  assert.match(rendered, /Última solicitud:/); assert.match(rendered, /No disponible/);
  assert.ok(!/InternetGatewayDevice|InterfaceType|Layer2Interface|Active|RSSIUnit/.test(rendered));
});

test('estado antiguo y error conservan lista/hora; no muestran un conectado histórico como actual', async () => {
  const rendered = await html(true, recent + 11 * 60_000, 'No se pudo completar la consulta.');
  assert.match(rendered, /Sin confirmar/); assert.match(rendered, /Última lectura:/); assert.match(rendered, /Equipo real/);
  assert.match(rendered, /No se pudo completar/); assert.ok(!rendered.includes('Conectado'));
});
