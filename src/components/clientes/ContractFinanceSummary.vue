<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '@/lib/supabase';
import { useInvoicesStore } from '@/stores/invoices';
import { useAuthStore } from '@/stores/auth';
import { formatPen, penCents, penDecimal } from '@/lib/financeMoney';
import { CASH_METHODS, cashMethodLabel, validateMixedParts, type MixedPaymentPart } from '@/lib/financeCash';
import PaymentReceipt from '@/components/facturacion/PaymentReceipt.vue';
import MixedPaymentReceipt from '@/components/facturacion/MixedPaymentReceipt.vue';
import type { Invoice, ServiceContract } from '@/types/domain';

// Resumen financiero de ESTE contrato en la ficha del cliente (Fase 29).
// Reutiliza las RPC y el store financiero ya existentes (finance_record_payment/
// finance_record_payment_mixed vía invoicesStore.recordPayment, los mismos
// PaymentReceipt/MixedPaymentReceipt de /facturacion) — nunca un segundo
// sistema. Cada contrato se evalúa de forma independiente: nunca mezcla
// deuda/saldo de otro servicio del mismo cliente.
const props = defineProps<{ contract: ServiceContract; invoices: Invoice[]; saldoAFavor: number }>();
const emit = defineEmits<{ changed: [] }>();
const router = useRouter();
const store = useInvoicesStore();
const auth = useAuthStore();
const canAdmin = computed(() => ['SUPERADMIN', 'ADMIN'].includes(auth.role ?? ''));

interface CycleStatus {
  contractId: string; reconciled: boolean; isCourtesy: boolean; courtesyReason?: string | null;
  monthlyFee: number; status: string; debtHoldStatus: string; billingModality?: 'adelantado' | 'cumplido';
  billingDay?: number; graceDays?: number; coveredUntil?: string; nextCycleDate?: string; graceEndDate?: string;
  promo3plus1: boolean; promoCoverageThrough?: string | null; asOf: string;
}
const cycle = ref<CycleStatus | null>(null);
const cycleError = ref('');
interface History { payments: Array<{ id: string; amount: string; method: string; reference: string | null; received_at: string; reversed_at: string | null; collector: string }>; adjustments: Array<{ id: string; tipo: string; monto: string; descripcion: string; reversed_at: string | null }>; audit: Array<{ id: string; accion: string; created_at: string; actor_id: string; motivo: string }> }
const history = ref<History | null>(null);
const mixedEnabled = ref(false);
const loading = ref(true);

async function load() {
  loading.value = true; cycleError.value = '';
  try {
    const [{ data: cycleData, error: cycleErr }, { data: historyData, error: historyErr }] = await Promise.all([
      supabase.rpc('finance_contract_cycle_status', { p_contract_id: props.contract.id }),
      supabase.rpc('finance_history', { p_contract_id: props.contract.id }),
    ]);
    if (cycleErr) throw cycleErr;
    cycle.value = cycleData as CycleStatus;
    if (!historyErr) history.value = historyData as History;
  } catch (e) {
    cycleError.value = e instanceof Error ? e.message : 'No se pudo cargar el resumen financiero.';
  } finally { loading.value = false; }
}
onMounted(async () => {
  await load();
  try { const { data } = await supabase.rpc('finance_cash_status'); mixedEnabled.value = !!data?.enabled; } catch { mixedEnabled.value = false; }
});
watch(() => props.contract.id, load);

const pendingInvoices = computed(() => props.invoices.filter((i) => i.status === 'pending'));
const deudaPendienteCents = computed(() => pendingInvoices.value.reduce((n, i) => n + penCents(i.amount_due), 0));
const lastPayment = computed(() => history.value?.payments.find((p) => !p.reversed_at) ?? null);
const autoBilled = computed(() => props.invoices.some((i) => i.finance_origin === 'operational' || i.finance_origin === undefined));

