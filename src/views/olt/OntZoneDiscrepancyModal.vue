<script setup lang="ts">
/**
 * Fase 3 comercial OLT — Fase B (ver ESTADO_DESARROLLO.md 13al,
 * src/lib/ontZoneDiscrepancy.ts). Detalle ONT por ONT de un puerto PON:
 * cliente/contrato (solo si estan realmente vinculados, nunca inferidos
 * del nombre de la OLT), serial, posicion fisica, y las 3 zonas
 * relevantes (oficial del catalogo / registrada en la ONT / registrada
 * en el contrato) para que un administrador decida que corregir.
 *
 * Solo lectura: ningun boton de este modal escribe nada, solo navega al
 * detalle ya existente de la ONT o del cliente/contrato.
 */
import type { OntZoneDiscrepancy } from '@/lib/ontZoneDiscrepancy';

const props = defineProps<{
  portLabel: string;
  rows: OntZoneDiscrepancy[];
}>();

const emit = defineEmits<{
  close: [];
  'view-ont': [ontDbId: string];
}>();

const CASE_LABEL: Record<OntZoneDiscrepancy['caseStatus'], string> = {
  match: '✅ Coincide',
  zone_mismatch: '⚠ Zona distinta',
  unlinked: '⬜ Sin vincular',
  no_official: '❔ Sin zona oficial en el catálogo',
  ambiguous_catalog: '⚠ Catálogo ambiguo',
};

const CASE_CLASS: Record<OntZoneDiscrepancy['caseStatus'], string> = {
  match: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  zone_mismatch: 'text-red-700 bg-red-50 border-red-200',
  unlinked: 'text-slate-600 bg-slate-100 border-slate-200',
  no_official: 'text-slate-500 bg-slate-100 border-slate-200',
  ambiguous_catalog: 'text-red-700 bg-red-50 border-red-200',
};

function reason(r: OntZoneDiscrepancy): string {
  switch (r.caseStatus) {
    case 'match':
      return 'Sin inconsistencia detectada.';
    case 'unlinked':
      return 'ONT sin cliente y/o contrato vinculado en SmartRayco (posible pendiente de migración) — no se muestra cliente/contrato porque no hay vínculo verificable.';
    case 'no_official':
      return 'El número de PON de este puerto no tiene ninguna zona declarada en el catálogo (nombre "PON N - ...").';
    case 'ambiguous_catalog':
      return `El catálogo tiene ${r.ambiguousCandidates?.length ?? 0} zonas que declaran el mismo número de PON: revisar nombres en Catálogos > Zonas.`;
    case 'zone_mismatch': {
      const parts: string[] = [];
      if (r.ontVsOfficial === 'mismatch') parts.push('la zona de la ONT no coincide con la oficial del PON');
      if (r.contractVsOfficial === 'mismatch') parts.push('la zona del contrato no coincide con la oficial del PON');
      if (r.ontVsOfficial === 'match' && r.contractVsOfficial === 'mismatch') parts.push('(la zona de la ONT sí coincide)');
      if (r.contractVsOfficial === 'match' && r.ontVsOfficial === 'mismatch') parts.push('(la zona del contrato sí coincide)');
      return parts.join('; ') + '.';
    }
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[85vh] overflow-y-auto p-5">
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-sm font-semibold">ONTs de {{ props.portLabel }} — detalle PON↔zona↔contrato</h3>
        <button class="text-slate-400 hover:text-slate-600 text-lg leading-none" @click="emit('close')">✕</button>
      </div>
      <p class="text-xs text-slate-500 mb-3">
        Solo lectura — compara, no corrige. Ante una discrepancia se conservan los datos actuales; usa
        "Ver ONT"/"Ver cliente" para revisar y decidir manualmente.
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200">
              <th class="py-1.5 pr-2">Estado</th>
              <th class="py-1.5 pr-2">Cliente</th>
              <th class="py-1.5 pr-2">Código / contrato</th>
              <th class="py-1.5 pr-2">Serial</th>
              <th class="py-1.5 pr-2">Posición</th>
              <th class="py-1.5 pr-2">Zona oficial</th>
              <th class="py-1.5 pr-2">Zona de la ONT</th>
              <th class="py-1.5 pr-2">Zona del contrato</th>
              <th class="py-1.5 pr-2">Motivo</th>
              <th class="py-1.5 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in props.rows" :key="r.ontDbId" class="border-b border-slate-100 align-top">
              <td class="py-1.5 pr-2">
                <span :class="['inline-block px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap', CASE_CLASS[r.caseStatus]]">
                  {{ CASE_LABEL[r.caseStatus] }}
                </span>
              </td>
              <td class="py-1.5 pr-2">
                <router-link
                  v-if="r.client && r.contract"
                  :to="`/clientes/${r.client.id}/servicios/${r.contract.id}`"
                  class="text-sky-600 hover:underline"
                >
                  {{ r.client.name }}
                </router-link>
                <router-link v-else-if="r.client" :to="`/clientes/${r.client.id}`" class="text-sky-600 hover:underline">
                  {{ r.client.name }}
                </router-link>
                <span v-else class="text-slate-400">— sin vincular —</span>
              </td>
              <td class="py-1.5 pr-2 text-slate-600">
                <span v-if="r.contract">{{ r.contract.clientCode ?? '—' }} / {{ r.contract.contractNumber ?? '—' }}</span>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="py-1.5 pr-2 font-mono text-slate-700">{{ r.serial }}</td>
              <td class="py-1.5 pr-2 text-slate-500 whitespace-nowrap">S{{ r.slot }}/P{{ r.port }} · ONU {{ r.ontId }}</td>
              <td class="py-1.5 pr-2">{{ r.officialZone?.name ?? '—' }}</td>
              <td class="py-1.5 pr-2" :class="r.ontVsOfficial === 'mismatch' ? 'text-red-600 font-medium' : ''">
                {{ r.ontZone?.name ?? '—' }}
              </td>
              <td class="py-1.5 pr-2" :class="r.contractVsOfficial === 'mismatch' ? 'text-red-600 font-medium' : ''">
                {{ r.contractZone?.name ?? '—' }}
              </td>
              <td class="py-1.5 pr-2 text-slate-500 max-w-xs">{{ reason(r) }}</td>
              <td class="py-1.5 pr-2 whitespace-nowrap">
                <button class="text-sky-600 hover:underline" @click="emit('view-ont', r.ontDbId)">Ver ONT</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
