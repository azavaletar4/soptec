import type { ProvisionRequestBody } from './oltProvisioningHandler';

export interface ContractReference {
  id: string;
  client_id: string;
  mikrotik_device_id: string | null;
  pppoe_username: string | null;
  mikrotik_profile: string | null;
}
export interface PppoeReference {
  deviceId: string;
  username: string;
  profile: string;
  secretId?: string;
}
export interface ContractReferenceRepository {
  getContract(id: string): Promise<ContractReference | null>;
  hasOtherContract(routerId: string, username: string, contractId: string): Promise<boolean>;
  readSecrets(routerId: string): Promise<{ '.id': string; name: string; profile: string }[]>;
}

/** Read-only preflight. It never creates, enables or changes RouterOS secrets. */
export async function validateProvisioningContract(
  repository: ContractReferenceRepository,
  body: Pick<ProvisionRequestBody, 'clientId' | 'contractId' | 'mikrotik' | 'pppoeReference' | 'wan'>,
): Promise<void> {
  if (!body.clientId?.trim() || !body.contractId?.trim()) {
    throw new Error('Selecciona un cliente y un contrato antes de autorizar la ONU');
  }
  const contract = await repository.getContract(body.contractId);
  if (!contract || contract.client_id !== body.clientId) throw new Error('El contrato no pertenece al cliente seleccionado');
  if (!contract.mikrotik_device_id || !contract.pppoe_username || !contract.mikrotik_profile) {
    throw new Error('Vincula primero router, usuario y perfil PPPoE al contrato desde la ficha del cliente');
  }
  if (body.mikrotik && body.mikrotik.secretMode !== 'existing') {
    throw new Error('Autorizar una ONU solo usa referencias PPPoE existentes; crea y vincula el usuario previamente');
  }
  const reference = body.pppoeReference;
  const legacy = body.mikrotik;
  if ((reference && (reference.deviceId !== contract.mikrotik_device_id || reference.username !== contract.pppoe_username || reference.profile !== contract.mikrotik_profile)) ||
      (legacy && (legacy.deviceId !== contract.mikrotik_device_id || legacy.existingSecretName !== contract.pppoe_username || legacy.profile !== contract.mikrotik_profile))) {
    throw new Error('Las referencias PPPoE no coinciden con el contrato');
  }
  if (body.wan && (body.wan.username !== contract.pppoe_username || !body.wan.vlanProfile?.trim())) {
    throw new Error('La WAN opcional debe usar el usuario PPPoE del contrato y un perfil VLAN');
  }
  if (await repository.hasOtherContract(contract.mikrotik_device_id, contract.pppoe_username, contract.id)) {
    throw new Error('La referencia PPPoE está vinculada a otro contrato');
  }
  const secrets = await repository.readSecrets(contract.mikrotik_device_id);
  const secret = secrets.find(item => item.name === contract.pppoe_username);
  if (!secret || secret.profile !== contract.mikrotik_profile ||
      (reference?.secretId && reference.secretId !== secret['.id']) ||
      (legacy && legacy.existingSecretId !== secret['.id'])) {
    throw new Error('MikroTik no confirma la referencia PPPoE del contrato; revisa el vínculo sin modificar el usuario');
  }
}
