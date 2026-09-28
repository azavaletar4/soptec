import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export type VmType = 'qemu' | 'lxc';
export type VmStatus = 'running' | 'stopped' | 'paused';
export type VmAction = 'start' | 'shutdown' | 'reboot';

export interface NodeStatus {
  node: string;
  host: string;
  port: number;
  online: boolean;
  cpuPercent: number | null;
  cpuModel: string | null;
  cpuThreads: number | null;
  loadAvg: [string, string, string] | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  swapUsedBytes: number | null;
  swapTotalBytes: number | null;
  ioDelayPercent: number | null;
  uptimeSeconds: number | null;
  kernelVersion: string | null;
  pveVersion: string | null;
}

export interface VmSummary {
  vmid: number;
  type: VmType;
  name: string;
  status: VmStatus;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  memSource: 'balloon' | 'hypervisor';
  netInBytes: number | null;
  netOutBytes: number | null;
  uptimeSeconds: number | null;
}

export interface ProxmoxSummary {
  node: NodeStatus;
  vms: VmSummary[];
}

export interface NodeRrdPoint {
  time: number;
  cpuPercent: number | null;
  ioDelayPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
}

export const useProxmoxStore = defineStore('proxmox', () => {
  const summary = ref<ProxmoxSummary | null>(null);
  const rrdData = ref<NodeRrdPoint[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchSummary() {
    loading.value = true;
    error.value = null;
    try {
      summary.value = await apiFetch<ProxmoxSummary>('/api/proxmox/summary');
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Error al consultar Proxmox';
      throw e;
    } finally {
      loading.value = false;
    }
  }

  // Historico real (no simulado) para las graficas — se pide aparte porque
  // no hace falta refrescarlo tan seguido como el resumen en vivo.
  async function fetchRrdData() {
    try {
      rrdData.value = await apiFetch<NodeRrdPoint[]>('/api/proxmox/rrddata?timeframe=hour');
    } catch {
      // Si falla, las graficas simplemente quedan vacias — no es motivo
      // para tapar el resto del dashboard con un error.
      rrdData.value = [];
    }
  }

  async function runAction(type: VmType, vmid: number, action: VmAction) {
    await apiFetch(`/api/proxmox/vms/${type}/${vmid}/${action}`, { method: 'POST' });
  }

  return { summary, rrdData, loading, error, fetchSummary, fetchRrdData, runAction };
});