// Estado visual — nunca inventa "al día" para un contrato sin conciliar ni
// confunde cortesía/suspendido con morosidad (reglas permanentes del proyecto).
type Status = 'cortesia' | 'sin_conciliar' | 'suspendido' | 'moroso' | 'en_gracia' | 'al_dia';
const status = computed<Status>(() => {
  const c = cycle.value;
  if (!c) return 'sin_conciliar';
  if (c.isCourtesy) return 'cortesia';
  if (!c.reconciled) return 'sin_conciliar';
  if (c.status === 'suspended') return 'suspendido';
  if (!c.nextCycleDate) return 'al_dia';
  const today = c.asOf;
  if (c.nextCycleDate > today) return 'al_dia';
  if (c.graceEndDate && c.graceEndDate >= today) return 'en_gracia';
  return 'moroso';
});
const STATUS_LABEL: Record<Status, string> = { cortesia: 'Cortesía', sin_conciliar: 'Pendiente de conciliación', suspendido: 'Suspendido', moroso: 'Moroso', en_gracia: 'Dentro del plazo de gracia', al_dia: 'Al día' };
const STATUS_CLASS: Record<Status, string> = {
  cortesia: 'bg-sky-500/15 text-sky-700', sin_conciliar: 'bg-slate-400/15 text-slate-600',
  suspendido: 'bg-slate-700/15 text-slate-700', moroso: 'bg-red-500/15 text-red-600',
  en_gracia: 'bg-amber-500/15 text-amber-700', al_dia: 'bg-green-500/15 text-green-600',
};

// ---- Registrar pago (mismo mecanismo que /facturacion, acotado a este contrato) ----
const payOpen = ref(false), paying = ref(false), review = ref(false), payError = ref('');
const selected = ref<string[]>([]), payAmount = ref(''), method = ref('cash'), reference = ref(''), reason = ref('Cobro registrado desde la ficha del cliente'), requestId = ref('');
const mixedParts = ref<MixedPaymentPart[]>(CASH_METHODS.map((m) => ({ method: m, amount: '', reference: '' })));
const amountTouched = ref(false);
const receiptView = ref<InstanceType<typeof PaymentReceipt> | null>(null);
const mixedReceipt = ref<InstanceType<typeof MixedPaymentReceipt> | null>(null);
const mixedSelection = () => validateMixedParts(mixedParts.value.filter((r) => { if (!r.amount.trim()) return false; try { return penCents(r.amount) !== 0; } catch { return true; } }));
watch([method, mixedParts], () => { if (method.value === 'mixed') { try { payAmount.value = penDecimal(mixedParts.value.reduce((n, p) => n + (p.amount.trim() ? penCents(p.amount) : 0), 0)); } catch { payAmount.value = ''; } } }, { deep: true });
const pendingSumCents = computed(() => pendingInvoices.value.filter((i) => selected.value.includes(i.id)).reduce((s, i) => s + penCents(i.amount_due), 0));
const receivedCents = computed(() => { try { return penCents(payAmount.value); } catch { return 0; } });
watch(selected, () => { if (method.value !== 'mixed' && !amountTouched.value) payAmount.value = pendingSumCents.value ? penDecimal(pendingSumCents.value) : ''; }, { deep: true });
function touchAmount() { amountTouched.value = true; }
function openPayment() {
  payOpen.value = true; review.value = false; payError.value = ''; requestId.value = crypto.randomUUID(); reference.value = ''; method.value = 'cash';
  selected.value = pendingInvoices.value.map((i) => i.id); amountTouched.value = false;
  payAmount.value = deudaPendienteCents.value ? penDecimal(deudaPendienteCents.value) : '';
  mixedParts.value = CASH_METHODS.map((m) => ({ method: m, amount: '', reference: '' }));
}
function reviewPayment() {
  payError.value = '';
  try {
    if (penCents(payAmount.value) <= 0) throw Error('Indica el importe recibido.');
    if (method.value === 'mixed') { const p = mixedSelection(); if (p.totalCents !== penCents(payAmount.value)) throw Error('Revisa la suma de los medios.'); }
    else if (method.value !== 'cash' && !reference.value.trim()) throw Error('Registra el número de operación.');
    if (reason.value.trim().length < 5) throw Error('Indica el motivo de la operación.');
    review.value = true;
  } catch (e) { payError.value = e instanceof Error ? e.message : 'Pago inválido'; }
}
async function confirmPayment() {
  if (paying.value) return; paying.value = true; payError.value = '';
  try {
    const result = await store.recordPayment({
      requestId: requestId.value, contractId: props.contract.id, invoiceIds: selected.value,
      amount: penDecimal(penCents(payAmount.value)), method: method.value, reference: reference.value, reason: reason.value,
      ...(method.value === 'mixed' ? { parts: mixedSelection().parts } : {}),
    });
    payOpen.value = false;
    if (result.groupId) void mixedReceipt.value?.open(result.groupId); else void receiptView.value?.open(result.paymentId);
    await load(); emit('changed');
  } catch (e) { payError.value = e instanceof Error ? e.message : 'No se pudo registrar el pago. Reintenta con esta misma operación.'; } finally { paying.value = false; }
}
const dateLabel = (v?: string | null) => (v ? new Date(v).toLocaleString('es-PE', { timeZone: 'America/Lima' }) : '—');
</script>

