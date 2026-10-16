import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readOrderInventory } from '../orderInventory.ts';

const actor = '00000000-0000-4000-8000-000000000001';
const job = '00000000-0000-4000-8000-000000000002';
const baseContext = { actorId: actor, jobId: job, jobType: 'installation' as const, clientId: null, contractId: null };

type Reply = { code: string } | { body: Record<string, unknown> };

function fixture(replies: Reply[]) {
  let call = 0;
  const calls: Record<string, unknown>[] = [];
  const db = createClient('https://order.invalid', 'synthetic-public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push(JSON.parse(String(init?.body)));
        assert.equal(path, '/rest/v1/rpc/inventory_order_read');
        const reply = replies[Math.min(call, replies.length - 1)];
        call++;
        if ('code' in reply) {
          return new Response(JSON.stringify({ code: reply.code, message: 'synthetic error' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(reply.body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  return { db, calls };
}

test('tecnico retirado de la cuadrilla: 42501 se propaga como 403 y no sigue paginando', async () => {
  const f = fixture([{ code: '42501' }]);
  await assert.rejects(
    readOrderInventory(f.db, actor, 'installation', job, 'assigned'),
    (e: unknown) => (e as { status?: number }).status === 403,
  );
  assert.equal(f.calls.length, 1);
});

test('sesion vencida: PGRST301 se propaga como 401', async () => {
  const f = fixture([{ code: 'PGRST301' }]);
  await assert.rejects(
    readOrderInventory(f.db, actor, 'installation', job, 'materials'),
    (e: unknown) => (e as { status?: number }).status === 401,
  );
});

test('la orden no corresponde a esta identidad: se rechaza sin publicar datos ajenos', async () => {
  const f = fixture([{ body: { context: { ...baseContext, actorId: job }, items: [], next: null } }]);
  await assert.rejects(
    readOrderInventory(f.db, actor, 'installation', job, 'assigned'),
    (e: unknown) => (e as { status?: number }).status === 403,
  );
});

test('el contexto cambia entre paginas (asignacion revocada a mitad de lectura): corta sin mezclar paginas', async () => {
  const f = fixture([
    { body: { context: baseContext, items: [{ id: 1 }], next: 1 } },
    { body: { context: { ...baseContext, contractId: 'otro-contrato' }, items: [{ id: 2 }], next: null } },
  ]);
  await assert.rejects(
    readOrderInventory(f.db, actor, 'installation', job, 'assigned'),
    (e: unknown) => (e as { status?: number }).status === 403,
  );
  assert.equal(f.calls.length, 2);
});

test('isCurrent() deja de ser vigente entre paginas: se detiene sin completar la lectura', async () => {
  let n = 0;
  const isCurrent = () => n++ === 0;
  const f = fixture([
    { body: { context: baseContext, items: [{ id: 1 }], next: 1 } },
    { body: { context: baseContext, items: [{ id: 2 }], next: null } },
  ]);
  await assert.rejects(
    readOrderInventory(f.db, actor, 'installation', job, 'assigned', isCurrent),
    (e: unknown) => (e as { status?: number }).status === 403,
  );
  assert.equal(f.calls.length, 2);
});

test('lectura autorizada normal: pagina, acumula items y conserva el contexto', async () => {
  const f = fixture([
    { body: { context: baseContext, items: [{ id: 1 }], next: 1 } },
    { body: { context: baseContext, items: [{ id: 2 }], next: null } },
  ]);
  const result = await readOrderInventory(f.db, actor, 'installation', job, 'assigned');
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(result.context, baseContext);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], { p_job_type: 'installation', p_job_id: job, p_view: 'assigned', p_page: 0 });
  assert.deepEqual(f.calls[1], { p_job_type: 'installation', p_job_id: job, p_view: 'assigned', p_page: 1 });
});
