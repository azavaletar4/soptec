<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { supabase } from '@/lib/supabase';
import { useInventoryStore } from '@/stores/inventory';
import { useInventoryUnitsStore } from '@/stores/inventoryUnits';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { executeRoutineInventory, pendingRoutineInventory, type RoutineInventoryAction, type RoutineInventoryRequest } from '@/lib/routineInventoryRequest';
import type { InventoryMovement, InventoryUnit, Routine } from '@/types/domain';

const props = defineProps<{ routine: Routine; canWrite?: boolean }>();
const auth = useAuthStore();
const inventory = useInventoryStore();
const units = useInventoryUnitsStore();
type RoutineUnit = InventoryUnit & { routine_id: string | null };
type EventRow = { id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string; unit: { serial_number: string | null; mac_address: string | null } | null };
const materials = ref<InventoryMovement[]>([]);
const linked = ref<RoutineUnit[]>([]);
const assigned = ref<InventoryUnit[]>([]);
const available = ref<InventoryUnit[]>([]);
const events = ref<EventRow[]>([]);
const contracts = ref<{ id: string; contract_number: string }[]>([]);
const pending = ref<RoutineInventoryRequest | null>(null);
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const productId = ref('');
const quantity = ref(1);
const equipmentProduct = ref('');
const incoming = ref('');
const outgoing = ref('');
const contractId = ref(props.routine.contract_id ?? '');
const reason = ref('');
const correction = ref('');
const correctionQty = ref(1);
const condition = ref<'in_stock' | 'damaged' | 'in_repair'>('in_stock');
const office = computed(() => ['SUPERADMIN', 'ADMIN', 'SOPORTE'].includes(auth.role ?? ''));
const writable = computed(() => props.canWrite && auth.role === 'TECNICO_RED' && props.routine.status === 'in_progress');
const blocked = computed(() => busy.value || loading.value || !!pending.value);
const consumables = computed(() => inventory.products.filter(p => p.is_active && !p.is_serialized));
const serialized = computed(() => inventory.products.filter(p => p.is_active && p.is_serialized));
const activeMaterials = computed(() => {
  const reversed = new Set(materials.value.map(m => m.reverses_movement_id).filter(Boolean));
  return materials.value.filter(m => m.movement_type === 'egreso' && !reversed.has(m.id));
});
const outgoingChoices = computed(() => assigned.value.filter(u => u.status === 'assigned' && u.contract_id === (contractId.value || null)));

