<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppLayout from '@/components/layout/AppLayout.vue';
import ClientRetirementDialog from '@/components/clientes/ClientRetirementDialog.vue';
import { useClientsStore } from '@/stores/clients';
import { useContractsStore } from '@/stores/contracts';
import { useMikrotikStore, type PppSecret } from '@/stores/mikrotik';
import { useAuthStore } from '@/stores/auth';
import { useReferidosStore } from '@/stores/referidos';
import { useProspectsStore } from '@/stores/prospects';
import { useInstallationsStore } from '@/stores/installations';
import { useCatalogsStore } from '@/stores/catalogs';
import { useToast } from '@/composables/useToast';
import { useConfirm } from '@/composables/useConfirm';
import { getErrorMessage } from '@/lib/errors';
import { classifyClientSection, isRetiredClient, countServicesByVigencia, formatServiceCounts, OPEN_INSTALLATION_STATUSES, type ClientSection } from '@/lib/clientLifecycle';
import {
  clientPriorityRank, matchesStatusFilter, matchesServiceFilter, sortClientRows, parseClientsListQuery, buildClientsListQuery,
  type ClientStatusFilter, type ServiceFilter, type SortColumn, type SortDirection,
} from '@/lib/clientsListFilters';
import type { ClientWithLifecycle } from '@/stores/clients';
import type { Client, ClientStatus, ContractPriority, DocumentType, Installation } from '@/types/domain';

const route = useRoute();
const router = useRouter();
const clientsStore = useClientsStore();
const contractsStore = useContractsStore();
const mikrotikStore = useMikrotikStore();
const auth = useAuthStore();
const referidosStore = useReferidosStore();
const prospectsStore = useProspectsStore();
const installationsStore = useInstallationsStore();
const catalogs = useCatalogsStore();
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
// Fase 146 — zona/PON y plan de interes del prospecto (ver
// ProspectosView.vue), para precargar el contrato que se crea junto con
// el cliente al convertir. No son datos del cliente ni del formulario
// visible, por eso van aparte y no dentro de `form`.
const convertingZoneId = ref<string | null>(null);
const convertingPlanId = ref<string | null>(null);

// TECNICO_RED puede ver/editar clientes (GPS, fotos), pero no crearlos ni
// eliminarlos — eso queda para SOPORTE/ADMIN/FACTURACION.
const canManageClients = computed(() => auth.role !== 'TECNICO_RED');

