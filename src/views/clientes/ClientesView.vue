<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useAuthStore } from '@/stores/auth';
import { useReferidosStore } from '@/stores/referidos';
import { useProspectsStore } from '@/stores/prospects';
import { useInstallationsStore } from '@/stores/installations';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { getErrorMessage } from '@/lib/errors';
import type { Client, ClientStatus, ContractPriority, DocumentType } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const mikrotikStore = useMikrotikStore();
const auth = useAuthStore();
const referidosStore = useReferidosStore();
const prospectsStore = useProspectsStore();
const installationsStore = useInstallationsStore();
const toast = useToast();
const { confirmDialog } = useConfirm();

// Fase 140 — conversion de un prospecto (ver ProspectosView.vue):
// /clientes?prospect_id=..&name=..&phone=..&address=.. precarga el modal de
// "+ Nuevo cliente" y, recien si el alta tiene exito, marca el prospecto
// 'convertido' con la referencia al cliente real (punto 8/9 del pedido).
// Fase 145: ademas se deja visible un aviso en el propio modal (el
// prospecto no trae documento, asi que SIEMPRE falta un dato obligatorio
// para poder guardar) y, tras el alta, se genera la orden de Alta en
// Instalaciones y se navega directo a la ficha del cliente — antes el
// flujo terminaba en silencio justo despues del redirect a este modal, sin
// dejar rastro si el usuario no llegaba a guardar (caso real: prospecto
// "prueba2", 2026-10-10 — quedo en Supabase sin cliente ni orden alguna).
const convertingProspectId = ref<string | null>(null);
const convertingProspectName = ref<string | null>(null);

// TECNICO_RED puede ver/editar clientes (GPS, fotos), pero no crearlos ni
// eliminarlos — eso queda para SOPORTE/ADMIN/FACTURACION.
const canManageClients = computed(() => auth.role !== 'TECNICO_RED');

const showModal = ref(false);
const editing = ref<Client | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const pendingPppoeHint = ref<string | null>(null);
const searchQuery = ref('');

// Referido (Fase 33): solo aplica al ALTA de un cliente nuevo — vincula
// quien lo recomendo para que le llegue el descuento de S/25 en su
// siguiente factura (lo aplica el trigger de la BD, no aqui).
const referenteId = ref('');
const referenteFilter = ref('');
const filteredReferentes = computed(() => {
  const q = referenteFilter.value.trim().toLowerCase();
  const list = clientsStore.clients;
  if (!q) return list.slice(0, 30);
  return list
    .filter((c) => `${c.first_name} ${c.last_name} ${c.document_number}`.toLowerCase().includes(q))
    .slice(0, 30);
});

// Un DNI/RUC/pasaporte es unico por cliente (constraint en BD): si ya existe,
// no hay que crear un cliente nuevo, sino agregarle un contrato (linea) desde
// su ficha. Sin este chequeo, el intento de alta falla recien al guardar con
// el error crudo de Postgres (unique constraint), sin decir que hacer.
const duplicateClient = computed<Client | null>(() => {
  const doc = form.value.document_number.trim();
  if (!doc) return null;
  return (
    clientsStore.clients.find(
      (c) => c.document_number.trim().toLowerCase() === doc.toLowerCase() && c.id !== editing.value?.id,
    ) ?? null
  );
});

// Indice contratos-por-cliente: antes clientCodesOf/clientPrioritiesOf
// recorrian TODOS los contratos por cada cliente (O(n_clientes x n_contratos)),
// y como filteredClientsList llama a clientCodesOf por cada cliente en cada
// letra tecleada en el buscador, con ~200+ clientes esto se sentia lento.
// Este Map solo se reconstruye cuando cambian los contratos (no en cada
// tecla), y cada lookup despues es O(1).
const contractsByClient = computed(() => {
  const map = new Map<string, typeof contractsStore.contracts>();
  for (const ct of contractsStore.contracts) {
    const arr = map.get(ct.client_id);
    if (arr) arr.push(ct);
    else map.set(ct.client_id, [ct]);
  }
  return map;
});

// El codigo de cliente ahora es por servicio (Fase 39, se edita desde la
// pestaña "Contrato" de cada linea) — ya no se muestra aca, pero se sigue
// pudiendo buscar por el.
function clientCodesOf(clientId: string) {
  return (contractsByClient.value.get(clientId) ?? [])
    .filter((ct) => ct.client_code)
    .map((ct) => ct.client_code)
    .join(' ');
}

