import { ref, shallowRef, watch, onScopeDispose, type Ref } from 'vue';

/** Discard late replies and old data whenever the authenticated identity changes. */
export function usePersonalRead<T>(identity: Ref<string | null>, read: () => Promise<T>) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;
  async function load() {
    const request = ++generation;
    data.value = null;
    error.value = null;
    loading.value = !!identity.value;
    if (!identity.value) return;
    try {
      const result = await read();
      if (request === generation) data.value = result;
    } catch (e) {
      if (request === generation) error.value = e instanceof Error ? e.message : 'No se pudo consultar. Intenta nuevamente.';
    } finally {
      if (request === generation) loading.value = false;
    }
  }
  watch(identity, () => { void load(); }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => { generation++; });
  return { data, loading, error, load };
}
