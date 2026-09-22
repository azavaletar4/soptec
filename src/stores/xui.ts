import { defineStore } from 'pinia';
import { ref } from 'vue';
import { apiFetch } from '@/lib/api';

export interface XuiLineSummary {
  id: number;
  username: string;
  password: string;
  owner: string;
  status: string | null;
  maxConnections: string;
  expiration: string | null;
  lastConnection: string | null;
}

export interface XuiLineDetail {
  id?: number;
  username: string;
  password: string;
  exp_date: string;
  max_connections: string;
  contact: string;
  no_expire: boolean;
  bouquets_selected: string;
}

export interface XuiBouquet {
  id: number;
  name: string;
  streamCount: number;
}

export interface XuiLineOverrides {
  username?: string;
  password?: string;
  expDate?: string;
  noExpire?: boolean;
  maxConnections?: string;
  contact?: string;
  bouquetIds?: number[];
}

export type XuiLineAction = 'enable' | 'disable' | 'ban' | 'unban' | 'kill' | 'delete';

export const useXuiStore = defineStore('xui', () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function listBouquets() {
    const { bouquets } = await apiFetch<{ bouquets: XuiBouquet[] }>('/api/xui/bouquets');
    return bouquets;
  }

  async function searchLines(search: string) {
    const { lines } = await apiFetch<{ lines: XuiLineSummary[] }>(`/api/xui/lines?search=${encodeURIComponent(search)}`);
    return lines;
  }

  async function getLine(id: number) {
    const { line } = await apiFetch<{ line: XuiLineDetail }>(`/api/xui/lines/${id}`);
    return line;
  }

  async function createLine(payload: XuiLineOverrides) {
    return apiFetch<{ id: number | null; status: string }>('/api/xui/lines', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function updateLine(id: number, payload: XuiLineOverrides) {
    return apiFetch<{ id: number | null; status: string }>(`/api/xui/lines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function lineAction(id: number, action: XuiLineAction) {
    return apiFetch<{ ok: true }>(`/api/xui/lines/${id}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  }

  return { loading, error, listBouquets, searchLines, getLine, createLine, updateLine, lineAction };
});
