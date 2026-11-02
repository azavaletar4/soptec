import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientPriorityRank, matchesStatusFilter, matchesServiceFilter, sortClientRows,
  parseClientsListQuery, buildClientsListQuery, DEFAULT_CLIENTS_LIST_QUERY,
  type SortableClientRow,
} from '../clientsListFilters';

// ---- Filtro Estado ----

test('filtro Estado: "all" acepta cualquier estado, los demas exigen coincidencia exacta', () => {
  for (const status of ['active', 'suspended', 'prospect', 'retired'] as const) {
    assert.equal(matchesStatusFilter(status, 'all'), true);
    assert.equal(matchesStatusFilter(status, status), true);
  }
  assert.equal(matchesStatusFilter('active', 'suspended'), false);
  assert.equal(matchesStatusFilter('prospect', 'retired'), false);
});

// ---- Filtro Servicios ----

test('filtro Servicios: vigente/historico/multi, combinaciones reales', () => {
  // Caso Jheraldin/Daniel: 0 vigentes, 1 historico.
  const soloHistorico = { vigentes: 0, historicos: 1, total: 1 };
  assert.equal(matchesServiceFilter(soloHistorico, 'vigente'), false);
  assert.equal(matchesServiceFilter(soloHistorico, 'historico'), true);
  assert.equal(matchesServiceFilter(soloHistorico, 'multi'), false);

  // 1 vigente + 1 cancelado: cae en vigente E historico a la vez.
  const mixto = { vigentes: 1, historicos: 1, total: 2 };
  assert.equal(matchesServiceFilter(mixto, 'vigente'), true);
  assert.equal(matchesServiceFilter(mixto, 'historico'), true);
  assert.equal(matchesServiceFilter(mixto, 'multi'), true);

  // 2 vigentes, ningun historico.
  const dosVigentes = { vigentes: 2, historicos: 0, total: 2 };
  assert.equal(matchesServiceFilter(dosVigentes, 'vigente'), true);
  assert.equal(matchesServiceFilter(dosVigentes, 'historico'), false);
  assert.equal(matchesServiceFilter(dosVigentes, 'multi'), true);

  // Un unico contrato vigente: nunca "multiples".
  const unVigente = { vigentes: 1, historicos: 0, total: 1 };
  assert.equal(matchesServiceFilter(unVigente, 'multi'), false);

  assert.equal(matchesServiceFilter(soloHistorico, 'all'), true);
});

// ---- Prioridad por cliente ----

test('clientPriorityRank: la mas alta entre varios contratos, 0 sin ninguno', () => {
  assert.equal(clientPriorityRank([]), 0);
  assert.equal(clientPriorityRank(['low']), 1);
  assert.equal(clientPriorityRank(['low', 'high', 'medium']), 3);
  assert.equal(clientPriorityRank(['medium', 'medium']), 2);
});

// ---- Orden tipo Excel ----

const row = (id: string, name: string, statusLabel: string, priorityRank: number, serviceCount: number): SortableClientRow =>
  ({ id, name, statusLabel, priorityRank, serviceCount });

test('sortClientRows: columna null conserva el orden original sin tocarlo', () => {
  const rows = [row('1', 'Beto', 'Activo', 1, 1), row('2', 'Ana', 'Baja', 3, 2)];
  assert.deepEqual(sortClientRows(rows, null, 'asc'), rows);
});

test('sortClientRows: Nombre A-Z y Z-A', () => {
  const rows = [row('1', 'Beto', 'Activo', 1, 1), row('2', 'Ana', 'Activo', 1, 1), row('3', 'Carla', 'Activo', 1, 1)];
  assert.deepEqual(sortClientRows(rows, 'name', 'asc').map((r) => r.name), ['Ana', 'Beto', 'Carla']);
  assert.deepEqual(sortClientRows(rows, 'name', 'desc').map((r) => r.name), ['Carla', 'Beto', 'Ana']);
});

