<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useCajaChicaStore } from '@/stores/cajaChica';
import { getErrorMessage } from '@/lib/errors';
import type { CajaChicaTipo } from '@/types/domain';

// Fase 30: Configuración de Caja Chica — responsables visibles en el
// selector (administrable, nunca una lista de nombres en el código) y
// categorías por tipo (ingreso/egreso), conservando las existentes y sus
// relaciones históricas. Reutiliza caja_responsables_config/
// caja_set_responsable_visible (migración 20261202090000) y
// fetchCategorias/createCategoria ya existentes — sin un segundo sistema.
const store = useCajaChicaStore();
const loading = ref(true);
const error = ref('');

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Super administrador', ADMIN: 'Administración', TECNICO_RED: 'Técnico de red',
  SOPORTE: 'Soporte', FACTURACION: 'Facturación',
};
function roleLabel(role: string) { return ROLE_LABEL[role] ?? role; }
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join(''); }

async function load() {
  loading.value = true; error.value = '';
  try { await Promise.all([store.fetchResponsablesConfig(), store.fetchCategorias()]); }
  catch (e) { error.value = getErrorMessage(e, 'No se pudo cargar la configuración.'); }
  finally { loading.value = false; }
}
onMounted(load);

// ---- Responsables: toggle con motivo obligatorio (auditado) ----
const togglingId = ref<string | null>(null);
const pendingReasonFor = ref<string | null>(null);
const reasonInput = ref('');
const toggleError = ref('');

function startToggle(profileId: string) { pendingReasonFor.value = profileId; reasonInput.value = ''; toggleError.value = ''; }
function cancelToggle() { pendingReasonFor.value = null; reasonInput.value = ''; }
async function confirmToggle(profileId: string, nextVisible: boolean) {
  if (reasonInput.value.trim().length < 5) { toggleError.value = 'Indica un motivo de al menos cinco caracteres.'; return; }
  togglingId.value = profileId;
  try {
    await store.setResponsableVisible(crypto.randomUUID(), profileId, nextVisible, reasonInput.value.trim());
    pendingReasonFor.value = null; reasonInput.value = '';
  } catch (e) { toggleError.value = getErrorMessage(e, 'No se pudo actualizar la visibilidad.'); }
  finally { togglingId.value = null; }
}

// ---- Categorías por tipo: lista agrupada + creación (conserva las existentes) ----
const categoriasPorTipo = computed(() => ({
  egreso: store.categorias.filter((c) => c.tipo === 'egreso' && !['Retiros del propietario'].includes(c.nombre)),
  ingreso: store.categorias.filter((c) => c.tipo === 'ingreso' && !['Cobros de clientes'].includes(c.nombre)),
}));
const showNewCategoria = ref<CajaChicaTipo | null>(null);
const newCategoriaName = ref('');
const newCategoriaVehiculo = ref(false);
const savingCategoria = ref(false);
const categoriaError = ref('');
function openNewCategoria(tipo: CajaChicaTipo) { showNewCategoria.value = tipo; newCategoriaName.value = ''; newCategoriaVehiculo.value = false; categoriaError.value = ''; }
async function handleCreateCategoria() {
  const name = newCategoriaName.value.trim();
  if (!name || !showNewCategoria.value) return;
  savingCategoria.value = true; categoriaError.value = '';
  try {
    await store.createCategoria(name, showNewCategoria.value, newCategoriaVehiculo.value);
    showNewCategoria.value = null; newCategoriaName.value = '';
  } catch (e) { categoriaError.value = getErrorMessage(e, 'No se pudo crear la categoría.'); }
  finally { savingCategoria.value = false; }
}
</script>

