export const PPPOE_DASHBOARD_PROFILES = [
  { label: 'Dedicado', profile: 'Profile_Dedicado' },
  { label: 'Balanceador', profile: 'Profile_Balanceador' },
  { label: 'WAN 4', profile: 'Profile_Gamer_04' },
  { label: 'WAN 5', profile: 'Profile_Gamer_05' },
] as const;

export interface PppoeProfileCount {
  label: string;
  profile: string;
  registered: number | null;
  connected: number | null;
}
export interface PppoeProfileResult {
  status: 'fresh' | 'stale' | 'unavailable';
  lastSuccessAt: string | null;
  profiles: PppoeProfileCount[];
  partial: boolean;
  message: string | null;
}

export function formatPppoeReading(iso: string | null): string {
  return iso ? new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23' }).format(new Date(iso)) : 'Sin lectura exitosa';
}
