<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useProspectsStore } from '@/stores/prospects';
import { useCatalogsStore } from '@/stores/catalogs';
import { useToast } from '@/composables/useToast';
import { getErrorMessage } from '@/lib/errors';
import { waLink } from '@/lib/phone';
import { fechaLimaISO } from '@/lib/asistenciaReglas';
import type { Prospect, ProspectEstado, ProspectFollowup } from '@/types/domain';

/**
 * Fase 140 — Prospectos y seguimiento comercial. Estructuras propias
 * (prospects/prospect_followups), separadas de clients: un prospecto solo
 * se vuelve cliente real al "Convertir", reusando el flujo existente de
 * "+ Nuevo cliente" (ver ClientesView.vue, query ?prospect_id=..).
 */

const router = useRouter();
const prospectsStore = useProspectsStore();
const catalogs = useCatalogsStore();
const toast = useToast();

const searchQuery = ref('');
const estadoFilter = ref<ProspectEstado | 'all'>('all');

onMounted(async () => {
  await Promise.all([prospectsStore.fetchProspects(), catalogs.fetchZones(), catalogs.fetchPlans()]);
});

const ESTADO_LABEL: Record<ProspectEstado, string> = {
  interesado: 'Interesado',
  por_contactar: 'Por contactar',
  en_negociacion: 'En negociación',
  no_interesado: 'No interesado',
  convertido: 'Convertido',
};
const ESTADO_CLASS: Record<ProspectEstado, string> = {
  interesado: 'bg-sky-500/15 text-sky-700',
  por_contactar: 'bg-amber-500/15 text-amber-700',
  en_negociacion: 'bg-violet-500/15 text-violet-700',
  no_interesado: 'bg-slate-500/15 text-slate-600',
  convertido: 'bg-green-500/15 text-green-600',
};
const CANAL_OPTIONS = ['whatsapp', 'llamada', 'facebook', 'instagram', 'referido', 'visita', 'otro'];
const CANAL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  llamada: 'Llamada',
  facebook: 'Facebook',
  instagram: 'Instagram',
  referido: 'Referido',
  visita: 'Visita',
  otro: 'Otro',
};

function isDue(p: Prospect): boolean {
  if (!p.proximo_seguimiento || p.estado === 'convertido' || p.estado === 'no_interesado') return false;
  return p.proximo_seguimiento <= fechaLimaISO();
}

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return prospectsStore.prospects
    .filter((p) => estadoFilter.value === 'all' || p.estado === estadoFilter.value)
    .filter((p) => !q || `${p.full_name} ${p.phone}`.toLowerCase().includes(q))
    .sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || b.created_at.localeCompare(a.created_at));
});

const counts = computed(() => ({
  interesados: prospectsStore.prospects.filter((p) => p.estado === 'interesado').length,
  pendientes: prospectsStore.prospects.filter(isDue).length,
  convertidos: prospectsStore.prospects.filter((p) => p.estado === 'convertido').length,
}));

// ---- Alta/edicion ----
const showModal = ref(false);
const editing = ref<Prospect | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);

const emptyForm = () => ({
  full_name: '',
  phone: '',
  zone_id: '',
  address: '',
  plan_interes_id: '',
  canal_contacto: 'whatsapp',
  estado: 'por_contactar' as ProspectEstado,
  observaciones: '',
  proximo_seguimiento: '',
});
const form = ref(emptyForm());

// Mismo criterio que duplicateClient en ClientesView.vue (Fase 2): avisa,
// nunca bloquea — dos prospectos legitimos pueden compartir celular.
const duplicateProspect = computed<Prospect | null>(() => {
  const phone = form.value.phone.trim();
  if (!phone) return null;
  return prospectsStore.prospects.find((p) => p.phone.trim() === phone && p.id !== editing.value?.id) ?? null;
});

function openCreate() {
  editing.value = null;
  form.value = emptyForm();
  formError.value = null;
  showModal.value = true;
}
function openEdit(p: Prospect) {
  editing.value = p;
  form.value = {
    full_name: p.full_name,
    phone: p.phone,
    zone_id: p.zone_id ?? '',
    address: p.address ?? '',
    plan_interes_id: p.plan_interes_id ?? '',
    canal_contacto: p.canal_contacto,
    estado: p.estado,
    observaciones: p.observaciones ?? '',
    proximo_seguimiento: p.proximo_seguimiento ?? '',
  };
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      full_name: form.value.full_name.trim(),
      phone: form.value.phone.trim(),
      zone_id: form.value.zone_id || null,
      address: form.value.address.trim() || null,
      plan_interes_id: form.value.plan_interes_id || null,
      canal_contacto: form.value.canal_contacto,
      estado: form.value.estado,
      observaciones: form.value.observaciones.trim() || null,
      proximo_seguimiento: form.value.proximo_seguimiento || null,
    };
    if (editing.value) await prospectsStore.updateProspect(editing.value.id, payload);
    else await prospectsStore.createProspect(payload);
    showModal.value = false;
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el prospecto');
  } finally {
    saving.value = false;
  }
}