const showModal = ref(false);
const editing = ref<Client | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
const pendingPppoeHint = ref<string | null>(null);
// Filtros/orden/pestaña se leen una sola vez de la URL al montar (persisten
// al abrir una ficha y volver — ver goBack() en ClientDetailView.vue, que
// usa router.back() en vez de un push fijo a "/clientes" sin query — y se
// reescriben en la URL con router.replace cada vez que el usuario los toca,
// ver syncFiltersToUrl más abajo).
const initialListQuery = parseClientsListQuery(route.query);
const searchQuery = ref(initialListQuery.q);
const clientSection = ref<ClientSection>(initialListQuery.section);
const statusFilter = ref<ClientStatusFilter>(initialListQuery.status);
const serviceFilter = ref<ServiceFilter>(initialListQuery.service);
const sortColumn = ref<SortColumn | null>(initialListQuery.sort);
const sortDirection = ref<SortDirection>(initialListQuery.dir);
function syncFiltersToUrl() {
  const query = buildClientsListQuery({
    section: clientSection.value, q: searchQuery.value, status: statusFilter.value,
    service: serviceFilter.value, sort: sortColumn.value, dir: sortDirection.value,
  });
  router.replace({ path: '/clientes', query }).catch(() => {});
}
let searchSyncTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, () => {
  clearTimeout(searchSyncTimer);
  searchSyncTimer = setTimeout(syncFiltersToUrl, 300);
});
watch([clientSection, statusFilter, serviceFilter, sortColumn, sortDirection], syncFiltersToUrl);
// Si se navega a una ficha (goToDetail) con el debounce de busqueda todavia
// pendiente, ese setTimeout sobrevive al desmontaje y dispararia un
// router.replace sobre "/clientes" mientras el usuario ya esta viendo la
// ficha -- lo saca de la pantalla a la que navego. Se cancela aqui.
onBeforeUnmount(() => clearTimeout(searchSyncTimer));
function toggleSort(column: SortColumn) {
  if (sortColumn.value === column) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
  else { sortColumn.value = column; sortDirection.value = 'asc'; }
}
function sortIndicator(column: SortColumn): string {
  if (sortColumn.value !== column) return '';
  return sortDirection.value === 'asc' ? ' ▲' : ' ▼';
}
function clearFilters() {
  searchQuery.value = '';
  statusFilter.value = 'all';
  serviceFilter.value = 'all';
  sortColumn.value = null;
  sortDirection.value = 'asc';
}
const STATUS_FILTER_OPTIONS: { value: ClientStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activo' },
  { value: 'suspended', label: 'Suspendido' },
  { value: 'prospect', label: 'Prospecto' },
  { value: 'retired', label: 'Baja' },
];
const SERVICE_FILTER_OPTIONS: { value: ServiceFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'vigente', label: 'Con servicios vigentes' },
  { value: 'historico', label: 'Con históricos' },
  { value: 'multi', label: 'Múltiples servicios' },
];
const SECTION_TABS: { value: ClientSection; label: string }[] = [
  { value: 'current', label: 'Clientes vigentes' },
  { value: 'pending_install', label: 'Pendientes de instalación' },
  { value: 'unfulfilled', label: 'No instalados' },
  { value: 'retired', label: 'Clientes retirados' },
];
const classificationReady = ref(false);
const classificationError = ref<string | null>(null);
const canPrepareReincorporation = computed(() => auth.role === 'ADMIN' || auth.role === 'SUPERADMIN');
const reincorporatingClient = ref<Client | null>(null);
const retirementClientId = ref<string | null>(null);
function handleFormStatusChange() {
  if (form.value.status !== 'retired' || !editing.value || editing.value.status === 'retired') return;
  form.value.status = editing.value.status;
  if (!canPrepareReincorporation.value) { formError.value = 'La baja definitiva requiere ADMIN o SUPERADMIN.'; return; }
  retirementClientId.value = editing.value.id;
}
async function retirementCompleted() {
  showModal.value = false;
  try { await Promise.all([clientsStore.fetchClients(), contractsStore.fetchContracts()]); }
  catch { toast.error('Baja confirmada. No se pudo actualizar el listado; recarga para consultar el estado actual.'); }
}
// Las 4 secciones reales del listado (ver src/lib/clientLifecycle.ts):
// vigentes, pendientes de instalación, no instalados y retirados — un solo
// recorrido, cada ficha cae en exactamente una.
const sectionBuckets = computed(() => {
  const buckets: Record<ClientSection, ClientWithLifecycle[]> = { current: [], pending_install: [], unfulfilled: [], retired: [] };
  for (const c of clientsStore.clients) buckets[classifyClientSection(c)].push(c);
  return buckets;
});
const currentClients = computed(() => sectionBuckets.value.current);
const pendingInstallClients = computed(() => sectionBuckets.value.pending_install);
const unfulfilledClients = computed(() => sectionBuckets.value.unfulfilled);
const retiredClients = computed(() => sectionBuckets.value.retired);
// Dentro de "vigentes", fichas sin ningún contrato (consultables, nunca
// contrataron nada todavía) — se conservan visibles con una nota aparte,
// mismo criterio que ya existía.
const withoutAnyContractCount = computed(() => currentClients.value.filter((c) => !c.service_contracts.length).length);
const sectionClients = computed(() => sectionBuckets.value[clientSection.value]);
const pendingInstallationClients = computed(() => new Set(clientsStore.clients
  .filter((c) => c.installations.some((i) => OPEN_INSTALLATION_STATUSES.has(i.status)))
  .map((c) => c.id)));

