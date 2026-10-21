<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { supabase } from '@/lib/supabase';
import { apiFetch } from '@/lib/api';
import { createFieldInventoryClient } from '@/lib/fieldInventoryClient';
import { createInventoryRefresh } from '@/lib/inventoryRefresh';
import { startInventorySignals } from '@/lib/inventorySignals';
import type { FieldInventoryContext } from '@/types/fieldInventory';
import { useAuthStore } from '@/stores/auth';
import { getErrorMessage } from '@/lib/errors';
import { executeRoutineInventory, pendingRoutineInventory, type RoutineInventoryAction, type RoutineInventoryRequest } from '@/lib/routineInventoryRequest';
import type { InventoryMovement, InventoryUnit, Routine, MyInventoryCustody } from '@/types/domain';
import { confirmedMaterialQuantity, materialCustodyLabel as custodyLabel, type MaterialCustodyLoadState } from '@/lib/materialCustodyAvailability';
import { custodyEquipmentModels, custodyEquipmentUnits, custodyMaterialChoices, custodyUnitLabel } from '@/lib/fieldCustodyChoices';
import { activeMaterialMovements } from '@/lib/materialMovementPresentation';
import { useTechnicianCustodyStore } from '@/stores/technicianCustody';

const props = defineProps<{ routine: Routine; canWrite?: boolean;
  materialAvailability?: (id: string) => number | undefined;
  materialCustodyLabel?: (id: string, unit: string) => string;
  materialCustodyState?: MaterialCustodyLoadState;
}>();
const emit = defineEmits<{ inventoryChanged: []; retryCustody: [] }>();
const auth = useAuthStore();
const custodyStore = useTechnicianCustodyStore();
const custody = ref<Pick<MyInventoryCustody, 'materials' | 'units'>>({ materials: [], units: [] });
const custodyState = ref<MaterialCustodyLoadState>('loading');
type RoutineUnit = InventoryUnit & { routine_id: string | null };
type EventRow = { id: string; from_status: string | null; to_status: string; reason: string | null; created_at: string; unit: { serial_number: string | null; mac_address: string | null } | null };
const materials = ref<InventoryMovement[]>([]);
const linked = ref<RoutineUnit[]>([]);
const assigned = ref<InventoryUnit[]>([]);
const available = computed(() => custodyEquipmentUnits(custody.value.units, equipmentProduct.value, custodyState.value));
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
// Un rechazo CONFIRMADO (pending.value) nunca debe trabar el formulario: la
// correccion de cantidad se envia como un 'consume' normal con el mismo
// producto, y executeRoutineInventory reutiliza la clave pendiente sola.
// Bloquear aqui por `pending` obligaba a reintentar SIEMPRE la misma
// cantidad ya rechazada (boton "Reintentar"), sin forma de corregirla --
// mismo criterio que Altas/Averias (CampoTrabajoDetailView.vue), que nunca
// deshabilitan su formulario por una operacion pendiente.
const blocked = computed(() => busy.value || loading.value);
// The same session-scoped custody RPC used by Altas, without catalog/warehouse fallback.
const consumables = computed(() => custodyMaterialChoices(custody.value.materials, custodyState.value));
const serialized = computed(() => custodyEquipmentModels(custody.value.units, custodyState.value));
const materialAvailable = (id: string) => confirmedMaterialQuantity(custody.value.materials, id, custodyState.value);
const materialLabel = (id: string, unit: string) => custodyLabel(materialAvailable(id), unit, custodyState.value);
// Fase 168: mismo helper puro que InstalacionDetailView.vue (Fase 166) y
// CampoTrabajoDetailView.vue -- una sola implementacion, no tres.
const activeMaterials = computed(() => activeMaterialMovements(materials.value));
const outgoingChoices = computed(() => assigned.value.filter(u => u.status === 'assigned' && u.contract_id === (contractId.value || null)));

function refreshPending() {
  pending.value = auth.user ? pendingRoutineInventory(localStorage, auth.user.id, props.routine.id) : null;
}
const context = (): FieldInventoryContext => ({ jobType: 'routine', jobId: props.routine.id,
  actorId: auth.user?.id ?? '', clientId: props.routine.client_id, contractId: props.routine.contract_id });
