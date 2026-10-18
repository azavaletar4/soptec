import test from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { isReconciliationResultCurrent, watchSessionIdentity, type ReconciliationRequestContext } from '../reconciliationSessionGuard';

test('una renovación de sesión del mismo usuario (objeto nuevo, mismo id) NO dispara el cambio', () => {
  const user = ref<{ id: string } | null>({ id: 'u1' });
  const role = ref<string | null>('ADMIN');
  let calls = 0;
  watchSessionIdentity(() => user.value?.id, () => role.value, () => { calls++; });
  // Simula el TOKEN_REFRESHED que Supabase dispara al recuperar el foco de
  // la pestaña: onAuthStateChange reemplaza `user` por un objeto NUEVO con
  // el mismo id — esto es, byte a byte, la causa raíz del bug reportado.
  user.value = { id: 'u1' };
  assert.equal(calls, 0);
  role.value = 'ADMIN';
  assert.equal(calls, 0);
});

test('un cambio real de usuario SÍ dispara el cambio', () => {
  const user = ref<{ id: string } | null>({ id: 'u1' });
  const role = ref<string | null>('ADMIN');
  let calls = 0;
  watchSessionIdentity(() => user.value?.id, () => role.value, () => { calls++; });
  user.value = { id: 'u2' };
  assert.equal(calls, 1);
});

test('un cambio real de rol/permisos SÍ dispara el cambio', () => {
  const user = ref<{ id: string } | null>({ id: 'u1' });
  const role = ref<string | null>('ADMIN');
  let calls = 0;
  watchSessionIdentity(() => user.value?.id, () => role.value, () => { calls++; });
  role.value = 'TECNICO_RED';
  assert.equal(calls, 1);
});

test('cerrar sesión (usuario a null) SÍ dispara el cambio', () => {
  const user = ref<{ id: string } | null>({ id: 'u1' });
  const role = ref<string | null>('ADMIN');
  let calls = 0;
  watchSessionIdentity(() => user.value?.id, () => role.value, () => { calls++; });
  user.value = null;
  assert.equal(calls, 1);
});

test('isReconciliationResultCurrent descarta resultados tardíos, de otro usuario o de otro rol', () => {
  const requested: ReconciliationRequestContext = { generation: 1, actorId: 'u1', role: 'ADMIN' };
  assert.equal(isReconciliationResultCurrent(requested, { generation: 1, actorId: 'u1', role: 'ADMIN' }), true);
  // Petición tardía/abortada: ya se disparó otra lectura (generation avanzó).
  assert.equal(isReconciliationResultCurrent(requested, { generation: 2, actorId: 'u1', role: 'ADMIN' }), false);
  // El usuario cambió mientras la lectura estaba en curso.
  assert.equal(isReconciliationResultCurrent(requested, { generation: 1, actorId: 'u2', role: 'ADMIN' }), false);
  // El rol cambió mientras la lectura estaba en curso.
  assert.equal(isReconciliationResultCurrent(requested, { generation: 1, actorId: 'u1', role: 'TECNICO_RED' }), false);
});