<template>
  <div class="mb-6">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold">Resumen financiero</h3>
      <span class="badge" :class="STATUS_CLASS[status]">{{ STATUS_LABEL[status] }}</span>
    </div>
    <p v-if="cycleError" class="text-sm text-red-600 mb-3">{{ cycleError }}</p>
    <p v-else-if="loading" class="text-sm text-slate-500 mb-3">Cargando resumen financiero…</p>
    <template v-else-if="cycle">
      <p v-if="!cycle.reconciled" class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
        Este contrato todavía no está conciliado — no se muestra deuda, cobertura ni próxima mensualidad porque no hay evidencia financiera confiable. Se evita mostrar "deuda S/ 0" para no sugerir que está al día.
      </p>
      <p v-if="cycle.isCourtesy" class="text-sm text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-3">
        Servicio de cortesía{{ cycle.courtesyReason ? ' — ' + cycle.courtesyReason : '' }}. Nunca genera deuda ni factura automática.
      </p>
      <div class="grid gap-3 mb-4" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr))">
        <div class="surface p-3"><div class="text-xs text-slate-500">Mensualidad vigente</div><div class="text-lg font-semibold">{{ formatPen(cycle.monthlyFee) }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Modalidad</div><div class="text-sm font-medium">{{ cycle.billingModality === 'adelantado' ? 'Pago adelantado' : cycle.billingModality === 'cumplido' ? 'Pago cumplido' : '—' }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Día contractual</div><div class="text-sm font-medium">{{ cycle.billingDay ?? '—' }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Último pago verificado</div><div class="text-sm font-medium">{{ lastPayment ? formatPen(lastPayment.amount) + ' · ' + dateLabel(lastPayment.received_at) : 'Sin pagos en el libro nuevo' }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Servicio cubierto hasta</div><div class="text-sm font-medium">{{ cycle.coveredUntil ?? '—' }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Próxima mensualidad</div><div class="text-sm font-medium">{{ cycle.nextCycleDate ?? '—' }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Plazo de gracia</div><div class="text-sm font-medium">{{ cycle.graceEndDate ? 'Hasta ' + cycle.graceEndDate : (cycle.billingModality === 'cumplido' ? 'No aplica (pago cumplido)' : '—') }}</div></div>
        <div class="surface p-3" :class="{ 'ring-1 ring-red-300': deudaPendienteCents > 0 }"><div class="text-xs text-slate-500">Deuda pendiente</div><div class="text-lg font-semibold" :class="deudaPendienteCents > 0 ? 'text-red-600' : ''">{{ formatPen(penDecimal(deudaPendienteCents)) }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Saldo a favor (cliente)</div><div class="text-sm font-medium">{{ formatPen(saldoAFavor) }}</div></div>
        <div class="surface p-3"><div class="text-xs text-slate-500">Facturación automática</div><div class="text-sm font-medium">{{ cycle.isCourtesy ? 'No aplica (cortesía)' : autoBilled ? 'Ya se generaron facturas automáticas' : 'Aún no se generó ninguna factura automática' }}</div></div>
      </div>
      <div v-if="cycle.promo3plus1" class="text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 mb-4">
        Promoción 3+1 aplicada{{ cycle.promoCoverageThrough ? ' — cobertura hasta ' + cycle.promoCoverageThrough : '' }}.
      </div>
      <div class="flex gap-2 mb-4">
        <button v-if="canAdmin && pendingInvoices.length" type="button" class="btn-primary" @click="openPayment">Registrar pago</button>
        <button type="button" class="btn-ghost" @click="router.push('/facturacion')">Ver en Facturación →</button>
      </div>
      <details class="mb-2">
        <summary class="text-xs text-slate-500 cursor-pointer">Auditoría financiera ({{ history?.audit.length ?? 0 }})</summary>
        <p v-for="a in history?.audit ?? []" :key="a.id" class="text-xs text-slate-500 py-1 border-t border-slate-100">{{ dateLabel(a.created_at) }} · {{ a.accion }} · {{ a.motivo }}</p>
        <p v-if="!history?.audit.length" class="text-xs text-slate-400">Sin registros de auditoría todavía.</p>
      </details>
    </template>
  </div>
  <PaymentReceipt ref="receiptView" />
  <MixedPaymentReceipt ref="mixedReceipt" @changed="load(); emit('changed')" />
  <Teleport to="body">
    <div v-if="payOpen" class="modal-overlay">
      <section class="modal-panel finance-dialog" role="dialog" aria-modal="true" aria-labelledby="client-payment-title">
        <div class="finance-dialog-head"><h2 id="client-payment-title">{{ review ? 'Confirmar pago' : 'Registrar pago' }}</h2><button :disabled="paying" aria-label="Cerrar pago" @click="payOpen = false">×</button></div>
        <p class="finance-help">{{ contract.contract_number }} · pagos parciales, completos o adelantados.</p>
        <template v-if="!review">
          <div v-if="pendingInvoices.length" class="finance-invoice-options">
            <label v-for="i in pendingInvoices" :key="i.id"><input v-model="selected" type="checkbox" :value="i.id"><span>{{ i.invoice_number }} · {{ i.period_start }}</span><b>{{ formatPen(i.amount_due) }}</b></label>
          </div>
          <p v-else class="finance-help">Sin facturas pendientes — el dinero se registrará como anticipo (saldo a favor).</p>
          <div v-if="method === 'mixed'" class="finance-form-grid finance-mixed-parts">
            <label v-for="part in mixedParts" :key="part.method">{{ cashMethodLabel(part.method) }}<input v-model="part.amount" inputmode="decimal" :aria-label="'Importe ' + cashMethodLabel(part.method)" placeholder="0.00"><input v-if="part.method !== 'cash'" v-model="part.reference" :aria-label="'Operación ' + cashMethodLabel(part.method)" placeholder="Número de operación" maxlength="100"></label>
          </div>
          <div class="finance-form-grid">
            <label>Importe recibido (PEN)<input :readonly="method === 'mixed'" v-model="payAmount" inputmode="decimal" placeholder="0.00" @input="touchAmount"></label>
            <label>Método<select v-model="method"><option value="cash">Efectivo</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="transfer">Transferencia</option><option value="other">Otros</option><option v-if="mixedEnabled" value="mixed">Mixto</option></select></label>
            <label v-if="method !== 'mixed'">Número de operación<input v-model="reference" maxlength="100" placeholder="Requerido para medios digitales"></label>
            <label>Motivo<input v-model="reason" maxlength="500"></label>
          </div>
        </template>
        <p v-if="payAmount" class="finance-help">A aplicar {{ formatPen(penDecimal(Math.min(pendingSumCents, receivedCents))) }} · Saldo restante {{ formatPen(penDecimal(Math.max(0, pendingSumCents - receivedCents))) }} · Saldo a favor nuevo {{ formatPen(penDecimal(Math.max(0, receivedCents - pendingSumCents))) }}</p>
        <p v-if="payError" class="finance-error" role="alert">{{ payError }}</p>
        <div class="finance-dialog-actions">
          <button v-if="review" class="btn-ghost" :disabled="paying" @click="review = false">Volver</button>
          <button v-if="!review" class="btn-primary" @click="reviewPayment">Revisar pago</button>
          <button v-else class="btn-primary" :disabled="paying" @click="confirmPayment">{{ paying ? 'Registrando…' : 'Confirmar pago' }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<style src="@/components/facturacion/finance.css"></style>