// Prioridad (Fase 41): tambien es por servicio, reemplaza al codigo en esta
// columna de la lista general de clientes.
const PRIORITY_LABEL: Record<ContractPriority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const PRIORITY_CLASS: Record<ContractPriority, string> = {
  high: 'bg-red-500/15 text-red-600',
  medium: 'bg-yellow-500/15 text-yellow-600',
  low: 'bg-slate-500/15 text-slate-600',
};
function clientPrioritiesOf(clientId: string): ContractPriority[] {
  return (contractsByClient.value.get(clientId) ?? []).map((ct) => ct.priority);
}

const filteredClientsList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return clientsStore.clients;
  return clientsStore.clients.filter((c) =>
    `${c.first_name} ${c.last_name} ${clientCodesOf(c.id)} ${c.document_number} ${c.phone ?? ''} ${c.phone_2 ?? ''} ${c.email ?? ''}`
      .toLowerCase()
      .includes(q),
  );
});

// Usuarios PPPoE (del router elegido) que no tienen NINGUN contrato en
// SmartRayco todavia, leido en vivo de la tabla service_contracts.
const unlinkedDeviceId = ref('');
const unlinkedSecrets = ref<PppSecret[]>([]);
const loadingUnlinked = ref(false);

async function loadUnlinked() {
  if (!unlinkedDeviceId.value) {
    unlinkedSecrets.value = [];
    return;
  }
  loadingUnlinked.value = true;
  try {
    const secrets = await mikrotikStore.fetchPppSecrets(unlinkedDeviceId.value);
    const linked = new Set(
      contractsStore.contracts.filter((c) => c.mikrotik_device_id === unlinkedDeviceId.value).map((c) => c.pppoe_username),
    );
    unlinkedSecrets.value = secrets.filter((s) => !linked.has(s.name));
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al leer usuarios PPPoE del router');
  } finally {
    loadingUnlinked.value = false;
  }
}

watch(unlinkedDeviceId, () => loadUnlinked());

const emptyForm = () => ({
  document_type: 'cedula' as DocumentType,
  document_number: '',
  first_name: '',
  last_name: '',
  phone: '',
  phone_2: '',
  email: '',
  address: '',
  status: 'prospect' as ClientStatus,
});

const form = ref(emptyForm());

const STATUS_LABEL: Record<ClientStatus, string> = {
  prospect: 'Prospecto',
  active: 'Activo',
  suspended: 'Suspendido',
  retired: 'Baja',
};
const STATUS_CLASS: Record<ClientStatus, string> = {
  prospect: 'bg-yellow-500/15 text-yellow-600',
  active: 'bg-green-500/15 text-green-600',
  suspended: 'bg-red-500/15 text-red-600',
  retired: 'bg-slate-500/15 text-slate-600',
};

onMounted(async () => {
  await Promise.all([clientsStore.fetchClients(), contractsStore.fetchContracts(), mikrotikStore.fetchDevices()]);
  if (mikrotikStore.devices.length === 1) {
    unlinkedDeviceId.value = mikrotikStore.devices[0].id;
  }

  const prospectId = route.query.prospect_id as string | undefined;
  if (prospectId) {
    openCreate();
    convertingProspectId.value = prospectId;
    const fullName = ((route.query.name as string) ?? '').trim();
    convertingProspectName.value = fullName || null;
    const [first, ...rest] = fullName.split(/\s+/).filter(Boolean);
    form.value.first_name = first ?? '';
    form.value.last_name = rest.join(' ');
    form.value.phone = (route.query.phone as string) ?? '';
    form.value.address = (route.query.address as string) ?? '';
    // Limpia los query params para no reabrir/reprecargar el modal si el
    // tecnico recarga la pagina o navega de vuelta.
    router.replace('/clientes');
  }
});

function openCreate(fromSecret?: PppSecret) {
  editing.value = null;
  convertingProspectId.value = null;
  convertingProspectName.value = null;
  form.value = emptyForm();
  pendingPppoeHint.value = fromSecret ? fromSecret.name : null;
  formError.value = null;
  referenteId.value = '';
  referenteFilter.value = '';
  showModal.value = true;
}

function openEdit(client: Client) {
  editing.value = client;
  form.value = {
    document_type: client.document_type,
    document_number: client.document_number,
    first_name: client.first_name,
    last_name: client.last_name,
    phone: client.phone ?? '',
    phone_2: client.phone_2 ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    status: client.status,
  };
  formError.value = null;
  showModal.value = true;
}