function refreshPending() {
  pending.value = auth.user ? pendingRoutineInventory(localStorage, auth.user.id, props.routine.id) : null;
}
async function load() {
  loading.value = true;
  try {
    refreshPending();
    const [m, u, e] = await Promise.all([
      supabase.from('inventory_movements').select('*, product:inventory_products(id,name,unit)').eq('routine_id', props.routine.id).order('created_at'),
      supabase.from('inventory_units').select('*, product:inventory_products(id,name,category)').eq('routine_id', props.routine.id),
      supabase.from('inventory_unit_events').select('id,from_status,to_status,reason,created_at,unit:inventory_units(serial_number,mac_address)').eq('routine_id', props.routine.id).order('created_at'),
      inventory.fetchProducts(),
    ]);
    for (const response of [m, u, e]) if (response.error) throw response.error;
    materials.value = m.data as InventoryMovement[];
    linked.value = u.data as RoutineUnit[];
    events.value = e.data as unknown as EventRow[];
    if (props.routine.client_id) {
      const c = await supabase.from('service_contracts').select('id,contract_number').eq('client_id', props.routine.client_id);
      if (c.error) throw c.error;
      contracts.value = c.data;
      assigned.value = await units.fetchUnitsByClient(props.routine.client_id);
    } else { contracts.value = []; assigned.value = []; }
  } finally { loading.value = false; }
}
async function loadAvailable() {
  available.value = []; incoming.value = '';
  if (equipmentProduct.value) available.value = (await units.fetchUnitsByProduct(equipmentProduct.value)).filter(u => u.status === 'in_stock');
}
async function mutate(action: RoutineInventoryAction, payload: Record<string, unknown>) {
  if (busy.value || !auth.user) return;
  busy.value = true; error.value = '';
  try {
    await executeRoutineInventory(localStorage, auth.user.id, props.routine.id, action, payload,
      async request => await supabase.rpc('routine_inventory_operation', request));
    // Clear forms before reads: a failed refresh must not repeat a committed write.
    productId.value = ''; quantity.value = 1; incoming.value = ''; outgoing.value = ''; correction.value = ''; reason.value = '';
    await load();
    if (equipmentProduct.value) await loadAvailable();
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo registrar inventario'); }
  finally { busy.value = false; refreshPending(); }
}
const equipmentPayload = (unitId: string) => ({ unit_id: unitId, contract_id: contractId.value || null, reason: reason.value });
watch(() => [props.routine.id, auth.user?.id], async () => {
  contractId.value = props.routine.contract_id ?? '';
  error.value = '';
  try { await load(); } catch (e) { error.value = getErrorMessage(e, 'No se pudo cargar inventario de la rutina'); }
}, { immediate: true });
</script>

<template>
  <section class="surface p-3.5 mb-3 space-y-3">
    <h2 class="text-sm font-semibold">Materiales y equipos de la rutina</h2>
    <p class="text-xs text-slate-500">Bodega central. Los registros se conservan al devolver o reasignar la rutina.</p>
    <p v-if="error" role="alert" class="text-xs text-red-600">{{ error }}</p>
    <div v-if="pending" class="text-xs text-amber-700 space-y-2">
      <p>Hay una operación sin respuesta confirmada. Resuélvela antes de registrar otra.</p>
      <button type="button" :disabled="busy" class="btn-secondary text-xs" @click="mutate(pending.p_action, pending.p_payload)">Reintentar operación pendiente</button>
    </div>
    <h3 class="text-xs font-semibold">Materiales utilizados</h3>
    <ul class="space-y-2 text-xs">
      <li v-for="m in activeMaterials" :key="m.id">
        {{ m.product?.name }} — {{ m.quantity }} {{ m.product?.unit }}
        <template v-if="writable">
          <button type="button" class="text-sky-700 ml-2" :disabled="blocked" @click="correction = m.id; correctionQty = m.quantity">Corregir</button>
          <button type="button" class="text-red-600 ml-2" :disabled="blocked" @click="mutate('remove', { movement_id: m.id })">Quitar registro</button>
        </template>
      </li>
    </ul>
    <p v-if="!activeMaterials.length" class="text-xs text-slate-500">Sin consumos registrados.</p>
    <div v-if="writable && correction" class="flex gap-2">
      <input v-model.number="correctionQty" aria-label="Cantidad corregida" type="number" min="0.01" step="0.01" class="field-input" />
      <button type="button" :disabled="blocked" class="btn-secondary text-xs" @click="mutate('correct', { movement_id: correction, quantity: correctionQty })">Guardar corrección</button>
    </div>
    <div v-if="writable" class="space-y-2">
      <select v-model="productId" aria-label="Material de bodega" class="field-input">
        <option value="">Selecciona material...</option>
        <option v-for="p in consumables" :key="p.id" :value="p.id">{{ p.name }} — {{ p.current_stock }} {{ p.unit }}</option>
      </select>
      <input v-model.number="quantity" aria-label="Cantidad utilizada" type="number" min="0.01" step="0.01" class="field-input" />
      <button type="button" :disabled="blocked || !productId" class="btn-secondary text-xs" @click="mutate('consume', { product_id: productId, quantity })">Registrar material utilizado</button>
    </div>
    <template v-if="writable && routine.client_id">
      <h3 class="text-xs font-semibold">Equipos por serie/MAC</h3>
      <select v-model="contractId" aria-label="Contrato del equipo" :disabled="!!routine.contract_id || blocked" class="field-input">
        <option value="">{{ contracts.length ? 'Selecciona contrato...' : 'Cliente sin contrato' }}</option>
        <option v-for="c in contracts" :key="c.id" :value="c.id">{{ c.contract_number || c.id }}</option>
      </select>
      <input v-model="reason" aria-label="Motivo del movimiento" placeholder="Motivo / condición física" class="field-input" />
      <select v-model="equipmentProduct" aria-label="Producto serializado" class="field-input" @change="loadAvailable().catch(e => error = getErrorMessage(e))">
        <option value="">Equipo entrante...</option><option v-for="p in serialized" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="incoming" aria-label="Serie o MAC entrante" class="field-input"><option value="">Serie/MAC de bodega...</option><option v-for="u in available" :key="u.id" :value="u.id">{{ u.serial_number || u.mac_address }}</option></select>
      <button type="button" :disabled="blocked || !incoming" class="btn-secondary text-xs" @click="mutate('install', equipmentPayload(incoming))">Registrar equipo (pendiente de aprobación)</button>
      <select v-model="outgoing" aria-label="Equipo a retirar" class="field-input"><option value="">Equipo instalado a retirar...</option><option v-for="u in outgoingChoices" :key="u.id" :value="u.id">{{ u.product?.name }} — {{ u.serial_number || u.mac_address }}</option></select>
      <button type="button" :disabled="blocked || !outgoing || !reason.trim()" class="btn-secondary text-xs" @click="mutate('withdraw', equipmentPayload(outgoing))">Registrar retiro pendiente de recepción</button>
      <p class="text-xs text-slate-500">El retiro no deja el equipo disponible en bodega. Oficina debe recibirlo y registrar su condición.</p>
    </template>
    <p v-else-if="writable" class="text-xs text-amber-700">Para instalar o retirar equipos, vincula primero el cliente a la rutina desde oficina.</p>
    <ul class="space-y-2 text-xs">
      <li v-for="u in linked" :key="u.id" class="space-y-1">
        <p>{{ u.product?.name }} — {{ u.serial_number || u.mac_address }} — {{ u.status }}</p>
        <template v-if="u.status === 'pending_approval'">
          <button v-if="office" type="button" :disabled="blocked" class="btn-secondary text-xs" @click="mutate('approve', { unit_id: u.id })">Aprobar equipo</button>
          <button v-if="office || writable" type="button" :disabled="blocked" class="btn-secondary text-xs ml-2" @click="mutate(office ? 'reject' : 'unlink', { unit_id: u.id })">{{ office ? 'Rechazar' : 'Corregir equipo' }} (requiere recepción)</button>
        </template>
        <div v-if="office && u.status === 'en_recupero'" class="flex gap-2">
          <select v-model="condition" aria-label="Condición recibida" class="field-input"><option value="in_stock">Recibido en buen estado</option><option value="in_repair">Recibido para reparar</option><option value="damaged">Recibido dañado</option></select>
          <button type="button" :disabled="blocked" class="btn-secondary text-xs" @click="mutate('receive', { unit_id: u.id, condition })">Confirmar recepción física</button>
        </div>
      </li>
    </ul>
    <details class="text-xs"><summary>Historial de movimientos de equipos</summary><ul><li v-for="e in events" :key="e.id">{{ e.created_at }} — {{ e.unit?.serial_number || e.unit?.mac_address }}: {{ e.from_status }} → {{ e.to_status }} · {{ e.reason }}</li></ul></details>
  </section>
</template>
