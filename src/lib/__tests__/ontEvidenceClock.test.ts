import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computed, effectScope, ref } from 'vue';
import { useOntEvidenceClock } from '../../composables/useOntEvidenceClock';
import { enforceOntEvidence } from '../ontTelemetryEvidence';

test('ficha/TR069 abiertos: evidencia caduca sin fetch y el reloj se detiene al cerrar', t => {
  const start = Date.parse('2026-10-20T21:00:00Z');
  t.mock.timers.enable({apis:['setInterval','Date'],now:start});
  const scope = effectScope();
  const state = scope.run(()=>{
    const now=useOntEvidenceClock();
    const loaded=ref({status:'online' as const,rx_power:-23.98,tx_power:2,telemetry:{outcome:'valid',validUntil:new Date(start+1000).toISOString(),checkedAt:new Date(start).toISOString(),signalOutcome:'valid'}});
    return {now,loaded,presented:computed(()=>enforceOntEvidence(loaded.value,now.value))};
  })!;
  assert.equal(state.presented.value.status,'online');
  t.mock.timers.tick(2000);
  assert.equal(state.presented.value.status,'unknown'); assert.equal(state.presented.value.rx_power,null);
  assert.equal(state.loaded.value.status,'online','presentation does not mutate historical input');
  scope.stop(); const stopped=state.now.value; t.mock.timers.tick(2000); assert.equal(state.now.value,stopped);
});