async function handleSubmit() {
  if (duplicateClient.value) {
    formError.value = `Ya existe un cliente con ese documento (${duplicateClient.value.first_name} ${duplicateClient.value.last_name}). Ve a su ficha y usa "+ Nuevo contrato" para agregarle otro servicio.`;
    return;
  }

  // Fase 145 — el telefono de clients NUNCA fue unique (ver migracion Fase
  // 140, mismo criterio ahi para prospects), asi que no se puede bloquear
  // como el documento — pero si avisar antes de crear un duplicado real,
  // en vez de "sin validacion". Solo aplica al convertir un prospecto: en
  // el alta manual normal dos clientes pueden compartir telefono a
  // proposito (pareja, oficina) y no corresponde interrumpirla.
  if (!editing.value && convertingProspectId.value && form.value.phone) {
    const dupPhone = clientsStore.clients.find(
      (c) => c.phone === form.value.phone || c.phone_2 === form.value.phone,
    );
    if (dupPhone) {
      const ok = await confirmDialog({
        title: 'Posible cliente duplicado',
        message: `Ya existe un cliente con este teléfono: ${dupPhone.first_name} ${dupPhone.last_name}. ¿Seguro que quieres crear uno nuevo de todas formas?`,
        warning: true,
        confirmLabel: 'Crear de todas formas',
      });
      if (!ok) return;
    }
  }

  saving.value = true;
  formError.value = null;
  try {
    const payload = {
      ...form.value,
      phone: form.value.phone || null,
      phone_2: form.value.phone_2 || null,
      email: form.value.email || null,
      address: form.value.address || null,
    };
    let savedId: string;
    if (editing.value) {
      const saved = await clientsStore.updateClient(editing.value.id, payload);
      savedId = saved.id;
    } else {
      const created = await clientsStore.createClient(payload);
      savedId = created.id;

      // Referido (Fase 33): solo en el alta. El cliente ya quedo guardado,
      // asi que un fallo aca no debe perder los demas datos.
      if (referenteId.value) {
        try {
          await referidosStore.create(referenteId.value, savedId);
        } catch (e) {
          alert(getErrorMessage(e, 'El cliente se guardó, pero no se pudo registrar el referido'));
        }
      }

      // Fase 145 — al convertir un prospecto, ademas del cliente se genera
      // la orden de Alta correspondiente, usando el mismo store/flujo que
      // "Nueva instalación" en Soporte (InstalacionesView.vue): mismo
      // payload minimo (solo client_id), mismos defaults reales de la
      // tabla (status 'pending', priority 'medium') — sin agendar fecha ni
      // asignar tecnico, eso lo decide el staff despues por el
      // procedimiento normal. Si falla, el cliente igual queda creado
      // (mismo criterio que el referido arriba) — se avisa y se puede
      // crear la Alta a mano desde Soporte → Instalaciones.
      let installationCreated = false;
      if (convertingProspectId.value) {
        try {
          await installationsStore.createInstallation({ client_id: savedId });
          installationCreated = true;
        } catch (e) {
          toast.error(getErrorMessage(e, 'El cliente se creó, pero no se pudo generar la orden de Alta. Puedes crearla manualmente desde Soporte → Instalaciones.'));
        }
      }

      // Fase 140 — el cliente YA se creo correctamente (savedId real, no
      // supuesto): recien aca se marca el prospecto 'convertido', nunca
      // antes (punto 9 del pedido). Si falla, el cliente igual queda
      // creado — solo se avisa, no se revierte el alta.
      if (convertingProspectId.value) {
        try {
          await prospectsStore.markConverted(convertingProspectId.value, savedId);
          toast.success(
            installationCreated
              ? `Prospecto convertido: se creó el cliente y su orden de Alta.`
              : `Prospecto convertido: se creó el cliente (falta crear la orden de Alta a mano).`,
          );
        } catch (e) {
          toast.error(getErrorMessage(e, 'El cliente se creó, pero no se pudo marcar el prospecto como convertido'));
        }
        convertingProspectId.value = null;
        convertingProspectName.value = null;
        showModal.value = false;
        router.push(`/clientes/${savedId}`);
        return;
      }
    }

    showModal.value = false;
    if (!editing.value && pendingPppoeHint.value) {
      // El cliente viene de un usuario PPPoE sin contrato: seguimos directo
      // a su ficha para crear el contrato y terminar de vincularlo ahi.
      router.push(`/clientes/${savedId}`);
    }
  } catch (e) {
    formError.value = getErrorMessage(e, 'Error al guardar el cliente');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(client: Client) {
  const ok = confirm(`¿Eliminar a ${client.first_name} ${client.last_name}? Esta accion no se puede deshacer.`);
  if (!ok) return;
  try {
    await clientsStore.deleteClient(client.id);
  } catch (e) {
    alert(getErrorMessage(e, 'Error al eliminar el cliente'));
  }
}

function goToDetail(client: Client) {
  router.push(`/clientes/${client.id}`);
}
</script>

<template>
  <AppLayout>
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Clientes</h1>
        <p class="text-slate-600 text-sm mt-1">
          {{ searchQuery ? `${filteredClientsList.length} de ${clientsStore.clients.length}` : `${clientsStore.clients.length} registrados` }}
        </p>
      </div>
      <div v-if="canManageClients" class="flex gap-2">
        <router-link to="/clientes/prospectos" class="btn-secondary">🙋 Prospectos</router-link>
        <button class="btn-primary" @click="openCreate()">+ Nuevo cliente</button>
      </div>
    </div>

    <p v-if="clientsStore.error" class="mb-4 text-sm text-red-600">{{ clientsStore.error }}</p>

    <input
      v-model="searchQuery"
      placeholder="Buscar por nombre, documento, telefono o correo..."
      class="field-input mb-6"
    />

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">Prioridad</th>
            <th class="text-left px-4 py-3">Nombre</th>
            <th class="text-left px-4 py-3">Documento</th>
            <th class="text-left px-4 py-3">Telefono</th>
            <th class="text-left px-4 py-3">Servicios</th>
            <th class="text-left px-4 py-3">Estado</th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="clientsStore.loading">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!filteredClientsList.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery ? 'Sin resultados para esa busqueda.' : 'No hay clientes. Crea el primero.' }}
            </td>
          </tr>
          <tr v-for="c in filteredClientsList" :key="c.id" class="border-t border-slate-200 hover:bg-slate-50">
            <td class="px-4 py-3">
              <span v-if="!clientPrioritiesOf(c.id).length" class="text-slate-400 text-xs">—</span>
              <span
                v-for="(p, idx) in clientPrioritiesOf(c.id)"
                :key="idx"
                class="badge mr-1"
                :class="PRIORITY_CLASS[p]"
              >
                {{ PRIORITY_LABEL[p] }}
              </span>
            </td>
            <td class="px-4 py-3">
              <button class="text-slate-900 hover:text-sky-600 font-medium" @click="goToDetail(c)">
                {{ c.first_name }} {{ c.last_name }}
              </button>
            </td>
            <td class="px-4 py-3 text-slate-600">{{ c.document_number }}</td>
            <td class="px-4 py-3 text-slate-600">{{ c.phone || '—' }}</td>
            <td class="px-4 py-3 text-slate-600">{{ contractsStore.contracts.filter((ct) => ct.client_id === c.id).length }}</td>
            <td class="px-4 py-3">
              <span class="badge" :class="STATUS_CLASS[c.status]">
                {{ STATUS_LABEL[c.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(c)">Editar</button>
              <button v-if="canManageClients" class="text-red-500/80 hover:text-red-600 text-xs" @click="handleDelete(c)">Eliminar</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rounded-xl border border-slate-200 bg-slate-100 p-5 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 class="text-sm font-semibold">Usuarios PPPoE sin contrato</h2>
        <select
          v-model="unlinkedDeviceId"
          class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
        >
          <option value="">Selecciona un router MikroTik</option>
          <option v-for="d in mikrotikStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
      </div>
      <p v-if="!unlinkedDeviceId" class="text-sm text-slate-500">Elige un router para ver sus usuarios PPPoE sin contrato.</p>
      <p v-else-if="loadingUnlinked" class="text-sm text-slate-500">Cargando...</p>
      <p v-else-if="!unlinkedSecrets.length" class="text-sm text-green-600">Todos los usuarios PPPoE de este router ya tienen contrato.</p>
      <div v-else class="rounded-lg border border-slate-200 overflow-hidden overflow-x-auto">
        <table class="w-full text-sm min-w-[560px]">
          <thead class="bg-white text-slate-600 text-xs uppercase">
            <tr>
              <th class="text-left px-4 py-2">Usuario</th>
              <th class="text-left px-4 py-2">Perfil</th>
              <th class="text-left px-4 py-2">Comentario</th>
              <th class="text-right px-4 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in unlinkedSecrets" :key="s['.id']" class="border-t border-slate-200">
              <td class="px-4 py-2 font-mono text-xs">{{ s.name }}</td>
              <td class="px-4 py-2 text-slate-600">{{ s.profile }}</td>
              <td class="px-4 py-2 text-slate-600">{{ s.comment || '—' }}</td>
              <td class="px-4 py-2 text-right">
                <button v-if="canManageClients" class="text-sky-700 hover:underline text-xs" @click="openCreate(s)">Crear cliente</button>
                <span v-else class="text-xs text-slate-400">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-slate-400 mt-2">
        Al crear el cliente pasas directo a su ficha para armar el contrato y terminar de vincularlo ahi.
      </p>
    </div>

    <Teleport to="body">
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-1">{{ editing ? 'Editar cliente' : 'Nuevo cliente' }}</h2>
          <p v-if="convertingProspectId" class="text-xs font-medium text-amber-700 bg-amber-500/10 rounded-lg px-2.5 py-1.5 mb-3">
            Convirtiendo el prospecto{{ convertingProspectName ? ` "${convertingProspectName}"` : '' }} en cliente —
            completa el documento y los datos que falten, y guarda para terminar. Esto también crea su orden de Alta
            en Soporte. Si cierras sin guardar, no queda nada registrado.
          </p>
          <p v-else-if="pendingPppoeHint" class="text-xs text-sky-700/80 mb-3">
            Vinculado a partir del usuario PPPoE <span class="font-mono">{{ pendingPppoeHint }}</span> — el vinculo se completa al crear el contrato.
          </p>
          <div v-else class="mb-3"></div>
          <p class="text-xs text-slate-400 mb-3">
            El código de cliente ahora se asigna por servicio, desde la ficha de cada línea.
          </p>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Tipo de documento</label>
              <select v-model="form.document_type" class="field-input">
                <option value="cedula">DNI</option>
                <option value="ruc">RUC</option>
                <option value="pasaporte">Pasaporte</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Numero de documento</label>
              <input v-model="form.document_number" required class="field-input" />
            </div>
          </div>

          <div v-if="duplicateClient" class="mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Ya existe un cliente con este documento:
            <span class="font-medium">{{ duplicateClient.first_name }} {{ duplicateClient.last_name }}</span>.
            Un mismo cliente puede tener varias lineas — no crees otro cliente, agrega el contrato desde su ficha.
            <button
              type="button"
              class="block mt-1 font-medium text-sky-700 hover:text-sky-800 underline"
              @click="showModal = false; router.push(`/clientes/${duplicateClient.id}`)"
            >
              Ir a la ficha y agregar "+ Nuevo contrato"
            </button>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Nombres</label>
              <input v-model="form.first_name" required class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Apellidos</label>
              <input v-model="form.last_name" required class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Telefono</label>
              <input v-model="form.phone" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Telefono alterno</label>
              <input v-model="form.phone_2" class="field-input" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="block text-xs text-slate-600 mb-1">Correo</label>
              <input v-model="form.email" type="email" class="field-input" />
            </div>
            <div>
              <label class="block text-xs text-slate-600 mb-1">Direccion</label>
              <input v-model="form.address" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Estado</label>
            <select v-model="form.status" class="field-input">
              <option value="prospect">Prospecto</option>
              <option value="active">Activo</option>
              <option value="suspended">Suspendido</option>
              <option value="retired">Baja</option>
            </select>
          </div>
          <p class="text-xs text-slate-400 mb-3">
            La zona y la caja NAP ahora se asignan por servicio, desde la ficha de cada línea del cliente.
          </p>

          <div v-if="!editing" class="mb-4">
            <label class="block text-xs text-slate-600 mb-1">Cliente que lo recomendó (opcional)</label>
            <p class="text-[11px] text-slate-400 mb-1.5">Si aplica, el referente recibe un descuento de S/25 en su siguiente factura.</p>
            <input v-model="referenteFilter" placeholder="Buscar por nombre o documento..." class="field-input mb-2" />
            <select v-model="referenteId" class="field-input" size="4">
              <option value="">Sin referido</option>
              <option v-for="c in filteredReferentes" :key="c.id" :value="c.id">{{ c.first_name }} {{ c.last_name }} — {{ c.document_number }}</option>
            </select>
          </div>

          <p v-if="formError" class="text-sm text-red-600 mb-3">{{ formError }}</p>

          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="showModal = false">
              Cancelar
            </button>
            <button type="submit" :disabled="saving" class="btn-primary">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </form>
      </div>
    </Teleport>
  </AppLayout>
</template>