function convertToClient(p: Prospect) {
  const params = new URLSearchParams({ prospect_id: p.id, name: p.full_name, phone: p.phone });
  if (p.address) params.set('address', p.address);
  router.push(`/clientes?${params.toString()}`);
}

// ---- Seguimientos (historial) ----
const showFollowups = ref<Prospect | null>(null);
const followups = ref<ProspectFollowup[]>([]);
const loadingFollowups = ref(false);
const newFollowupNotas = ref('');
const savingFollowup = ref(false);

async function openFollowups(p: Prospect) {
  showFollowups.value = p;
  newFollowupNotas.value = '';
  loadingFollowups.value = true;
  try {
    followups.value = await prospectsStore.fetchFollowups(p.id);
  } catch (e) {
    toast.error(getErrorMessage(e, 'Error al cargar los seguimientos'));
  } finally {
    loadingFollowups.value = false;
  }
}

async function addFollowup() {
  if (!showFollowups.value || !newFollowupNotas.value.trim()) return;
  savingFollowup.value = true;
  try {
    const created = await prospectsStore.addFollowup(showFollowups.value.id, newFollowupNotas.value.trim());
    followups.value.unshift(created);
    newFollowupNotas.value = '';
  } catch (e) {
    toast.error(getErrorMessage(e, 'Error al registrar el seguimiento'));
  } finally {
    savingFollowup.value = false;
  }
}

