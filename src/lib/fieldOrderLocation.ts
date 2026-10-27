import type { Client, ServiceContract } from '@/types/domain';

type LocationContract = Pick<ServiceContract,
  'id' | 'client_id' | 'contract_number' | 'installation_address' | 'latitude' | 'longitude'>;
type LocationClient = Pick<Client, 'id' | 'address'>;
export interface FieldLocationJob {
  clientId: string | null;
  contractId: string | null;
  direccion: string | null;
}
export interface FieldGps { lat: number; lng: number }

export function isOrderContract(job: FieldLocationJob, contract: LocationContract | null): boolean {
  return !!job.clientId && !!job.contractId && contract?.id === job.contractId && contract.client_id === job.clientId;
}

/** Solo presentación. Nunca elige otro servicio ni cambia el contexto de cierre. */
export function fieldOrderLocation(
  job: FieldLocationJob,
  client: LocationClient | null,
  contract: LocationContract | null,
  legacyGps: FieldGps | null,
) {
  if (!job.contractId) {
    return { address: job.direccion, source: 'legacy' as const, contractNumber: null, gps: legacyGps };
  }
  if (!isOrderContract(job, contract) || !contract) {
    return { address: null, source: 'unavailable' as const, contractNumber: null, gps: null };
  }
  const address = contract.installation_address?.trim() || null;
  const fallback = client?.id === job.clientId ? client.address?.trim() || null : null;
  const lat = contract.latitude, lng = contract.longitude;
  // Un par completo del mismo contrato: nunca combinar latitud/longitud de orígenes distintos.
  const gps = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  return {
    address: address ?? fallback,
    source: address ? 'contract' as const : 'client' as const,
    contractNumber: contract.contract_number,
    gps,
  };
}