<template>
  <div>
    <p v-if="error" class="text-sm text-red-600 mb-4">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">Cargando configuración…</p>
    <template v-else>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-semibold">Responsables visibles en el selector</h2>
      </div>
      <div class="surface p-4 mb-8">
        <p class="text-xs text-slate-500 mb-4">
          Exclusivo de Caja Chica — no modifica roles, cuentas ni permisos en ningún otro módulo.
          Ocultar a alguien solo lo retira del selector de "Responsable" al crear un movimiento nuevo;
          nunca borra su historial ya registrado. El personal nuevo aparece visible por defecto.
        </p>
        <div v-for="r in store.responsablesConfig" :key="r.profileId" class="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0 gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-8 h-8 rounded-full bg-violet-50 text-violet-700 text-xs font-semibold flex items-center justify-center shrink-0">{{ initials(r.fullName) }}</span>
            <div class="min-w-0">
              <div class="text-sm font-medium truncate">{{ r.fullName }}</div>
              <div class="text-xs text-slate-400">{{ roleLabel(r.role) }}</div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="badge" :class="r.visible ? 'bg-green-500/15 text-green-700' : 'bg-red-500/15 text-red-700'">{{ r.visible ? 'Visible' : 'Oculto' }}</span>
            <button type="button" class="btn-ghost text-xs" :disabled="togglingId === r.profileId" @click="startToggle(r.profileId)">
              {{ r.visible ? 'Ocultar' : 'Mostrar' }}
            </button>
          </div>
        </div>
        <Teleport to="body">
          <div v-if="pendingReasonFor" class="modal-overlay">
            <div class="modal-panel w-full max-w-sm">
              <h3 class="text-sm font-semibold mb-3">
                {{ store.responsablesConfig.find((r) => r.profileId === pendingReasonFor)?.visible ? 'Ocultar del selector' : 'Volver a mostrar en el selector' }}
              </h3>
              <label class="field-label">Motivo (obligatorio, auditado)</label>
              <input v-model="reasonInput" class="field-input mb-2" maxlength="500" placeholder="Ej. cuenta de prueba, ya no trabaja aquí, se reincorpora…" />
              <p v-if="toggleError" class="text-xs text-red-600 mb-2">{{ toggleError }}</p>
              <div class="flex justify-end gap-2">
                <button type="button" class="btn-ghost" @click="cancelToggle">Cancelar</button>
                <button type="button" class="btn-primary" :disabled="togglingId !== null"
                  @click="confirmToggle(pendingReasonFor!, !store.responsablesConfig.find((r) => r.profileId === pendingReasonFor)?.visible)">
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </Teleport>
      </div>

      <h2 class="text-sm font-semibold mb-3">Categorías</h2>
      <div class="grid gap-4 mb-2" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr))">
        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Egreso</h3>
            <button type="button" class="text-xs text-sky-700 hover:underline" @click="openNewCategoria('egreso')">+ Nueva</button>
          </div>
          <p v-for="c in categoriasPorTipo.egreso" :key="c.id" class="text-sm py-1 flex items-center justify-between">
            <span>{{ c.nombre }}</span>
            <span v-if="c.permite_vehiculo" class="text-[10px] text-slate-400">🚗 vehículo</span>
          </p>
          <p v-if="!categoriasPorTipo.egreso.length" class="text-xs text-slate-400">Sin categorías de egreso todavía.</p>
        </div>
        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ingreso</h3>
            <button type="button" class="text-xs text-sky-700 hover:underline" @click="openNewCategoria('ingreso')">+ Nueva</button>
          </div>
          <p v-for="c in categoriasPorTipo.ingreso" :key="c.id" class="text-sm py-1">{{ c.nombre }}</p>
          <p v-if="!categoriasPorTipo.ingreso.length" class="text-xs text-slate-400">Sin categorías manuales de ingreso todavía — se crean igual que las de egreso.</p>
        </div>
      </div>
      <p class="text-xs text-slate-400 mb-6">
        "Cobros de clientes" y "Retiros del propietario" son categorías automáticas del sistema —
        nunca aparecen aquí ni en el selector manual, para evitar un ingreso o retiro duplicado.
      </p>

      <Teleport to="body">
        <div v-if="showNewCategoria" class="modal-overlay">
          <div class="modal-panel w-full max-w-sm">
            <h3 class="text-sm font-semibold mb-3">Nueva categoría de {{ showNewCategoria === 'ingreso' ? 'ingreso' : 'egreso' }}</h3>
            <label class="field-label">Nombre</label>
            <input v-model="newCategoriaName" class="field-input mb-3" maxlength="100" @keydown.enter.prevent="handleCreateCategoria" />
            <label v-if="showNewCategoria === 'egreso'" class="flex items-center gap-2 text-sm mb-3">
              <input v-model="newCategoriaVehiculo" type="checkbox" /> Permite vincular un vehículo de Flota
            </label>
            <p v-if="categoriaError" class="text-xs text-red-600 mb-2">{{ categoriaError }}</p>
            <div class="flex justify-end gap-2">
              <button type="button" class="btn-ghost" @click="showNewCategoria = null">Cancelar</button>
              <button type="button" class="btn-primary" :disabled="savingCategoria || !newCategoriaName.trim()" @click="handleCreateCategoria">
                {{ savingCategoria ? 'Guardando…' : 'Crear categoría' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
