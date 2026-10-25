import { ref, watch, toValue, onScopeDispose, type MaybeRefOrGetter } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { workOrderIsFinal } from '@/lib/workOrderFinality';
import { getErrorMessage } from '@/lib/errors';
import type { JobType } from '@/types/domain';

export function useWorkOrderFinality(jobType: JobType, jobId: MaybeRefOrGetter<string>) {
  const auth = useAuthStore();
  const locked = ref(true);
  const loading = ref(false);
  const error = ref('');
  let generation = 0;
  async function refresh() {
    const request = ++generation;
    locked.value = true; loading.value = true; error.value = '';
    try {
      const result = await workOrderIsFinal(jobType, toValue(jobId));
      if (request === generation) locked.value = result;
    } catch (e) { if (request === generation) error.value = getErrorMessage(e, 'No se pudo verificar el cierre administrativo.'); }
    finally { if (request === generation) loading.value = false; }
  }
  function markClosed() { generation++; locked.value = true; loading.value = false; error.value = ''; }
  watch(() => [toValue(jobId), auth.user?.id, auth.role], () => { void refresh(); }, { immediate: true });
  onScopeDispose(() => { generation++; });
  return { locked, loading, error, refresh, markClosed };
}
