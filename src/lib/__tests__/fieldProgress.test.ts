import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { usePersonalRead } from '../../composables/usePersonalRead';
import { contributionsInPeriod, type FieldProgress } from '../fieldProgress';

test('lectura personal: carga/error no muestran cero ni datos anteriores; reintento', async () => {
  const scope = effectScope();
  const id = ref<string|null>('tech-a');
  let fail = false;
  const state = scope.run(() => usePersonalRead(id, async () => {
    if (fail) throw Error('offline');
    return { points: 12 };
  }))!;
  assert.equal(state.loading.value,true);
  assert.equal(state.data.value,null);
  await state.load();
  assert.deepEqual(state.data.value,{points:12});
  fail=true;
  const retry=state.load();
  assert.equal(state.data.value,null);
  await retry;
  assert.equal(state.error.value,'offline');
  assert.equal(state.loading.value,false);
  assert.equal(state.data.value,null);
  fail=false;
  await state.load();
  assert.equal(state.error.value,null);
  assert.deepEqual(state.data.value,{points:12});
  scope.stop();
});

test('cambio de técnico/salida/desmontaje descarta respuestas tardías y datos privados', async () => {
  const scope=effectScope(); const id=ref<string|null>('a');
  const replies: Array<(v:string)=>void>=[];
  const state=scope.run(()=>usePersonalRead(id,()=>new Promise<string>(resolve=>replies.push(resolve))))!;
  id.value='b';
  replies[0]!('datos de a'); await Promise.resolve();
  assert.equal(state.data.value,null);
  replies[1]!('datos de b'); await Promise.resolve();
  assert.equal(state.data.value,'datos de b');
  id.value=null;
  assert.equal(state.data.value,null); assert.equal(state.loading.value,false);
  id.value='c'; scope.stop(); replies[2]!('datos de c'); await Promise.resolve();
  assert.equal(state.data.value,null);
});

test('historial usa límites enviados por SQL, incluye descuentos y excluye fin exacto', () => {
  const make=(date:string, points=5)=>({jobType:'ticket' as const,jobId:date,occurredAt:date,kind:points<0?'recurrence' as const:'work' as const,crewSize:1,points});
  const period={start:'2026-10-01T05:00:00Z',end:'2026-11-01T05:00:00Z',points:0};
  const data:FieldProgress={asOf:period.start,timezone:'America/Lima',periods:{today:period,week:period,month:period},contributions:[
    make('2026-10-01T04:59:59Z'), make(period.start),make('2026-11-01T04:59:59Z',-5),make(period.end),
  ]};
  assert.deepEqual(contributionsInPeriod(data,'month').map(e=>e.points),[5,-5]);
});