const current = (c: FieldInventoryContext) => JSON.stringify(c) === JSON.stringify(context());
const refresh = createInventoryRefresh<FieldInventoryContext, { materials: InventoryMovement[]; linked: RoutineUnit[]; events: EventRow[]; custody: Pick<MyInventoryCustody, 'materials' | 'units'>; assigned: InventoryUnit[]; contracts: {id:string;contract_number:string}[] }>({
  load: async (c, signal) => {
    const reads = createFieldInventoryClient(path => apiFetch(path, { signal }, 15000), current);
    const catalog = auth.role === 'TECNICO_RED' && props.routine.status === 'in_progress';
    const [m,u,e,p,a,contracts] = await Promise.all([
      reads.read<InventoryMovement>(c,'materials'), reads.read<RoutineUnit>(c,'linked'), reads.read<EventRow>(c,'events'),
      catalog ? custodyStore.fetchMyCustody() : Promise.resolve({materials:[],units:[]}),
      catalog ? reads.read<InventoryUnit>(c,'assigned') : Promise.resolve({items:[]}),
      catalog ? reads.read<{id:string;contract_number:string}>(c,'contracts') : Promise.resolve({items:[]}),
    ]);
    return {materials:m.items,linked:u.items,events:e.items,custody:p,assigned:a.items,contracts:contracts.items};
  },
  clear: () => { materials.value=[];linked.value=[];events.value=[];custody.value={materials:[],units:[]};custodyState.value='loading';assigned.value=[];contracts.value=[];incoming.value='';outgoing.value=''; },
  publish: data => { materials.value=data.materials;linked.value=data.linked;events.value=data.events;custody.value=data.custody;custodyState.value='ready';assigned.value=data.assigned;contracts.value=data.contracts;error.value=''; },
  state: state => { loading.value=state==='loading'; if(state==='unavailable'||state==='blocked')custodyState.value='error'; if(state==='blocked')error.value='No tienes acceso vigente al inventario de esta rutina.'; },
});
async function load() { refreshPending(); await refresh.refresh(true); }
async function loadAvailable() {
  incoming.value='';
  if(equipmentProduct.value && auth.user) await load();
}
async function mutate(action: RoutineInventoryAction, payload: Record<string, unknown>) {
  if (busy.value || !auth.user) return;
  busy.value = true; error.value = '';
  try {
    const originalContext = context();
    // An uncertain committed write must reach the existing idempotent receipt,
    // even when its unit is no longer available after the original commit.
    if (action === 'install' && !pendingRoutineInventory(localStorage, auth.user.id, props.routine.id)) {
      await loadAvailable();
      if (!available.value.some(u => u.id === payload.unit_id)) throw Error('El equipo ya no está disponible en tu custodia. Actualiza y elige nuevamente.');
    }
    if (!current(originalContext)) throw Error('La orden o el técnico cambió. Actualiza antes de registrar.');
    await executeRoutineInventory(localStorage, auth.user.id, props.routine.id, action, payload,
      async request => await supabase.rpc('routine_inventory_operation', request));
    emit('inventoryChanged');
    // Clear forms before reads: a failed refresh must not repeat a committed write.
    productId.value = ''; quantity.value = 1; incoming.value = ''; outgoing.value = ''; correction.value = ''; reason.value = '';
    await load();
    if (equipmentProduct.value) await loadAvailable();
  } catch (e) { error.value = getErrorMessage(e, 'No se pudo registrar inventario'); }
  finally { busy.value = false; refreshPending(); }
}
const equipmentPayload = (unitId: string) => ({ unit_id: unitId, contract_id: contractId.value || null, reason: reason.value });
watch(() => [props.routine.id,props.routine.client_id,props.routine.contract_id,props.routine.status,auth.user?.id,auth.role], async () => {
  contractId.value=props.routine.contract_id??'';error.value='';pending.value=null;
  refresh.setContext(auth.user ? context() : null);refreshPending();
  if(auth.user)await refresh.refresh();
}, {immediate:true});
let stopSignals: (()=>void)|null=null;
onMounted(()=>{stopSignals=startInventorySignals({refresh:()=>refresh.refresh(),online:value=>refresh.setOnline(value),visible:value=>refresh.setVisible(value),skipInitialRefresh:true});});
onUnmounted(()=>{stopSignals?.();refresh.dispose();});
</script>

<template>
  <section class="surface p-3.5 mb-3 space-y-3">
    <h2 class="text-sm font-semibold">Materiales y equipos de la rutina</h2>
    <p class="text-xs text-slate-500">Los registros se conservan al devolver o reasignar la rutina.</p>
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
      <select v-model="productId" aria-label="Material de tu custodia" :disabled="blocked || custodyState !== 'ready'" class="field-input">
        <option value="">Selecciona material...</option>
        <option v-for="p in consumables" :key="p.id" :value="p.id">{{ p.name }} — {{ materialLabel(p.id, p.unit) }}</option>
      </select>
      <input v-model.number="quantity" aria-label="Cantidad utilizada" type="number" min="0.01" :max="materialAvailable(productId)" step="0.01" class="field-input" />
      <p v-if="custodyState === 'error'" class="text-xs text-amber-700">
        No se pudo consultar tu custodia. <button type="button" class="underline" @click="load">Reintentar</button>
      </p>
      <p v-if="custodyState === 'ready' && !consumables.length" class="text-xs text-slate-500">Sin materiales disponibles en tu custodia.</p>
      <button type="button" :disabled="blocked || custodyState !== 'ready' || !productId" class="btn-secondary text-xs" @click="mutate('consume', { product_id: productId, quantity })">Registrar material utilizado</button>
    </div>
    <template v-if="writable && routine.client_id">
      <h3 class="text-xs font-semibold">Equipos por serie/MAC</h3>
      <select v-model="contractId" aria-label="Contrato del equipo" :disabled="!!routine.contract_id || blocked" class="field-input">
        <option value="">{{ contracts.length ? 'Selecciona contrato...' : 'Cliente sin contrato' }}</option>
        <option v-for="c in contracts" :key="c.id" :value="c.id">{{ c.contract_number || c.id }}</option>
      </select>
      <input v-model="reason" aria-label="Motivo del movimiento" placeholder="Motivo / condición física" class="field-input" />
      <select v-model="equipmentProduct" aria-label="Producto serializado" :disabled="blocked || custodyState !== 'ready'" class="field-input" @change="loadAvailable().catch(e => error = getErrorMessage(e))">
        <option value="">Equipo entrante...</option><option v-for="p in serialized" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <select v-model="incoming" aria-label="Serie o MAC entrante" class="field-input"><option value="">Serie/MAC de tu custodia...</option><option v-for="u in available" :key="u.id" :value="u.id">{{ custodyUnitLabel(u) }}</option></select>
      <p v-if="custodyState === 'ready' && !serialized.length" class="text-xs text-slate-500">Sin equipos disponibles en tu custodia.</p>
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
