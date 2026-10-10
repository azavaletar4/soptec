export interface ProvisioningSecret {
  '.id': string;
  name: string;
  profile: string;
  service?: string;
  disabled?: string | boolean;
  comment?: string;
}
export interface MikrotikProvisionInput {
  mode: string;
  name: string;
  existingId?: string;
  profile: string;
  password?: string;
  operationKey: string;
}
export type RouterRequest = <T>(path: string, opts?: { method?: string; body?: unknown; retries?: number }) => Promise<T>;

/** Creates are never blindly retried. A subsequent attempt first checks
 * ownership by operation marker, then verifies the desired RouterOS fields. */
export async function syncProvisioningSecret(request: RouterRequest, input: MikrotikProvisionInput): Promise<void> {
  if (!input.name || !input.profile || !['create', 'existing'].includes(input.mode)) throw new Error('Datos PPPoE incompletos');
  const marker = `smartrayco:${input.operationKey}`;
  const read = () => request<ProvisioningSecret[]>('/ppp/secret');
  let secrets = await read();
  let found = secrets.find(s => s.name === input.name);
  if (input.mode === 'create') {
    if (found && found.comment !== marker) throw new Error('El usuario PPPoE ya existe y pertenece a otra operacion; no se modifico');
    if (!found) {
      if (!input.password) throw new Error('Falta la clave PPPoE para crear la credencial pendiente');
      await request('/ppp/secret', { method: 'PUT', retries: 0,
        body: { name: input.name, password: input.password, profile: input.profile, service: 'pppoe', disabled: 'false', comment: marker } });
    }
  } else {
    if (!found || found['.id'] !== input.existingId) throw new Error('El secreto PPPoE seleccionado ya no coincide con el router');
    // Existing credentials belong to the WinBox/contract workflow.
    // Authorization must not activate them or change their profile/password.
    return;
  }
  secrets = await read();
  found = secrets.find(s => s.name === input.name);
  if (!found || found.profile !== input.profile || (found.disabled !== false && found.disabled !== 'false') ||
      (found.service !== 'pppoe' && found.service !== 'any') ||
      (input.mode === 'create' && found.comment !== marker)) {
    throw new Error('MikroTik no confirmo usuario, perfil y activacion PPPoE; la etapa queda pendiente');
  }
}
