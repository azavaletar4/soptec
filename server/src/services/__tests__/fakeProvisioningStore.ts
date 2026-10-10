import type {
  ProvisioningStore,
  ProvisioningOperationRow,
  NewOperationInput,
  InsertOperationResult,
  StoreResult,
  OntRow,
  NewOntInput,
} from '../oltProvisioningStore';

/**
 * Store en memoria para probar oltProvisioningHandler.ts (las rutas reales,
 * sin Supabase) — ver server/src/services/__tests__/oltProvisioningHandler.test.ts.
 * Reproduce a proposito el mismo comportamiento de "insert falla por clave
 * duplicada" que el Postgres real (constraint UNIQUE olt_device_id+idempotency_key)
 * para poder probar la resolucion de carreras (requisito 2 de la revision externa).
 */
export function createFakeProvisioningStore() {
  const operations = new Map<string, ProvisioningOperationRow>();
  const onts = new Map<string, OntRow>();
  let nextOpId = 1;
  let nextOntId = 1;

  /** Permite forzar que la PROXIMA llamada a appendStep/updateOperation falle, para probar el manejo de errores de persistencia (requisito 5). */
  const failures = {
    appendStepOnce: false,
    updateOperationOnce: false,
    insertOperationOnce: false,
  };

  function keyFor(deviceId: string, idempotencyKey: string): string {
    return `${deviceId}::${idempotencyKey}`;
  }

  const store: ProvisioningStore = {
    async findOperationByKey(deviceId, idempotencyKey) {
      const op = [...operations.values()].find((o) => o.olt_device_id === deviceId && o.idempotency_key === idempotencyKey);
      return { data: op ?? null, error: null };
    },

    async findOperationById(id, deviceId) {
      const op = operations.get(id);
      if (!op || op.olt_device_id !== deviceId) return { data: null, error: null };
      return { data: op, error: null };
    },

    async insertOperation(input: NewOperationInput): Promise<InsertOperationResult> {
      if (failures.insertOperationOnce) {
        failures.insertOperationOnce = false;
        return { data: null, error: 'fallo simulado de insercion', duplicateKey: false };
      }
      const existingKey = keyFor(input.olt_device_id, input.idempotency_key);
      const alreadyThere = [...operations.values()].some(
        (o) => o.olt_device_id === input.olt_device_id && o.idempotency_key === input.idempotency_key,
      );
      if (alreadyThere) {
        return { data: null, error: 'duplicate key value violates unique constraint', duplicateKey: true };
      }
      const now = new Date().toISOString();
      const row: ProvisioningOperationRow = {
        id: `op-${nextOpId++}`,
        idempotency_key: input.idempotency_key,
        olt_device_id: input.olt_device_id,
        serial: input.serial,
        frame: input.frame,
        slot: input.slot,
        port: input.port,
        onu_id: null,
        client_id: input.client_id,
        contract_id: input.contract_id,
        requested: input.requested,
        status: 'pending',
        steps: [],
        ont_db_id: null,
        error: null,
        created_at: now,
        updated_at: now,
      };
      operations.set(row.id, row);
      void existingKey;
      return { data: row, error: null, duplicateKey: false };
    },

    async appendStep(operationId, stage, status, detail): Promise<StoreResult<ProvisioningOperationRow>> {
      if (failures.appendStepOnce) {
        failures.appendStepOnce = false;
        return { data: null, error: 'fallo simulado al guardar la etapa' };
      }
      const op = operations.get(operationId);
      if (!op) return { data: null, error: `operacion ${operationId} no existe` };
      // Simula el comportamiento ATOMICO real (un solo UPDATE en Postgres,
      // ver migracion fase136b): lee el valor MAS RECIENTE de `op.steps`
      // (no una copia vieja) y le agrega encima — como este store es
      // single-threaded en Node, esto ya es inherentemente seguro frente a
      // la carrera que afectaba al viejo SELECT+UPDATE desde el backend.
      op.steps = [...op.steps, { stage, status, at: new Date().toISOString(), detail }];
      op.updated_at = new Date().toISOString();
      return { data: op, error: null };
    },

    async updateOperation(id, patch): Promise<StoreResult<ProvisioningOperationRow>> {
      if (failures.updateOperationOnce) {
        failures.updateOperationOnce = false;
        return { data: null, error: 'fallo simulado al actualizar la operacion' };
      }
      const op = operations.get(id);
      if (!op) return { data: null, error: `operacion ${id} no existe` };
      Object.assign(op, patch, { updated_at: new Date().toISOString() });
      return { data: op, error: null };
    },

    async upsertOnt(input: NewOntInput): Promise<StoreResult<OntRow>> {
      const existing = [...onts.values()].find(
        (o) => o.olt_device_id === input.olt_device_id && o.frame === input.frame && o.slot === input.slot && o.port === input.port && o.ont_id === input.ont_id,
      );
      if (existing) {
        Object.assign(existing, input);
        return { data: existing, error: null };
      }
      const row: OntRow = { id: `ont-${nextOntId++}`, ...input };
      onts.set(row.id, row);
      return { data: row, error: null };
    },

    async getOntById(id) {
      return { data: onts.get(id) ?? null, error: null };
    },
  };

  return {
    store,
    failures,
    /** Para que los tests inspeccionen el estado interno sin pasar por la interfaz publica. */
    _operations: operations,
    _onts: onts,
  };
}
