/**
 * Extrae un mensaje legible de cualquier error atrapado en un catch.
 *
 * Importante: los errores de Supabase (PostgrestError, AuthError) NO siempre
 * son instancias de `Error` en todas las versiones de las librerias — son
 * objetos planos con `message`/`details`/`hint`/`code`. Usar solo
 * `e instanceof Error` deja pasar esos casos al mensaje generico de fallback
 * y esconde la causa real (por ejemplo, una violacion de RLS).
 */
export function getErrorMessage(e: unknown, fallback = 'Ocurrio un error inesperado'): string {
  if (e instanceof Error) return e.message;

  if (typeof e === 'object' && e !== null && 'message' in e) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }

  return fallback;
}
