import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Acceso a `olt_provisioning_operations` + `olt_onts` para el flujo de
 * aprovisionamiento (Fase 2, ver oltProvisioningHandler.ts). Interfaz
 * angosta (no un cliente Supabase generico) a proposito — asi se puede
 * implementar con un fake en memoria para pruebas de las rutas reales sin
 * depender de la base de datos real (ver
 * server/src/services/__tests__/oltProvisioningHandler.test.ts), y la
 * version real (abajo) puede CHEQUEAR TODOS los errores de cada llamada
 * (requisito 5 de la revision externa) sin que ese detalle se filtre a la
 * logica de negocio.
 */
export interface ProvisioningOperationRow {
  id: string;
  idempotency_key: string;
  olt_device_id: string;
  serial: string;
  frame: number;
  slot: number;
  port: number;
  onu_id: number | null;
  client_id: string | null;
  contract_id: string | null;
  requested: Record<string, unknown>;
  status: string;
  steps: { stage: string; status: string; at: string; detail: string | null }[];
  ont_db_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewOperationInput {
  idempotency_key: string;
  olt_device_id: string;
  serial: string;
  frame: number;
  slot: number;
  port: number;
  client_id: string | null;
  contract_id: string | null;
  requested: Record<string, unknown>;
}

export interface OntRow {
  id: string;
  [key: string]: unknown;
}

export interface NewOntInput {
  olt_device_id: string;
  zone_id?: string | null;
  client_id: string | null;
  contract_id: string | null;
  frame: number;
  slot: number;
  port: number;
  ont_id: number;
  serial: string;
  description: string | null;
  onu_type: string;
  vlan: number;
  tcont_profile: string;
  traffic_profile: string;
}

export interface StoreResult<T> {
  data: T | null;
  /** Mensaje legible si algo fallo — SIEMPRE revisar esto antes de asumir que `data` es valido (requisito 5). */
  error: string | null;
}

export interface InsertOperationResult extends StoreResult<ProvisioningOperationRow> {
  /** true si el insert fallo especificamente por la clave unica (olt_device_id, idempotency_key) — ya existe una fila, hay que releerla en vez de tratarlo como un error real. */
  duplicateKey: boolean;
}

export interface ProvisioningStore {
  findOperationByKey(deviceId: string, idempotencyKey: string): Promise<StoreResult<ProvisioningOperationRow>>;
  findOperationById(id: string, deviceId: string): Promise<StoreResult<ProvisioningOperationRow>>;
  insertOperation(input: NewOperationInput): Promise<InsertOperationResult>;
  /** Append ATOMICO (un solo UPDATE en la base, ver migracion fase136b) — nunca pierde una etapa por una carrera de lectura-escritura. */
  appendStep(operationId: string, stage: string, status: string, detail: string | null): Promise<StoreResult<ProvisioningOperationRow>>;
  updateOperation(id: string, patch: Partial<ProvisioningOperationRow>): Promise<StoreResult<ProvisioningOperationRow>>;
  upsertOnt(input: NewOntInput): Promise<StoreResult<OntRow>>;
  getOntById(id: string): Promise<StoreResult<OntRow>>;
}

const UNIQUE_VIOLATION = '23505';

/** Implementacion real contra Supabase — revisa el `error` de CADA llamada, nunca asume que una escritura se guardo porque la promesa no lanzo. */
export function createSupabaseProvisioningStore(supabaseAdmin: SupabaseClient): ProvisioningStore {
  return {
    async findOperationByKey(deviceId, idempotencyKey) {
      const { data, error } = await supabaseAdmin
        .from('olt_provisioning_operations')
        .select('*')
        .eq('olt_device_id', deviceId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      return { data: (data as ProvisioningOperationRow | null) ?? null, error: error?.message ?? null };
    },

    async findOperationById(id, deviceId) {
      const { data, error } = await supabaseAdmin
        .from('olt_provisioning_operations')
        .select('*')
        .eq('id', id)
        .eq('olt_device_id', deviceId)
        .maybeSingle();
      return { data: (data as ProvisioningOperationRow | null) ?? null, error: error?.message ?? null };
    },

    async insertOperation(input) {
      const { data, error } = await supabaseAdmin.from('olt_provisioning_operations').insert(input).select().single();
      if (error) {
        // code 23505 = unique_violation — otra peticion concurrente con la
        // MISMA clave ya inserto la fila entre nuestro "findOperationByKey"
        // (que no la vio) y este insert. No es un error real: hay que
        // releerla, nunca reportarla como fallo al caller.
        const duplicateKey = (error as { code?: string }).code === UNIQUE_VIOLATION;
        return { data: null, error: error.message, duplicateKey };
      }
      return { data: data as ProvisioningOperationRow, error: null, duplicateKey: false };
    },

    async appendStep(operationId, stage, status, detail) {
      const { data, error } = await supabaseAdmin.rpc('append_provisioning_step', {
        p_operation_id: operationId,
        p_stage: stage,
        p_status: status,
        p_detail: detail,
      });
      return { data: (data as ProvisioningOperationRow | null) ?? null, error: error?.message ?? null };
    },

    async updateOperation(id, patch) {
      const { data, error } = await supabaseAdmin.from('olt_provisioning_operations').update(patch).eq('id', id).select().single();
      return { data: (data as ProvisioningOperationRow | null) ?? null, error: error?.message ?? null };
    },

    async upsertOnt(input) {
      const current = await supabaseAdmin.from('olt_onts').select('*')
        .eq('olt_device_id', input.olt_device_id).eq('frame', input.frame)
        .eq('slot', input.slot).eq('port', input.port).eq('ont_id', input.ont_id).maybeSingle();
      if (current.error) return { data: null, error: current.error.message };
      if (current.data && (
        String(current.data.serial).toUpperCase() !== input.serial.toUpperCase() ||
        (current.data.contract_id && current.data.contract_id !== input.contract_id) ||
        (current.data.client_id && current.data.client_id !== input.client_id)
      )) return { data: null, error: 'La posicion ya esta vinculada a otro serial, cliente o contrato' };
      const { data, error } = await supabaseAdmin
        .from('olt_onts')
        .upsert(
          { ...input, ...(current.data ? {} : { status: 'unknown' }) },
          { onConflict: 'olt_device_id,frame,slot,port,ont_id' },
        )
        .select()
        .single();
      return { data: (data as OntRow | null) ?? null, error: error?.message ?? null };
    },

    async getOntById(id) {
      const { data, error } = await supabaseAdmin.from('olt_onts').select('*').eq('id', id).maybeSingle();
      return { data: (data as OntRow | null) ?? null, error: error?.message ?? null };
    },
  };
}