function followupAuthorName(f: ProspectFollowup): string {
  return f.profiles?.full_name || f.profiles?.email || '—';
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 class="text-2xl font-semibold">Prospectos</h1>
        <p class="text-slate-600 text-sm mt-1">Seguimiento comercial — personas interesadas que todavía no son clientes.</p>
      </div>
      <button class="btn-primary" @click="openCreate()">+ Nuevo prospecto</button>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-5">
      <div class="kpi-tile bg-sky-500/10">
        <div><p class="text-xs text-slate-500">Interesados</p><p class="text-xl font-semibold">{{ counts.interesados }}</p></div>
      </div>
      <div class="kpi-tile bg-amber-500/10">
        <div><p class="text-xs text-slate-500">Pendientes de seguimiento</p><p class="text-xl font-semibold">{{ counts.pendientes }}</p></div>
      </div>
      <div class="kpi-tile bg-green-500/10">
        <div><p class="text-xs text-slate-500">Convertidos</p><p class="text-xl font-semibold">{{ counts.convertidos }}</p></div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <input v-model="searchQuery" placeholder="Buscar por nombre o celular..." class="field-input flex-1 min-w-[200px]" />
      <select v-model="estadoFilter" class="field-input w-auto">
        <option value="all">Todos los estados</option>
        <option v-for="(label, value) in ESTADO_LABEL" :key="value" :value="value">{{ label }}</option>
      </select>
    </div>

    <p v-if="prospectsStore.loading" class="text-sm text-slate-500">Cargando...</p>

    <div class="table-shell">
      <table class="w-full text-sm min-w-[760px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Prospecto</th>
            <th class="text-left px-4 py-3">Zona / Dirección</th>
            <th class="text-left px-4 py-3">Plan de interés</th>
            <th class="text-left px-4 py-3">Canal</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Próximo seguimiento</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in filtered"
            :key="p.id"
            class="border-t border-slate-200 hover:bg-slate-50"
            :class="isDue(p) ? 'bg-red-50' : ''"
          >
            <td class="px-4 py-3">
              <div class="font-medium text-slate-900">{{ p.full_name }}</div>
              <a :href="waLink(p.phone)" target="_blank" rel="noopener" class="text-xs text-green-700 hover:underline">💬 {{ p.phone }}</a>
            </td>
            <td class="px-4 py-3 text-slate-600">
              {{ p.zones?.name ?? '—' }}
              <div v-if="p.address" class="text-[11px] text-slate-400">{{ p.address }}</div>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ p.plans?.name ?? '—' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ CANAL_LABEL[p.canal_contacto] ?? p.canal_contacto }}</td>
            <td class="px-4 py-3"><span class="badge" :class="ESTADO_CLASS[p.estado]">{{ ESTADO_LABEL[p.estado] }}</span></td>
            <td class="px-4 py-3">
              <span :class="isDue(p) ? 'text-red-600 font-medium' : 'text-slate-500'">{{ p.proximo_seguimiento ?? '—' }}</span>
              <span v-if="isDue(p)" class="ml-1 text-[11px]">⚠️ vencido/hoy</span>
            </td>
            <td class="px-4 py-3 text-right whitespace-nowrap">
              <button class="text-xs text-sky-700 hover:underline mr-3" @click="openFollowups(p)">Seguimientos</button>
              <button class="text-xs text-sky-700 hover:underline mr-3" @click="openEdit(p)">Editar</button>
              <button v-if="p.estado !== 'convertido'" class="text-xs text-green-700 hover:underline" @click="convertToClient(p)">
                Convertir en cliente
              </button>
            </td>
          </tr>
          <tr v-if="!prospectsStore.loading && !filtered.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-400">Sin prospectos registrados.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Alta/edicion -->
    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
        <div class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-3">{{ editing ? 'Editar prospecto' : 'Nuevo prospecto' }}</h2>
          <form class="space-y-2.5" @submit.prevent="handleSubmit">
            <input v-model="form.full_name" required placeholder="Nombre completo" class="field-input" />
            <input v-model="form.phone" required placeholder="Celular / WhatsApp" class="field-input" />
            <p v-if="duplicateProspect" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              ⚠️ Ya existe un prospecto con este celular ({{ duplicateProspect.full_name }}) — puede ser legítimo (familiar/oficina), revisa antes de duplicar.
            </p>
            <select v-model="form.zone_id" class="field-input">
              <option value="">Zona (opcional)</option>
              <option v-for="z in catalogs.zones" :key="z.id" :value="z.id">{{ z.name }}</option>
            </select>
            <input v-model="form.address" placeholder="Dirección (opcional)" class="field-input" />
            <select v-model="form.plan_interes_id" class="field-input">
              <option value="">Plan de interés (opcional)</option>
              <option v-for="pl in catalogs.plans" :key="pl.id" :value="pl.id">{{ pl.name }}</option>
            </select>
            <select v-model="form.canal_contacto" class="field-input">
              <option v-for="c in CANAL_OPTIONS" :key="c" :value="c">{{ CANAL_LABEL[c] }}</option>
            </select>
            <select v-model="form.estado" class="field-input">
              <option v-for="(label, value) in ESTADO_LABEL" :key="value" :value="value">{{ label }}</option>
            </select>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Próximo seguimiento</label>
              <input v-model="form.proximo_seguimiento" type="date" class="field-input" />
            </div>
            <textarea v-model="form.observaciones" rows="2" placeholder="Observaciones..." class="field-input"></textarea>

            <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="btn-ghost" @click="showModal = false">Cancelar</button>
              <button type="submit" :disabled="saving" class="btn-primary">{{ saving ? 'Guardando...' : 'Guardar' }}</button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Seguimientos -->
    <Teleport to="body">
      <div v-if="showFollowups" class="modal-overlay" @click.self="showFollowups = null">
        <div class="w-full max-w-md modal-panel max-h-[90vh] overflow-y-auto">
          <h2 class="text-lg font-semibold mb-1">Seguimientos — {{ showFollowups.full_name }}</h2>
          <p class="text-xs text-slate-500 mb-3">Historial completo, no se elimina.</p>

          <form class="flex gap-2 mb-3" @submit.prevent="addFollowup">
            <input v-model="newFollowupNotas" placeholder="Nueva nota de seguimiento..." class="field-input flex-1 text-sm" />
            <button type="submit" :disabled="savingFollowup || !newFollowupNotas.trim()" class="btn-primary text-sm px-3">
              {{ savingFollowup ? '...' : 'Agregar' }}
            </button>
          </form>

          <p v-if="loadingFollowups" class="text-sm text-slate-500">Cargando...</p>
          <ul v-else-if="followups.length" class="space-y-2 max-h-64 overflow-y-auto">
            <li v-for="f in followups" :key="f.id" class="text-sm border-l-2 border-slate-200 pl-2.5">
              <p class="text-slate-800">{{ f.notas }}</p>
              <p class="text-[11px] text-slate-400">{{ new Date(f.fecha).toLocaleString('es-PE') }} · {{ followupAuthorName(f) }}</p>
            </li>
          </ul>
          <p v-else class="text-sm text-slate-400">Sin seguimientos todavía.</p>

          <div class="flex justify-end mt-3">
            <button type="button" class="btn-ghost" @click="showFollowups = null">Cerrar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </AppLayout>
</template>