test('sortClientRows: Estado por la etiqueta visible, asc y desc', () => {
  const rows = [row('1', 'X', 'Suspendido', 0, 0), row('2', 'Y', 'Activo', 0, 0), row('3', 'Z', 'Baja', 0, 0)];
  assert.deepEqual(sortClientRows(rows, 'status', 'asc').map((r) => r.statusLabel), ['Activo', 'Baja', 'Suspendido']);
});

test('sortClientRows: Prioridad numerica, la mas alta primero en desc', () => {
  const rows = [row('1', 'X', 'Activo', 1, 0), row('2', 'Y', 'Activo', 3, 0), row('3', 'Z', 'Activo', 2, 0)];
  assert.deepEqual(sortClientRows(rows, 'priority', 'desc').map((r) => r.priorityRank), [3, 2, 1]);
});

test('sortClientRows: cantidad de servicios, ascendente', () => {
  const rows = [row('1', 'X', 'Activo', 0, 3), row('2', 'Y', 'Activo', 0, 1), row('3', 'Z', 'Activo', 0, 2)];
  assert.deepEqual(sortClientRows(rows, 'services', 'asc').map((r) => r.serviceCount), [1, 2, 3]);
});

test('sortClientRows: orden estable -- un empate conserva el orden original entre esas filas', () => {
  const rows = [row('1', 'Mismo', 'Activo', 0, 0), row('2', 'Mismo', 'Activo', 0, 0), row('3', 'Otro', 'Activo', 0, 0)];
  assert.deepEqual(sortClientRows(rows, 'name', 'asc').map((r) => r.id), ['1', '2', '3']);
});

// ---- Query de URL (persistencia al volver de una ficha) ----

test('parseClientsListQuery: vacio o ausente siempre son los valores por defecto', () => {
  assert.deepEqual(parseClientsListQuery({}), DEFAULT_CLIENTS_LIST_QUERY);
});

test('parseClientsListQuery: valores reales se conservan tal cual', () => {
  const parsed = parseClientsListQuery({ section: 'retired', q: 'garcia', status: 'suspended', service: 'multi', sort: 'priority', dir: 'desc' });
  assert.deepEqual(parsed, { section: 'retired', q: 'garcia', status: 'suspended', service: 'multi', sort: 'priority', dir: 'desc' });
});

test('parseClientsListQuery: un valor fuera de las listas reales nunca rompe el filtro -- vuelve al default', () => {
  const parsed = parseClientsListQuery({ section: 'inventada', status: 'eliminado', service: 'otro', sort: 'telefono', dir: 'lateral' });
  assert.deepEqual(parsed, DEFAULT_CLIENTS_LIST_QUERY);
});

test('parseClientsListQuery: un query duplicado (array) usa el primer valor, nunca revienta', () => {
  const parsed = parseClientsListQuery({ q: ['ana', 'otronombre'], status: ['active', 'retired'] });
  assert.equal(parsed.q, 'ana');
  assert.equal(parsed.status, 'active');
});

test('buildClientsListQuery: todo en default -> URL limpia, sin ningun parametro', () => {
  assert.deepEqual(buildClientsListQuery(DEFAULT_CLIENTS_LIST_QUERY), {});
});

test('buildClientsListQuery: solo lleva lo que de verdad cambio respecto al default', () => {
  assert.deepEqual(
    buildClientsListQuery({ section: 'retired', q: '  Ana  ', status: 'suspended', service: 'all', sort: null, dir: 'asc' }),
    { section: 'retired', q: 'Ana', status: 'suspended' },
  );
});

test('buildClientsListQuery: columna de orden siempre viaja junto con su direccion', () => {
  assert.deepEqual(
    buildClientsListQuery({ ...DEFAULT_CLIENTS_LIST_QUERY, sort: 'services', dir: 'desc' }),
    { sort: 'services', dir: 'desc' },
  );
});

test('parseClientsListQuery seguido de buildClientsListQuery es identidad para una query real ya limpia', () => {
  const state = parseClientsListQuery({ section: 'pending_install', q: 'lopez', status: 'active', service: 'vigente', sort: 'name', dir: 'asc' });
  assert.deepEqual(buildClientsListQuery(state), { section: 'pending_install', q: 'lopez', status: 'active', service: 'vigente', sort: 'name', dir: 'asc' });
});
