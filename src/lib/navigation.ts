/** Destino de "Inicio" segun el rol — TECNICO_RED no tiene Dashboard (ver
 *  NOT_TECNICO en router/index.ts), su pantalla de aterrizaje es Soporte.
 *  Debe coincidir con homeFor() en router/index.ts y el post-login de
 *  LoginView.vue. Separado en su propio archivo porque lo usan tanto el
 *  logo-link de AppLayout.vue como el crumb "Inicio" de Breadcrumbs.vue. */
export function homePath(role: string | null | undefined): string {
  return role === 'TECNICO_RED' ? '/soporte' : '/dashboard';
}
