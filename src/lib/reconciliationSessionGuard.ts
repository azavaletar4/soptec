import { watch } from 'vue';

export interface ReconciliationRequestContext {
  generation: number;
  actorId: string | null | undefined;
  role: string | null | undefined;
}

/**
 * Una lectura solo se aplica si TODAVÍA corresponde a la petición vigente,
 * al mismo usuario y al mismo rol — nunca una respuesta tardía de una
 * petición anterior, de otro usuario, o con un rol que ya cambió mientras
 * la lectura estaba en curso.
 */
export function isReconciliationResultCurrent(requested: ReconciliationRequestContext, current: ReconciliationRequestContext): boolean {
  return requested.generation === current.generation && requested.actorId === current.actorId && requested.role === current.role;
}

/**
 * Dispara `onIdentityChanged` SOLO cuando el id de usuario o el rol cambian
 * de VALOR real — nunca por una renovación de sesión del mismo usuario.
 *
 * Causa raíz del bug reportado: `onAuthStateChange` (src/stores/auth.ts)
 * reemplaza `user` por un objeto NUEVO en cada evento, incluido
 * TOKEN_REFRESHED — y Supabase dispara ese refresco rutinariamente al
 * recuperar el foco de la pestaña, aunque id/rol sigan siendo los mismos.
 * `watch(() => [a, b], cb)` (un solo getter que arma un array LITERAL
 * nuevo en cada evaluación) dispara `cb` en cualquier renovación, porque
 * Vue compara la identidad del array devuelto, no sus valores — nunca
 * detecta que id/rol no cambiaron. `watch([a, b], cb)` (múltiples fuentes)
 * sí compara cada valor por separado; aquí además se repite la
 * comparación de forma explícita como defensa adicional, independiente de
 * ese detalle interno de Vue.
 */
export function watchSessionIdentity(
  getUserId: () => string | null | undefined,
  getRole: () => string | null | undefined,
  onIdentityChanged: () => void,
) {
  return watch(
    [getUserId, getRole],
    ([newId, newRole], [oldId, oldRole]) => {
      if (newId === oldId && newRole === oldRole) return;
      onIdentityChanged();
    },
    { flush: 'sync' },
  );
}
