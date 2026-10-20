import { onScopeDispose, ref } from 'vue';

/** Re-evaluate presentation locally; never polls or configures physical equipment. */
export function useOntEvidenceClock() {
  const now = ref(Date.now());
  const timer = setInterval(() => { now.value = Date.now(); }, 1000);
  onScopeDispose(() => clearInterval(timer));
  return now;
}
