import { proxmoxRequest } from '../proxmox/client';

// Fase "Servidores" — monitoreo (y control basico) del nodo Proxmox VE que
// aloja las VMs/LXC de infraestructura (panel SmartRayco, DNS, Speedtest,
// IPTV/XUI...). Ver .env.example para PROXMOX_HOST/PORT/TOKEN_ID/SECRET.
//
// Diseno: las VMs/contenedores se leen EN VIVO de Proxmox (nunca se guardan
// en Supabase) — mismo criterio que olt_sync_cache pero sin cache local: acá
// no hay cientos de filas ni Telnet lento, un par de llamadas HTTP alcanzan.

interface ProxmoxNodeApi {
  node: string;
  status: string;
}

export interface NodeStatus {
  node: string;
  /** Host/puerto reales del nodo (para armar el link "Abrir consola" en el frontend — no es un secreto, ya es visible en la LAN). */
  host: string;
  port: number;
  online: boolean;
  cpuPercent: number | null;
  cpuModel: string | null;
  /** Nucleos logicos totales (sockets x cores x threads) — lo que Proxmox llama "cpus". */
  cpuThreads: number | null;
  /** Promedio de carga [1, 5, 15 min], tal cual lo entrega Proxmox (ya viene como texto). */
  loadAvg: [string, string, string] | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  swapUsedBytes: number | null;
  swapTotalBytes: number | null;
  /** Fraccion de tiempo de CPU esperando I/O (disco) — Proxmox lo llama "wait". */
  ioDelayPercent: number | null;
  uptimeSeconds: number | null;
  kernelVersion: string | null;
  pveVersion: string | null;
}

export type VmType = 'qemu' | 'lxc';
export type VmStatus = 'running' | 'stopped' | 'paused';

export interface VmSummary {
  vmid: number;
  type: VmType;
  name: string;
  status: VmStatus;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  /**
   * 'balloon' = memUsedBytes es uso REAL reportado por el sistema operativo
   * de la VM (via el driver de balloon, que necesita el dispositivo de
   * balloon activo Y que el SO lo este reportando). 'hypervisor' = Proxmox
   * NO tiene ese dato (VM sin balloon, o LXC, o el driver no reporta), y
   * memUsedBytes es solo lo que el hypervisor tiene RESERVADO — puede verse
   * "casi lleno" sin que eso signifique que la VM este realmente exigida
   * (ver caso MULTIHUB: 91GB reservados con solo ~16GB de uso real).
   */
  memSource: 'balloon' | 'hypervisor';
  netInBytes: number | null;
  netOutBytes: number | null;
  uptimeSeconds: number | null;
}

export interface ProxmoxSummary {
  node: NodeStatus;
  vms: VmSummary[];
}

let cachedNode: string | null = null;

/**
 * El nombre del nodo Proxmox (ej. "pve") hace falta para casi todos los
 * endpoints (/nodes/{node}/...) pero no es algo que el usuario deba
 * transcribir a mano al .env — la mayoria de instalaciones de este tamaño
 * tienen UN solo nodo, asi que se detecta solo la primera vez (y se cachea
 * en memoria del proceso) contra GET /nodes.
 */
async function resolveNodeName(): Promise<string> {
  if (cachedNode) return cachedNode;
  const nodes = await proxmoxRequest<ProxmoxNodeApi[]>('/nodes');
  if (!nodes?.length) throw new Error('Proxmox no devolvio ningun nodo (GET /nodes vacio)');
  cachedNode = nodes[0].node;
  return cachedNode;
}

interface NodeStatusApi {
  cpu?: number;
  cpuinfo?: { model?: string; cpus?: number };
  loadavg?: [string, string, string];
  memory?: { used?: number; total?: number };
  rootfs?: { used?: number; total?: number };
  swap?: { used?: number; total?: number };
  wait?: number;
  uptime?: number;
  kversion?: string;
  pveversion?: string;
}

