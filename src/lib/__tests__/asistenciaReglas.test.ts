import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puntosGpsDe } from '../asistenciaReglas';

const base = {
  hora_ingreso: null as string | null,
  lat_ingreso: null as number | null,
  lng_ingreso: null as number | null,
  fin_almuerzo: null as string | null,
  lat_fin_almuerzo: null as number | null,
  lng_fin_almuerzo: null as number | null,
  hora_salida: null as string | null,
  lat_salida: null as number | null,
  lng_salida: null as number | null,
};

// ---- puntosGpsDe — causa raiz del bug "pantalla en blanco al ver GPS" ----
// (la vista le pasaba a Leaflet un arreglo vacio sin avisar; ahora un arreglo
// vacio es la senal explicita para mostrar "Ubicación GPS no disponible").

test('puntosGpsDe: sin coordenadas guardadas -> arreglo vacio, nunca inventa una ubicacion', () => {
  assert.deepEqual(puntosGpsDe(base), []);
});

test('puntosGpsDe: solo ingreso con GPS -> un punto verde', () => {
  const r = { ...base, hora_ingreso: '2026-10-16T13:05:00.000Z', lat_ingreso: -8.1105, lng_ingreso: -79.0287 };
  const puntos = puntosGpsDe(r);
  assert.equal(puntos.length, 1);
  assert.equal(puntos[0].color, '#22c55e');
  assert.equal(puntos[0].lat, -8.1105);
  assert.match(puntos[0].label, /^Ingreso /);
});

test('puntosGpsDe: ingreso, fin de almuerzo y salida con GPS -> tres puntos en orden', () => {
  const r = {
    ...base,
    hora_ingreso: '2026-10-16T13:05:00.000Z',
    lat_ingreso: -8.11,
    lng_ingreso: -79.02,
    fin_almuerzo: '2026-10-16T18:10:00.000Z',
    lat_fin_almuerzo: -8.12,
    lng_fin_almuerzo: -79.03,
    hora_salida: '2026-10-16T23:00:00.000Z',
    lat_salida: -8.13,
    lng_salida: -79.04,
  };
  const puntos = puntosGpsDe(r);
  assert.equal(puntos.length, 3);
  assert.deepEqual(puntos.map((p) => p.color), ['#22c55e', '#0ea5e9', '#ef4444']);
});

test('puntosGpsDe: ingreso marcado sin GPS (geolocalizacion denegada) -> no agrega el punto', () => {
  const r = { ...base, hora_ingreso: '2026-10-16T13:05:00.000Z', lat_ingreso: null, lng_ingreso: null };
  assert.deepEqual(puntosGpsDe(r), []);
});

test('puntosGpsDe: coordenadas devueltas como texto -> igual convierte a numero valido (nunca NaN)', () => {
  const r = { ...base, hora_ingreso: '2026-10-16T13:05:00.000Z', lat_ingreso: '-8.1105' as unknown as number, lng_ingreso: '-79.0287' as unknown as number };
  const puntos = puntosGpsDe(r);
  assert.equal(puntos.length, 1);
  assert.equal(typeof puntos[0].lat, 'number');
  assert.ok(!Number.isNaN(puntos[0].lat));
  assert.equal(puntos[0].lat, -8.1105);
});
