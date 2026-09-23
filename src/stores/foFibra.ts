import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { FoCable, FoFusion, FoHiloEstado, FoNapPuerto, FoFusionDestinoTipo, FoHiloEstadoTipo } from '@/types/domain';

export interface TraceHop {
  cable: FoCable;
  hiloIndex: number;
  boxId: string | null; // caja/mufa donde arranca este tramo (null = OLT)
  toBoxId: string | null;
  toBoxTipo: 'olt' | 'infra' | null;
}

export interface TraceResult {
  hops: TraceHop[];
  reachedOlt: boolean;
  oltId?: string;
  error?: string;
}

interface NodoExtremo {
  tipo: 'olt' | 'infra';
  id: string;
}

function cableExtremos(cable: FoCable): { origen: NodoExtremo | null; destino: NodoExtremo | null } {
  const origen: NodoExtremo | null = cable.origen_olt_id
    ? { tipo: 'olt', id: cable.origen_olt_id }
    : cable.origen_infra_id
      ? { tipo: 'infra', id: cable.origen_infra_id }
      : null;
  const destino: NodoExtremo | null = cable.destino_olt_id
    ? { tipo: 'olt', id: cable.destino_olt_id }
    : cable.destino_infra_id
      ? { tipo: 'infra', id: cable.destino_infra_id }
      : null;
  return { origen, destino };
}

/** Dado un extremo (caja) conocido de un cable, devuelve el otro extremo. */
function otroExtremo(cable: FoCable, boxId: string): NodoExtremo | null {
  const { origen, destino } = cableExtremos(cable);
  if (origen?.id === boxId) return destino;
  if (destino?.id === boxId) return origen;
  return null;
}