const OFFLINE_NODE_STATUS = {
  online: false as const,
  cpuPercent: null,
  cpuModel: null,
  cpuThreads: null,
  loadAvg: null,
  memUsedBytes: null,
  memTotalBytes: null,
  diskUsedBytes: null,
  diskTotalBytes: null,
  swapUsedBytes: null,
  swapTotalBytes: null,
  ioDelayPercent: null,
  uptimeSeconds: null,
  kernelVersion: null,
  pveVersion: null,
};

async function fetchNodeStatus(): Promise<NodeStatus> {
  const node = await resolveNodeName();
  const host = process.env.PROXMOX_HOST ?? '';
  const port = Number(process.env.PROXMOX_PORT ?? 8006);
  try {
    const data = await proxmoxRequest<NodeStatusApi>(`/nodes/${node}/status`);
    return {
      node,
      host,
      port,
      online: true,
      cpuPercent: data.cpu != null ? Math.round(data.cpu * 1000) / 10 : null,
      cpuModel: data.cpuinfo?.model ?? null,
      cpuThreads: data.cpuinfo?.cpus ?? null,
      loadAvg: data.loadavg ?? null,
      memUsedBytes: data.memory?.used ?? null,
      memTotalBytes: data.memory?.total ?? null,
      // "rootfs" es el disco del propio Proxmox (no necesariamente donde
      // viven los discos de las VMs si usas un storage pool aparte) — para
      // un nodo chico de un solo disco es una aproximacion razonable de
      // "almacenamiento local".
      diskUsedBytes: data.rootfs?.used ?? null,
      diskTotalBytes: data.rootfs?.total ?? null,
      swapUsedBytes: data.swap?.used ?? null,
      swapTotalBytes: data.swap?.total ?? null,
      ioDelayPercent: data.wait != null ? Math.round(data.wait * 1000) / 10 : null,
      uptimeSeconds: data.uptime ?? null,
      kernelVersion: data.kversion ?? null,
      pveVersion: data.pveversion ?? null,
    };
  } catch (e) {
    // El nodo puede estar realmente apagado/sin red — no es un error de
    // configuracion, es informacion util ("Sin respuesta") para el panel.
    return { node, host, port, ...OFFLINE_NODE_STATUS };
  }
}

interface VmApi {
  vmid: number;
  name?: string;
  status: string;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  netin?: number;
  netout?: number;
  uptime?: number;
}

function toVmSummary(v: VmApi, type: VmType): VmSummary {
  return {
    vmid: v.vmid,
    type,
    name: v.name ?? `${type}-${v.vmid}`,
    status: (v.status as VmStatus) ?? 'stopped',
    cpuPercent: v.cpu != null ? Math.round(v.cpu * 1000) / 10 : null,
    memUsedBytes: v.mem ?? null,
    memTotalBytes: v.maxmem ?? null,
    memSource: 'hypervisor',
    netInBytes: v.netin ?? null,
    netOutBytes: v.netout ?? null,
    uptimeSeconds: v.uptime ?? null,
  };
}

interface VmStatusCurrentApi {
  // Solo aparece si el dispositivo de balloon esta activo Y el driver
  // dentro del SO lo esta reportando — sin eso, Proxmox no lo manda.
  ballooninfo?: { total_mem?: number; free_mem?: number };
}

/**
 * Intenta enriquecer una VM (solo qemu — LXC no tiene balloon) con el uso
 * REAL de RAM reportado desde adentro del sistema operativo, via el
 * dispositivo de balloon. Si no esta disponible (VM sin balloon, driver sin
 * reportar, o LXC), la deja tal cual vino de la lista /qemu (memSource
 * queda en 'hypervisor', ya seteado por toVmSummary).
 */
