import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeaningfulPowerChange, SIGNAL_WRITE_DEADBAND_DBM } from '../oltSyncService';

// Diagnostico de consumo de logs de Supabase (21/11/2026): esta funcion es
// el filtro que evita escribir en olt_onts por el ruido normal (decimas de
// dB) de la senal optica entre sync y sync. Ver el comentario junto a su
// definicion en oltSyncService.ts para la evidencia completa (~700
// solicitudes reales por ciclo antes de esta correccion).

test('sin lectura nueva este ciclo (undefined) nunca dispara escritura', () => {
  assert.equal(isMeaningfulPowerChange(-19.5, undefined), false);
  assert.equal(isMeaningfulPowerChange(null, undefined), false);
});

test('sin lectura previa (ONT nueva o primer sync) siempre escribe, aunque el valor sea 0', () => {
  assert.equal(isMeaningfulPowerChange(null, -19.5), true);
  assert.equal(isMeaningfulPowerChange(null, 0), true);
});

test('ruido normal por debajo del umbral no dispara escritura', () => {
  assert.equal(isMeaningfulPowerChange(-19.5, -19.5), false);
  assert.equal(isMeaningfulPowerChange(-19.5, -19.6), false);
  assert.equal(isMeaningfulPowerChange(-19.5, -19.99), false);
});

test('un cambio real (>= umbral) siempre dispara escritura, en cualquier direccion', () => {
  assert.equal(isMeaningfulPowerChange(-19.5, -20.0), true);
  assert.equal(isMeaningfulPowerChange(-19.5, -19.0), true);
  assert.equal(isMeaningfulPowerChange(-19.5, -19.5 - SIGNAL_WRITE_DEADBAND_DBM), true);
});

test('exactamente en el borde del umbral cuenta como cambio (>=, nunca lo esconde)', () => {
  const edge = -19.5 - SIGNAL_WRITE_DEADBAND_DBM;
  assert.equal(isMeaningfulPowerChange(-19.5, edge), true);
});

// Requisito explicito (21/11/2026): una lectura valida no debe quedar
// "permanentemente obsoleta" por este filtro. Simula el mismo patron que
// oltSyncService.ts aplica ciclo a ciclo (compara contra el ultimo valor
// REALMENTE PERSISTIDO; si el cambio es significativo, ese valor nuevo pasa
// a ser el baseline persistido para el siguiente ciclo) y comprueba la cota:
// lo persistido nunca puede quedar a mas de SIGNAL_WRITE_DEADBAND_DBM de la
// ultima lectura real, sin importar cuantos ciclos pasen.
function simulatePersistedBaseline(readings: number[]): number[] {
  let persisted: number | null = null;
  const history: number[] = [];
  for (const reading of readings) {
    if (isMeaningfulPowerChange(persisted, reading)) persisted = reading;
    history.push(persisted!);
  }
  return history;
}

test('deriva lenta y monotona en la misma direccion: el valor persistido nunca se queda atras mas del umbral', () => {
  const readings = Array.from({ length: 40 }, (_, i) => -15 - i * 0.1); // -15.0 .. -18.9, 0.1dB/ciclo
  const persistedHistory = simulatePersistedBaseline(readings);
  readings.forEach((reading, i) => {
    assert.ok(
      Math.abs(persistedHistory[i] - reading) < SIGNAL_WRITE_DEADBAND_DBM,
      `ciclo ${i}: persistido=${persistedHistory[i]} lectura=${reading} difieren >= ${SIGNAL_WRITE_DEADBAND_DBM}dB`,
    );
  });
});

test('oscilacion dentro de la banda de ruido: nunca escribe, pero tampoco se "pierde" (sigue dentro del umbral del valor real)', () => {
  const readings = [-19.5, -19.6, -19.4, -19.55, -19.45, -19.5, -19.6];
  const persistedHistory = simulatePersistedBaseline(readings);
  assert.ok(persistedHistory.every((v) => v === -19.5), 'nunca debio escribir: toda la oscilacion esta dentro de la banda de ruido');
  readings.forEach((reading, i) => {
    assert.ok(Math.abs(persistedHistory[i] - reading) < SIGNAL_WRITE_DEADBAND_DBM);
  });
});