function prepareReincorporation(client: ClientWithLifecycle) {
  if (!canPrepareReincorporation.value || !isRetiredClient(client)) return;
  reincorporatingClient.value = client;
}

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
const duplicateClient = computed<ClientWithLifecycle | null>(() => {
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

// Columna "Servicios": "N vigentes · M históricos" (ver countServicesByVigencia
// / formatServiceCounts en clientLifecycle.ts) — reutiliza contractsByClient,
// sin ninguna consulta nueva.
function serviceCountLabel(clientId: string): string {
  const { vigentes, historicos } = countServicesByVigencia(contractsByClient.value.get(clientId) ?? []);
  return formatServiceCounts(vigentes, historicos);
}

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

// Fase 153 — mismo indice que contractsByClient de arriba, pero para
// instalaciones: lo necesita el filtro "Pendientes de instalacion" y la
// columna de Estado (ver clientDisplayStatus) para distinguir un cliente
// que de verdad esta esperando su Alta de uno que ya tiene todo
// completado pero a quien nunca le actualizaron clients.status a 'active'
// a mano (confirmado en produccion antes de escribir esto: existen
// clientes reales con status='prospect' y una instalacion 'completed' —
// confiar solo en clients.status los mostraria como "pendientes" estando
// activos de verdad).
const installationsByClient = computed(() => {
  const map = new Map<string, Installation[]>();
  for (const inst of installationsStore.installations) {
    const arr = map.get(inst.client_id);
    if (arr) arr.push(inst);
    else map.set(inst.client_id, [inst]);
  }
  return map;
});
function openInstallationFor(clientId: string): Installation | null {
  return (installationsByClient.value.get(clientId) ?? []).find((i) => OPEN_INSTALLATION_STATUSES.has(i.status)) ?? null;
}
function hasOpenInstallation(clientId: string): boolean {
  return pendingInstallationClients.value.has(clientId);
}
// Instalacion mas relevante para el acceso rapido "Ver orden de Alta": la
// abierta si hay una, si no la mas reciente (asi el acceso rapido sigue
// sirviendo incluso para revisar una Alta ya completada/cancelada).
function latestInstallationFor(clientId: string): Installation | null {
  const list = installationsByClient.value.get(clientId) ?? [];
  if (!list.length) return null;
  return openInstallationFor(clientId) ?? [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

// Estado real mostrado en la tabla: siempre clients.status tal cual esta en
// Supabase (Fase 154 — antes la Fase 153 lo reemplazaba por "Pendiente de
// instalación" cuando era 'prospect' + Alta abierta, lo que ocultaba el
// estado real del cliente). No se cambia ningun estado en la base, solo la
// etiqueta visible.
function clientDisplayStatus(c: Client): { label: string; cls: string } {
  return { label: STATUS_LABEL[c.status], cls: STATUS_CLASS[c.status] };
}

// Fase 154: indicador separado del estado de instalación — se muestra junto
// al badge de estado del cliente (sin reemplazarlo) cuando hay una Alta
// abierta, sin importar si clients.status es 'prospect' o quedo en 'active'
// desactualizado. Distingue visualmente "estado del cliente" de "estado de
// instalación", que es justo lo que pide esta fase.
function pendingInstallLabel(c: Client): string | null {
  return hasOpenInstallation(c.id) ? 'Alta pendiente' : null;
}

// Filtros desplegables (Estado/Servicios) — se combinan entre si, con la
// pestaña seleccionada (sectionClients, ya filtrada por sección) y con la
// busqueda de texto, en ese orden. "Estado" usa clients.status tal cual
// (los 4 estados reales, ver STATUS_LABEL); "Servicios" reutiliza el mismo
// conteo vigentes/historicos de la columna "Servicios" (countServicesByVigencia),
// sin ninguna consulta nueva.
const filteredClientsList = computed(() => {
  if (!classificationReady.value) return [];
  let list = sectionClients.value;
  if (statusFilter.value !== 'all') list = list.filter((c) => matchesStatusFilter(c.status, statusFilter.value));
  if (serviceFilter.value !== 'all') {
    list = list.filter((c) => {
      const contracts = contractsByClient.value.get(c.id) ?? [];
      const { vigentes, historicos } = countServicesByVigencia(contracts);
      return matchesServiceFilter({ vigentes, historicos, total: contracts.length }, serviceFilter.value);
    });
  }

  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter((c) =>
      `${c.first_name} ${c.last_name} ${clientCodesOf(c.id)} ${c.document_number} ${c.phone ?? ''} ${c.phone_2 ?? ''} ${c.email ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  }
  return list;
});

// Orden tipo Excel (Nombre/Estado/Prioridad/Cantidad de servicios) — se
// aplica DESPUES de filtrar, nunca cambia que filas entran, solo su orden.
const sortedFilteredClients = computed(() => {
  const rows = filteredClientsList.value.map((c) => ({
    client: c,
    id: c.id,
    name: `${c.first_name} ${c.last_name}`,
    statusLabel: STATUS_LABEL[c.status],
    priorityRank: clientPriorityRank(clientPrioritiesOf(c.id)),
    serviceCount: contractsByClient.value.get(c.id)?.length ?? 0,
  }));
  return sortClientRows(rows, sortColumn.value, sortDirection.value).map((r) => r.client);
});

// Usuarios PPPoE (del router elegido) que no tienen NINGUN contrato en
// SmartRayco todavia, leido en vivo de la tabla service_contracts.
const unlinkedDeviceId = ref('');
const unlinkedSecrets = ref<PppSecret[]>([]);
const loadingUnlinked = ref(false);
// Fase 154: plegado por defecto — es una sección de mantenimiento ocasional,
// no la tarea principal de esta vista. Solo cambia la visibilidad, no la
// carga de datos (sigue igual que antes una vez expandida).
const showUnlinkedSection = ref(false);

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
  try {
    await Promise.all([
      clientsStore.fetchClients(),
      contractsStore.fetchContracts(),
      installationsStore.fetchInstallations(),
      mikrotikStore.fetchDevices(),
      catalogs.fetchPlans(),
      catalogs.fetchZones(),
    ]);
    classificationReady.value = true;
  } catch (e) {
    classificationError.value = getErrorMessage(e, 'No se pudo cargar la clasificación de clientes. Recarga para reintentar.');
    return;
  }
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
    convertingZoneId.value = (route.query.zone_id as string) || null;
    convertingPlanId.value = (route.query.plan_id as string) || null;
    // Limpia los query params para no reabrir/reprecargar el modal si el
    // tecnico recarga la pagina o navega de vuelta. OJO: NO usar
    // router.replace() aca — App.vue monta la vista con
    // :key="route.fullPath", asi que un replace() (que cambia route.query
    // y por lo tanto route.fullPath) destruye y remonta este mismo
    // componente al toque, cerrando el modal que recien se abrio arriba
    // (bug real, confirmado en vivo 2026-10-12: el modal abria y se
    // cerraba en el mismo tick, invisible para el usuario, sin crear
    // cliente/contrato/instalacion). history.replaceState() cambia la URL
    // visible sin tocar la ruta reactiva de Vue Router, asi que no dispara
    // el remount.
    window.history.replaceState(window.history.state, '', '/clientes');
  }
});

function openCreate(fromSecret?: PppSecret) {
  editing.value = null;
  convertingProspectId.value = null;
  convertingProspectName.value = null;
  convertingZoneId.value = null;
  convertingPlanId.value = null;
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
  // Fase 147 — guarda explicita contra doble envio (Enter + click casi
  // simultaneos, etc.): :disabled="saving" en el boton ya cubre el click
  // normal, pero handleSubmit no se auto-protegia si se disparaba por otra
  // via mientras una llamada anterior seguia en vuelo.
  if (saving.value) return;
  if (duplicateClient.value && !convertingProspectId.value) {
    formError.value = `Ya existe un cliente con ese documento (${duplicateClient.value.first_name} ${duplicateClient.value.last_name}). Consulta su ficha existente para conservar sus relaciones e historial.`;
    return;
  }

  // Fase 145 — el telefono de clients NUNCA fue unique (ver migracion Fase
  // 140, mismo criterio ahi para prospects), asi que no se puede bloquear
  // como el documento — pero si avisar antes de crear un duplicado real,
  // en vez de "sin validacion". Solo aplica al convertir un prospecto: en
  // el alta manual normal dos clientes pueden compartir telefono a
  // proposito (pareja, oficina) y no corresponde interrumpirla.
  if (!editing.value && convertingProspectId.value && form.value.phone && !duplicateClient.value) {
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
    if (!editing.value && convertingProspectId.value) {
      // El backend acredita el Prospecto y confirma cliente/contrato/Alta juntos.
      // Un reintento recupera el recibo; no repite escrituras parciales.
      const receipt = await prospectsStore.convertToClient(convertingProspectId.value, payload, referenteId.value || null);
      toast.success(receipt.replayed
        ? 'Conversión ya completada: se recuperó la misma ficha y orden de Alta.'
        : 'Prospecto convertido: cliente, servicio y Alta con 0 puntos iniciales. Asigna puntos antes del cierre administrativo.');
      convertingProspectId.value = null;
      convertingProspectName.value = null;
      convertingZoneId.value = null;
      convertingPlanId.value = null;
      showModal.value = false;
      router.push(`/clientes/${receipt.client_id}`);
      return;
    }
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
          {{ classificationError ? 'Clasificación no disponible' : !classificationReady ? 'Cargando clasificación…' : `${currentClients.length} vigentes · ${pendingInstallClients.length} pendientes de instalación · ${unfulfilledClients.length} no instalados · ${retiredClients.length} retirados` }}
          <span v-if="classificationReady && withoutAnyContractCount"> · {{ withoutAnyContractCount }} fichas sin ningún contrato</span>
        </p>
      </div>
      <div v-if="canManageClients" class="flex gap-2">
        <router-link to="/clientes/prospectos" class="btn-secondary">🙋 Prospectos</router-link>
        <button class="btn-primary" @click="openCreate()">+ Nuevo cliente</button>
      </div>
    </div>

    <p v-if="clientsStore.error" class="mb-4 text-sm text-red-600">{{ clientsStore.error }}</p>
    <p v-if="classificationError" role="alert" class="mb-4 text-sm text-red-600">{{ classificationError }}</p>

    <div class="flex flex-wrap gap-2 mb-4" aria-label="Secciones de clientes">
      <button v-for="section in SECTION_TABS" :key="section.value" type="button"
        class="btn-secondary" :class="clientSection === section.value ? 'ring-2 ring-sky-500' : ''" :aria-pressed="clientSection === section.value" :disabled="!classificationReady"
        @click="clientSection = section.value">
        {{ section.label }}
        <span v-if="classificationReady">({{ sectionBuckets[section.value].length }})</span>
      </button>
    </div>
    <p class="text-xs text-slate-500 mb-3">Vigentes incluye servicios suspendidos. Pendientes de instalación: contratación con una Alta todavía abierta. No instalados: la contratación se canceló antes de instalarse, nunca recibió servicio — vuelve a ser elegible para una nueva venta. Retirados: tuvo servicio instalado y ya no tiene ninguno vigente. El estado de la ficha se conserva siempre.</p>
    <p v-if="classificationReady" class="text-sm text-slate-600 mb-3">{{ sortedFilteredClients.length }} resultados de {{ sectionClients.length }} clientes en esta sección</p>

    <div class="flex flex-wrap items-end gap-3 mb-3">
      <div>
        <label for="clients-status-filter" class="block text-xs text-slate-600 mb-1">Estado</label>
        <select id="clients-status-filter" v-model="statusFilter" class="field-input text-sm">
          <option v-for="opt in STATUS_FILTER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div>
        <label for="clients-service-filter" class="block text-xs text-slate-600 mb-1">Servicios</label>
        <select id="clients-service-filter" v-model="serviceFilter" class="field-input text-sm">
          <option v-for="opt in SERVICE_FILTER_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <button type="button" class="btn-secondary text-xs" @click="clearFilters">Limpiar filtros</button>
    </div>

    <input
      v-model="searchQuery"
      placeholder="Buscar por nombre, documento, telefono o correo..."
      class="field-input mb-6"
    />

    <div class="table-shell mb-6">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="bg-slate-100 text-slate-600 text-xs uppercase">
          <tr>
            <th class="text-left px-4 py-3">
              <button type="button" class="font-semibold uppercase text-xs hover:text-slate-900" @click="toggleSort('priority')">Prioridad{{ sortIndicator('priority') }}</button>
            </th>
            <th class="text-left px-4 py-3">
              <button type="button" class="font-semibold uppercase text-xs hover:text-slate-900" @click="toggleSort('name')">Nombre{{ sortIndicator('name') }}</button>
            </th>
            <th class="text-left px-4 py-3">Documento</th>
            <th class="text-left px-4 py-3">Telefono</th>
            <th class="text-left px-4 py-3">
              <button type="button" class="font-semibold uppercase text-xs hover:text-slate-900" @click="toggleSort('services')">Servicios{{ sortIndicator('services') }}</button>
            </th>
            <th class="text-left px-4 py-3">
              <button type="button" class="font-semibold uppercase text-xs hover:text-slate-900" @click="toggleSort('status')">Estado{{ sortIndicator('status') }}</button>
            </th>
            <th class="text-right px-4 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="classificationError">
            <td colspan="7" class="px-4 py-6 text-center text-red-600">No se pudo cargar el listado. Recarga para reintentar.</td>
          </tr>
          <tr v-else-if="clientsStore.loading || !classificationReady">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">Cargando...</td>
          </tr>
          <tr v-else-if="!sortedFilteredClients.length">
            <td colspan="7" class="px-4 py-6 text-center text-slate-500">
              {{ searchQuery || statusFilter !== 'all' || serviceFilter !== 'all' ? 'Sin resultados para ese filtro/búsqueda.' : 'No hay clientes en esta sección.' }}
            </td>
          </tr>
          <tr v-for="c in sortedFilteredClients" :key="c.id" class="border-t border-slate-200 hover:bg-slate-50">
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
            <td class="px-4 py-3">
              <span
                v-if="(contractsByClient.get(c.id)?.length ?? 0) >= 2"
                class="badge bg-sky-500/15 text-sky-700 font-semibold"
                title="Cliente con múltiples servicios"
              >
                {{ serviceCountLabel(c.id) }}
              </span>
              <span v-else class="text-slate-600">{{ serviceCountLabel(c.id) }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="badge" :class="clientDisplayStatus(c).cls">
                  {{ clientDisplayStatus(c).label }}
                </span>
                <span
                  v-if="pendingInstallLabel(c)"
                  class="badge bg-amber-500/15 text-amber-700"
                  title="Tiene una orden de Alta pendiente, programada o en curso"
                >
                  📋 {{ pendingInstallLabel(c) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-3 text-right space-x-3 whitespace-nowrap">
              <button v-if="clientSection === 'retired' && canPrepareReincorporation" type="button"
                class="text-sky-700 hover:underline text-xs" @click="prepareReincorporation(c)">Reincorporar</button>
              <router-link
                v-if="latestInstallationFor(c.id)"
                :to="`/soporte/instalaciones/${latestInstallationFor(c.id)!.id}`"
                class="text-slate-600 hover:text-sky-600 text-xs"
                title="Ver orden de Alta"
              >
                📋 Alta
              </router-link>
              <router-link
                v-if="(contractsByClient.get(c.id)?.length ?? 0) === 1"
                :to="`/clientes/${c.id}/servicios/${contractsByClient.get(c.id)![0].id}`"
                class="text-slate-600 hover:text-sky-600 text-xs"
                title="Ver servicio"
              >
                🛠 Servicio
              </router-link>
              <button class="text-slate-600 hover:text-slate-900 text-xs" @click="openEdit(c)">Editar</button>
              <button
                v-if="canManageClients"
                class="text-slate-400 hover:text-red-600 text-xs"
                title="Eliminar cliente"
                @click="handleDelete(c)"
              >
                Eliminar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="rounded-xl border border-slate-200 bg-slate-100 p-5 mb-6">
      <div class="flex flex-wrap items-center justify-between gap-3" :class="showUnlinkedSection ? 'mb-3' : ''">
        <h2 class="text-sm font-semibold">Usuarios PPPoE sin contrato</h2>
        <button
          type="button"
          class="text-xs font-medium text-sky-700 hover:underline"
          @click="showUnlinkedSection = !showUnlinkedSection"
        >
          {{ showUnlinkedSection ? 'Ocultar ▲' : 'Mostrar ▼' }}
        </button>
      </div>
      <template v-if="showUnlinkedSection">
        <select
          v-model="unlinkedDeviceId"
          class="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm mb-3"
        >
          <option value="">Selecciona un router MikroTik</option>
          <option v-for="d in mikrotikStore.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
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
      </template>
    </div>

    <Teleport to="body">
      <div v-if="reincorporatingClient" class="modal-overlay">
        <section role="dialog" aria-modal="true" aria-labelledby="reincorporation-title" class="w-full max-w-lg modal-panel">
          <h2 id="reincorporation-title" class="text-lg font-semibold mb-3">Preparar reincorporación</h2>
          <p class="text-sm mb-3">{{ reincorporatingClient.first_name }} {{ reincorporatingClient.last_name }} · {{ reincorporatingClient.document_number }}</p>
          <p class="text-sm mb-3">Se reutilizará esta ficha y su historial. No crees otro cliente con el mismo documento.</p>
          <p class="text-sm mb-4">La reincorporación operativa está pendiente de un flujo validado para revisar contratos anteriores, deuda, equipos y OLT. Esta acción no modifica estados, crea contratos ni asigna equipos.</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="reincorporatingClient = null">Cerrar</button>
            <router-link class="btn-secondary" :to="`/clientes/${reincorporatingClient.id}`">Consultar ficha e historial</router-link>
          </div>
        </section>
      </div>
      <div v-if="showModal" class="modal-overlay">
        <form
          class="w-full max-w-lg modal-panel max-h-[90vh] overflow-y-auto"
          @submit.prevent="handleSubmit"
        >
          <h2 class="text-lg font-semibold mb-1">{{ editing ? 'Editar cliente' : 'Nuevo cliente' }}</h2>
          <div v-if="convertingProspectId" class="text-xs font-medium text-amber-700 bg-amber-500/10 rounded-lg px-2.5 py-1.5 mb-3">
            <p>
              Convirtiendo el prospecto{{ convertingProspectName ? ` "${convertingProspectName}"` : '' }} en cliente —
              completa el documento, la dirección de instalación y el teléfono alternativo si lo tienes, y guarda
              para terminar. Esto también crea su servicio y la orden de Alta en Soporte. Si cierras sin guardar, no
              queda nada registrado.
            </p>
            <p v-if="convertingPlanId || convertingZoneId" class="font-normal mt-1 text-amber-700/80">
              Se precargará en el servicio:
              <span v-if="convertingPlanId">plan {{ catalogs.plans.find((p) => p.id === convertingPlanId)?.name ?? '—' }}</span>
              <span v-if="convertingPlanId && convertingZoneId">, </span>
              <span v-if="convertingZoneId">zona {{ catalogs.zones.find((z) => z.id === convertingZoneId)?.name ?? '—' }}</span>.
            </p>
          </div>
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
            <p v-if="isRetiredClient(duplicateClient)">Es un cliente retirado. Conserva su ficha e historial; la reincorporación requiere revisar sus servicios antes de operar.</p>
            <p v-else>Un mismo cliente puede tener varias líneas. Reutiliza su ficha para conservar sus relaciones e historial.</p>
            <button
              type="button"
              class="block mt-1 font-medium text-sky-700 hover:text-sky-800 underline"
              @click="showModal = false; router.push(`/clientes/${duplicateClient.id}`)"
            >
              Consultar ficha existente
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
              <label class="block text-xs text-slate-600 mb-1">
                Direccion{{ convertingProspectId ? ' de instalación' : '' }}
              </label>
              <input v-model="form.address" :required="!!convertingProspectId" class="field-input" />
            </div>
          </div>

          <div class="mb-3">
            <label class="block text-xs text-slate-600 mb-1">Estado</label>
            <select v-model="form.status" class="field-input" @change="handleFormStatusChange">
              <option value="prospect">Prospecto</option>
              <option value="active">Activo</option>
              <option value="suspended">Suspendido</option>
              <option v-if="editing" value="retired" :disabled="!canPrepareReincorporation">Baja</option>
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
    <ClientRetirementDialog v-if="retirementClientId" :client-id="retirementClientId" @close="retirementClientId = null" @completed="retirementCompleted" />
  </AppLayout>
</template>