async function enrichWithRealMemory(node: string, vm: VmSummary): Promise<VmSummary> {
  if (vm.type !== 'qemu') return vm;
  try {
    const status = await proxmoxRequest<VmStatusCurrentApi>(`/nodes/${node}/qemu/${vm.vmid}/status/current`);
    const bi = status.ballooninfo;
    if (bi?.total_mem && bi.free_mem != null) {
      return { ...vm, memUsedBytes: bi.total_mem - bi.free_mem, memTotalBytes: bi.total_mem, memSource: 'balloon' };
    }
  } catch {
    // Sigue con los datos del hypervisor — no es un error del usuario, solo
    // no hay balloon activo en esta VM.
  }
  return vm;
}

async function fetchVms(): Promise<VmSummary[]> {
  const node = await resolveNodeName();
  const [qemu, lxc] = await Promise.all([
    proxmoxRequest<VmApi[]>(`/nodes/${node}/qemu`).catch(() => []),
    proxmoxRequest<VmApi[]>(`/nodes/${node}/lxc`).catch(() => []),
  ]);
  const base = [
    ...(qemu ?? []).map((v) => toVmSummary(v, 'qemu')),
    ...(lxc ?? []).map((v) => toVmSummary(v, 'lxc')),
  ];
  // Solo se pide el detalle extra para VMs qemu que esten corriendo (una
  // apagada no tiene nada que reportar) — pocas VMs en este tipo de
  // instalacion, asi que una llamada extra por VM no pesa.
  const enriched = await Promise.all(
    base.map((vm) => (vm.type === 'qemu' && vm.status === 'running' ? enrichWithRealMemory(node, vm) : Promise.resolve(vm))),
  );
  return enriched.sort((a, b) => a.vmid - b.vmid);
}

export async function getProxmoxSummary(): Promise<ProxmoxSummary> {
  const node = await fetchNodeStatus();
  const vms = node.online ? await fetchVms() : [];
  return { node, vms };
}

export interface NodeRrdPoint {
  /** Unix seconds, tal cual lo entrega Proxmox. */
  time: number;
  cpuPercent: number | null;
  ioDelayPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
}

interface NodeRrdApi {
  time: number;
  cpu?: number;
  iowait?: number;
  memused?: number;
  memtotal?: number;
}

/**
 * Historial REAL del nodo (no datos inventados) — Proxmox guarda RRD propio
 * por nodo. "hour" trae ~1 punto por minuto de la ultima hora, resolucion
 * suficiente para una grafica que se ve "viva" sin pedirle al usuario que
 * espere horas para ver una curva.
 */
export async function getNodeRrdData(timeframe: 'hour' | 'day' = 'hour'): Promise<NodeRrdPoint[]> {
  const node = await resolveNodeName();
  const raw = await proxmoxRequest<NodeRrdApi[]>(`/nodes/${node}/rrddata?timeframe=${timeframe}`);
  return (raw ?? [])
    .filter((r) => r.time != null)
    .map((r) => ({
      time: r.time,
      cpuPercent: r.cpu != null ? Math.round(r.cpu * 1000) / 10 : null,
      ioDelayPercent: r.iowait != null ? Math.round(r.iowait * 1000) / 10 : null,
      memUsedBytes: r.memused ?? null,
      memTotalBytes: r.memtotal ?? null,
    }));
}

const VM_ACTIONS = ['start', 'shutdown', 'reboot'] as const;
export type VmAction = (typeof VM_ACTIONS)[number];

export function isValidVmAction(action: string): action is VmAction {
  return (VM_ACTIONS as readonly string[]).includes(action);
}

/**
 * "shutdown" (apagado ordenado via ACPI, como apretar el boton de un PC
 * real) en vez de "stop" (corte duro, como desenchufarlo) — para servicios
 * reales (DNS, el propio panel, IPTV) un corte duro puede corromper datos a
 * medio escribir. Por eso esta version solo expone las 3 acciones "seguras"
 * del pedido original (Iniciar/Reiniciar/Apagar), no un apagado forzado.
 */
export async function runVmAction(type: VmType, vmid: number, action: VmAction): Promise<void> {
  const node = await resolveNodeName();
  await proxmoxRequest(`/nodes/${node}/${type}/${vmid}/status/${action}`, { method: 'POST' });
}