export const useFoFibraStore = defineStore('foFibra', () => {
  const cables = ref<FoCable[]>([]);
  const fusiones = ref<FoFusion[]>([]);
  const hiloEstadosPorCable = ref<Record<string, FoHiloEstado[]>>({});
  const napPuertosPorElemento = ref<Record<string, FoNapPuerto[]>>({});
  const loading = ref(false);

  async function fetchCables() {
    loading.value = true;
    try {
      const { data, error } = await supabase.from('fo_cables').select('*').order('codigo');
      if (error) throw error;
      cables.value = (data ?? []) as FoCable[];
    } finally {
      loading.value = false;
    }
  }

  /** Carga todas las fusiones (el dataset es pequeño; se usa para trazabilidad completa). */
  async function fetchFusiones() {
    const { data, error } = await supabase.from('fo_fusiones').select('*');
    if (error) throw error;
    fusiones.value = (data ?? []) as FoFusion[];
  }

  async function createCable(payload: {
    codigo: string;
    tipo: 'troncal' | 'ramal';
    hilos_total: number;
    metraje: number | null;
    path: [number, number][];
    origen_olt_id?: string | null;
    origen_infra_id?: string | null;
    destino_olt_id?: string | null;
    destino_infra_id?: string | null;
    notes?: string | null;
  }) {
    const { data, error } = await supabase.from('fo_cables').insert(payload).select().single();
    if (error) throw error;
    const cable = data as FoCable;
    cables.value.push(cable);
    return cable;
  }

  async function updateCable(id: string, payload: Partial<FoCable>) {
    const { data, error } = await supabase.from('fo_cables').update(payload).eq('id', id).select().single();
    if (error) throw error;
    const cable = data as FoCable;
    const idx = cables.value.findIndex((c) => c.id === id);
    if (idx !== -1) cables.value[idx] = cable;
    return cable;
  }

  async function deleteCable(id: string) {
    const { error } = await supabase.from('fo_cables').delete().eq('id', id);
    if (error) throw error;
    cables.value = cables.value.filter((c) => c.id !== id);
  }

  async function fetchHiloEstados(cableId: string) {
    const { data, error } = await supabase.from('fo_hilo_estados').select('*').eq('cable_id', cableId);
    if (error) throw error;
    hiloEstadosPorCable.value[cableId] = (data ?? []) as FoHiloEstado[];
    return hiloEstadosPorCable.value[cableId];
  }

  async function setHiloEstado(cableId: string, hiloIndex: number, estado: FoHiloEstadoTipo, notes?: string | null) {
    const { data, error } = await supabase
      .from('fo_hilo_estados')
      .upsert({ cable_id: cableId, hilo_index: hiloIndex, estado, notes: notes ?? null }, { onConflict: 'cable_id,hilo_index' })
      .select()
      .single();
    if (error) throw error;
    const list = hiloEstadosPorCable.value[cableId] ?? [];
    const idx = list.findIndex((h) => h.hilo_index === hiloIndex);
    if (idx !== -1) list[idx] = data as FoHiloEstado;
    else list.push(data as FoHiloEstado);
    hiloEstadosPorCable.value[cableId] = list;
  }

  async function fetchFusionesDeElemento(infraElementoId: string) {
    const { data, error } = await supabase.from('fo_fusiones').select('*').eq('infra_elemento_id', infraElementoId);
    if (error) throw error;
    return (data ?? []) as FoFusion[];
  }

  async function createFusion(payload: {
    infra_elemento_id: string;
    cable_a_id: string;
    hilo_a_index: number;
    destino_tipo: FoFusionDestinoTipo;
    cable_b_id?: string | null;
    hilo_b_index?: number | null;
    puerto_nap?: number | null;
    notes?: string | null;
  }) {
    const { data, error } = await supabase.from('fo_fusiones').insert(payload).select().single();
    if (error) throw error;
    const fusion = data as FoFusion;
    fusiones.value.push(fusion);
    return fusion;
  }

  async function deleteFusion(id: string) {
    const { error } = await supabase.from('fo_fusiones').delete().eq('id', id);
    if (error) throw error;
    fusiones.value = fusiones.value.filter((f) => f.id !== id);
  }

  /** Carga la ocupación de puertos de TODAS las cajas NAP de una vez (resumen para el mapa de clientes). */
  async function fetchTodosNapPuertos() {
    const { data, error } = await supabase.from('fo_nap_puertos').select('*, clients(id, first_name, last_name)').order('puerto_numero');
    if (error) throw error;
    const porElemento: Record<string, FoNapPuerto[]> = {};
    for (const row of (data ?? []) as FoNapPuerto[]) {
      (porElemento[row.infra_elemento_id] ??= []).push(row);
    }
    napPuertosPorElemento.value = porElemento;
  }

  async function fetchNapPuertos(infraElementoId: string) {
    const { data, error } = await supabase
      .from('fo_nap_puertos')
      .select('*, clients(id, first_name, last_name)')
      .eq('infra_elemento_id', infraElementoId)
      .order('puerto_numero');
    if (error) throw error;
    napPuertosPorElemento.value[infraElementoId] = (data ?? []) as FoNapPuerto[];
    return napPuertosPorElemento.value[infraElementoId];
  }

  async function upsertNapPuerto(payload: {
    infra_elemento_id: string;
    puerto_numero: number;
    estado: FoNapPuerto['estado'];
    client_id?: string | null;
    fusion_id?: string | null;
    notes?: string | null;
  }) {
    const { data, error } = await supabase
      .from('fo_nap_puertos')
      .upsert(payload, { onConflict: 'infra_elemento_id,puerto_numero' })
      .select('*, clients(id, first_name, last_name)')
      .single();
    if (error) throw error;
    const list = napPuertosPorElemento.value[payload.infra_elemento_id] ?? [];
    const idx = list.findIndex((p) => p.puerto_numero === payload.puerto_numero);
    if (idx !== -1) list[idx] = data as FoNapPuerto;
    else list.push(data as FoNapPuerto);
    napPuertosPorElemento.value[payload.infra_elemento_id] = list.sort((a, b) => a.puerto_numero - b.puerto_numero);
    return data as FoNapPuerto;
  }

  /** Libera cualquier puerto NAP que tenga asignado este cliente (lo deja 'libre'). */
  async function unassignClient(clientId: string) {
    const { data, error } = await supabase
      .from('fo_nap_puertos')
      .update({ estado: 'libre', client_id: null })
      .eq('client_id', clientId)
      .select('*, clients(id, first_name, last_name)');
    if (error) throw error;
    for (const row of (data ?? []) as FoNapPuerto[]) {
      const list = napPuertosPorElemento.value[row.infra_elemento_id] ?? [];
      const idx = list.findIndex((p) => p.id === row.id);
      if (idx !== -1) list[idx] = row;
    }
  }

  /**
   * Asigna un cliente a una caja NAP desde la ficha de cliente (fuera del
   * diagrama de empalmes): libera cualquier puerto que ya tuviera en otra
   * NAP, reutiliza el primer puerto 'libre' de la NAP destino, o crea uno
   * nuevo si hay cupo (bajo `capacity`, ver NAP_CLIENT_LIMIT).
   */
  async function assignClientToNap(infraElementoId: string, clientId: string, capacity: number) {
    await unassignClient(clientId);

    const puertos = napPuertosPorElemento.value[infraElementoId] ?? (await fetchNapPuertos(infraElementoId));
    const libre = puertos.find((p) => p.estado === 'libre');
    if (libre) {
      return upsertNapPuerto({ infra_elemento_id: infraElementoId, puerto_numero: libre.puerto_numero, estado: 'ocupado', client_id: clientId });
    }

    if (puertos.length >= capacity) {
      throw new Error(`La caja NAP ya alcanzó su capacidad máxima (${capacity} clientes). Libera un puerto antes de asignar este cliente.`);
    }
    const nextPuerto = puertos.reduce((max, p) => Math.max(max, p.puerto_numero), 0) + 1;
    return upsertNapPuerto({ infra_elemento_id: infraElementoId, puerto_numero: nextPuerto, estado: 'ocupado', client_id: clientId });
  }

  /**
   * Trazabilidad óptica: partiendo de un puerto de cliente en una caja NAP,
   * recorre fusión por fusión hacia atrás (aguas arriba) hasta llegar a una
   * OLT o hasta un tramo sin continuidad definida. Requiere cables y
   * fusiones ya cargados (fetchCables + fetchFusiones).
   */
  function traceFromNapPuerto(puerto: Pick<FoNapPuerto, 'fusion_id'>): TraceResult {
    const fusion = fusiones.value.find((f) => f.id === puerto.fusion_id);
    if (!fusion) return { hops: [], reachedOlt: false, error: 'Este puerto no tiene una fusión asignada.' };
    return traceUpstream(fusion.cable_a_id, fusion.hilo_a_index, fusion.infra_elemento_id);
  }

  function traceUpstream(startCableId: string, startHilo: number, startBoxId: string): TraceResult {
    const hops: TraceHop[] = [];
    let curCableId = startCableId;
    let curHilo = startHilo;
    let curBoxId: string | null = startBoxId;
    const visited = new Set<string>();

    for (let i = 0; i < 200; i++) {
      const cable = cables.value.find((c) => c.id === curCableId);
      if (!cable) return { hops, reachedOlt: false, error: 'Cable no encontrado en el dataset cargado.' };
      const other: NodoExtremo | null = curBoxId ? otroExtremo(cable, curBoxId) : null;
      hops.push({ cable, hiloIndex: curHilo, boxId: curBoxId, toBoxId: other?.id ?? null, toBoxTipo: other?.tipo ?? null });

      if (!other) return { hops, reachedOlt: false, error: `El cable "${cable.codigo}" no tiene definido su otro extremo.` };
      if (other.tipo === 'olt') return { hops, reachedOlt: true, oltId: other.id };

      const visitKey = `${curCableId}:${curHilo}:${other.id}`;
      if (visited.has(visitKey)) return { hops, reachedOlt: false, error: 'Se detectó un bucle en las fusiones.' };
      visited.add(visitKey);

      const fusion = fusiones.value.find(
        (f) =>
          f.infra_elemento_id === other.id &&
          ((f.cable_a_id === curCableId && f.hilo_a_index === curHilo) || (f.cable_b_id === curCableId && f.hilo_b_index === curHilo)),
      );
      if (!fusion) return { hops, reachedOlt: false, error: `Sin fusión registrada en esa caja para este hilo (pendiente de empalmar).` };

      if (fusion.cable_a_id === curCableId && fusion.hilo_a_index === curHilo) {
        if (!fusion.cable_b_id || fusion.hilo_b_index == null) {
          return { hops, reachedOlt: false, error: 'El hilo termina aquí (fusión sin continuidad / terminado).' };
        }
        curCableId = fusion.cable_b_id;
        curHilo = fusion.hilo_b_index;
      } else {
        curCableId = fusion.cable_a_id;
        curHilo = fusion.hilo_a_index;
      }
      curBoxId = other.id;
    }
    return { hops, reachedOlt: false, error: 'Límite de saltos alcanzado (posible dato inconsistente).' };
  }

  return {
    cables,
    fusiones,
    hiloEstadosPorCable,
    napPuertosPorElemento,
    loading,
    fetchCables,
    fetchFusiones,
    createCable,
    updateCable,
    deleteCable,
    fetchHiloEstados,
    setHiloEstado,
    fetchFusionesDeElemento,
    createFusion,
    deleteFusion,
    fetchTodosNapPuertos,
    fetchNapPuertos,
    upsertNapPuerto,
    unassignClient,
    assignClientToNap,
    traceFromNapPuerto,
  };
});
