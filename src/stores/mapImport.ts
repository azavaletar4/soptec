import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { supabase } from '@/lib/supabase';
import { parseKmz } from '@/lib/kml/parseKmz';
import { classifyCable, classifyPointTipo } from '@/lib/kml/classify';
import {
  haversineMeters,
  matchPoint,
  nearestEndpoint,
  suggestZoneMatch,
  type EndpointCandidate,
  type ExistingPointLite,
  type PointMatchResult,
  type ZoneMatchSuggestion,
} from '@/lib/kml/match';
import type { ParsedKml, ParsedLine, ParsedPoint } from '@/lib/kml/types';
import type { FoCableTipo, FoHilosTotal, InfraElementoTipo } from '@/types/domain';
import { useCatalogsStore } from './catalogs';
import { useInfraElementosStore } from './infraElementos';
import { useFoFibraStore } from './foFibra';
import { useOltStore } from './olt';

const NEW_ZONE = '__new__';

export interface PreviewPoint {
  point: ParsedPoint;
  tipo: InfraElementoTipo;
  kmlRef: string;
  match: PointMatchResult;
}

export interface PreviewLine {
  line: ParsedLine;
  tipo: FoCableTipo;
  hilosTotal: FoHilosTotal;
  hilosGuessed: boolean;
  kmlRef: string;
  metraje: number;
  origenHint: { label: string; distanceMeters: number } | null;
  destinoHint: { label: string; distanceMeters: number } | null;
}

export interface PreviewFolder {
  name: string;
  zoneChoice: string; // '' = sin zona, NEW_ZONE = crear zona nueva, o id de zona existente
  zoneSuggestion: ZoneMatchSuggestion | null;
  include: boolean;
  points: PreviewPoint[];
  lines: PreviewLine[];
  polygonsCount: number;
  counts: { create: number; update: number; conflict: number; lines: number };
}

export interface ImportResult {
  batchId: string;
  created: number;
  updated: number;
  skipped: number;
  cablesCreated: number;
  errors: { ref: string; message: string }[];
}

function pathMetraje(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversineMeters(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return Math.round(total);
}

export const useMapImportStore = defineStore('mapImport', () => {
  const parsed = ref<ParsedKml | null>(null);
  const folderZoneChoice = ref<Record<string, string>>({});
  const folderInclude = ref<Record<string, boolean>>({});
  const parsing = ref(false);
  const parseError = ref<string | null>(null);
  const committing = ref(false);
  const lastResult = ref<ImportResult | null>(null);

  async function loadFile(file: File) {
    parsing.value = true;
    parseError.value = null;
    lastResult.value = null;
    try {
      const catalogs = useCatalogsStore();
      await catalogs.fetchZones();

      const result = await parseKmz(file);
      parsed.value = result;

      folderZoneChoice.value = {};
      folderInclude.value = {};
      for (const folder of result.folders) {
        const suggestion = suggestZoneMatch(folder.name, catalogs.zones);
        folderZoneChoice.value[folder.name] = suggestion && suggestion.score >= 70 ? suggestion.zoneId : '';
        folderInclude.value[folder.name] = true;
      }
    } catch (e) {
      parseError.value = e instanceof Error ? e.message : 'No se pudo leer el archivo';
      parsed.value = null;
    } finally {
      parsing.value = false;
    }
  }

  function reset() {
    parsed.value = null;
    folderZoneChoice.value = {};
    folderInclude.value = {};
    lastResult.value = null;
    parseError.value = null;
  }

  const preview = computed<PreviewFolder[]>(() => {
    if (!parsed.value) return [];
    const catalogs = useCatalogsStore();
    const infra = useInfraElementosStore();
    const olt = useOltStore();

    const existingCandidates: (EndpointCandidate & { name: string })[] = [
      ...infra.elementos
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => ({ kind: 'infra' as const, id: e.id, lat: e.latitude as number, lng: e.longitude as number, name: e.name })),
      ...olt.devices
        .filter((d) => d.lat != null && d.lng != null)
        .map((d) => ({ kind: 'olt' as const, id: d.id, lat: d.lat as number, lng: d.lng as number, name: d.name })),
    ];
    const nameById = new Map(existingCandidates.map((c) => [`${c.kind}:${c.id}`, c.name]));

    const existingPoints: ExistingPointLite[] = infra.elementos
      .filter((e) => e.latitude != null && e.longitude != null)
      .map((e) => ({ id: e.id, name: e.name, tipo: e.tipo, lat: e.latitude as number, lng: e.longitude as number, zoneId: e.zone_id, kmlRef: e.kml_ref }));

    return parsed.value.folders.map((folder) => {
      const zoneChoice = folderZoneChoice.value[folder.name] ?? '';
      const resolvedZoneId = zoneChoice === NEW_ZONE || zoneChoice === '' ? null : zoneChoice;

      const points: PreviewPoint[] = folder.points.map((point) => {
        const tipo = classifyPointTipo(point.name);
        const kmlRef = `${folder.name} / ${point.name}`;
        const match = matchPoint(point, tipo, kmlRef, resolvedZoneId, existingPoints);
        return { point, tipo, kmlRef, match };
      });

      const lines: PreviewLine[] = folder.lines.map((line) => {
        const { tipo, hilos_total, guessed } = classifyCable(line.name);
        const kmlRef = `${folder.name} / ${line.name} / ${line.path[0].join(',')}`;
        const start = line.path[0];
        const end = line.path[line.path.length - 1];
        const originMatch = nearestEndpoint(start[0], start[1], existingCandidates);
        const destMatch = nearestEndpoint(end[0], end[1], existingCandidates);
        return {
          line,
          tipo,
          hilosTotal: hilos_total,
          hilosGuessed: guessed,
          kmlRef,
          metraje: pathMetraje(line.path),
          origenHint: originMatch
            ? { label: nameById.get(`${originMatch.kind}:${originMatch.id}`) ?? '?', distanceMeters: originMatch.distanceMeters }
            : null,
          destinoHint: destMatch
            ? { label: nameById.get(`${destMatch.kind}:${destMatch.id}`) ?? '?', distanceMeters: destMatch.distanceMeters }
            : null,
        };
      });

      const counts = {
        create: points.filter((p) => p.match.action === 'create').length,
        update: points.filter((p) => p.match.action === 'update').length,
        conflict: points.filter((p) => p.match.action === 'conflict').length,
        lines: lines.length,
      };

      return {
        name: folder.name,
        zoneChoice,
        zoneSuggestion: suggestZoneMatch(folder.name, catalogs.zones),
        include: folderInclude.value[folder.name] ?? true,
        points,
        lines,
        polygonsCount: folder.polygonsCount,
        counts,
      };
    });
  });

  const totals = computed(() =>
    preview.value.reduce(
      (acc, f) => {
        if (!f.include) return acc;
        acc.create += f.counts.create;
        acc.update += f.counts.update;
        acc.conflict += f.counts.conflict;
        acc.lines += f.counts.lines;
        return acc;
      },
      { create: 0, update: 0, conflict: 0, lines: 0 },
    ),
  );

  async function commit(): Promise<ImportResult> {
    if (!parsed.value) throw new Error('No hay ningún archivo cargado');
    committing.value = true;
    try {
      const catalogs = useCatalogsStore();
      const infra = useInfraElementosStore();
      const fibra = useFoFibraStore();
      const olt = useOltStore();

      const { data: batchRow, error: batchErr } = await supabase
        .from('map_imports')
        .insert({ source_filename: parsed.value.sourceFilename })
        .select()
        .single();
      if (batchErr) throw batchErr;
      const batchId = (batchRow as { id: string }).id;

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let cablesCreated = 0;
      const errors: { ref: string; message: string }[] = [];

      // Resuelve zonas "crear nueva" primero (una sola vez por carpeta).
      const resolvedZoneByFolder = new Map<string, string | null>();
      for (const folder of preview.value) {
        if (!folder.include) continue;
        if (folder.zoneChoice === NEW_ZONE) {
          try {
            const zone = await catalogs.createZone(folder.name);
            resolvedZoneByFolder.set(folder.name, zone.id);
          } catch (e) {
            errors.push({ ref: folder.name, message: `No se pudo crear la zona: ${e instanceof Error ? e.message : 'error'}` });
            resolvedZoneByFolder.set(folder.name, null);
          }
        } else {
          resolvedZoneByFolder.set(folder.name, folder.zoneChoice || null);
        }
      }

      // 1) Puntos (NAP/MUFA/etc) de todas las carpetas incluidas, primero —
      // asi los cables (paso 2) pueden enlazar cajas recien creadas en esta
      // misma importacion, ya con id real.
      for (const folder of preview.value) {
        if (!folder.include) continue;
        const zoneId = resolvedZoneByFolder.get(folder.name) ?? null;
        for (const pp of folder.points) {
          if (pp.match.action === 'conflict') {
            skipped++;
            errors.push({ ref: pp.kmlRef, message: pp.match.reason ?? 'conflicto sin resolver' });
            continue;
          }
          try {
            if (pp.match.action === 'update' && pp.match.matchId) {
              await infra.updateElemento(pp.match.matchId, {
                latitude: pp.point.lat,
                longitude: pp.point.lng,
                kml_ref: pp.kmlRef,
              });
              updated++;
            } else {
              await infra.createElemento({
                name: pp.point.name,
                tipo: pp.tipo,
                latitude: pp.point.lat,
                longitude: pp.point.lng,
                zone_id: zoneId,
                kml_ref: pp.kmlRef,
                import_batch_id: batchId,
              });
              created++;
            }
          } catch (e) {
            skipped++;
            errors.push({ ref: pp.kmlRef, message: e instanceof Error ? e.message : 'error al guardar' });
          }
        }
      }

      // 2) Cables — extremos por cercania, contra el estado YA actualizado de infraStore/oltStore.
      const candidates: EndpointCandidate[] = [
        ...infra.elementos
          .filter((e) => e.latitude != null && e.longitude != null)
          .map((e) => ({ kind: 'infra' as const, id: e.id, lat: e.latitude as number, lng: e.longitude as number })),
        ...olt.devices
          .filter((d) => d.lat != null && d.lng != null)
          .map((d) => ({ kind: 'olt' as const, id: d.id, lat: d.lat as number, lng: d.lng as number })),
      ];

      for (const folder of preview.value) {
        if (!folder.include) continue;
        let n = 0;
        for (const pl of folder.lines) {
          n++;
          try {
            const start = pl.line.path[0];
            const end = pl.line.path[pl.line.path.length - 1];
            const origen = nearestEndpoint(start[0], start[1], candidates);
            const destino = nearestEndpoint(end[0], end[1], candidates);
            const isUnnamed = /ruta sin t[ií]tulo|sin nombre/i.test(pl.line.name);
            await fibra.createCable({
              codigo: isUnnamed ? `KML-${folder.name}-${n}` : pl.line.name,
              tipo: pl.tipo,
              hilos_total: pl.hilosTotal,
              metraje: pl.metraje,
              path: pl.line.path,
              origen_infra_id: origen?.kind === 'infra' ? origen.id : null,
              origen_olt_id: origen?.kind === 'olt' ? origen.id : null,
              destino_infra_id: destino?.kind === 'infra' ? destino.id : null,
              destino_olt_id: destino?.kind === 'olt' ? destino.id : null,
              kml_ref: pl.kmlRef,
              import_batch_id: batchId,
            });
            cablesCreated++;
          } catch (e) {
            skipped++;
            errors.push({ ref: pl.kmlRef, message: e instanceof Error ? e.message : 'error al guardar el cable' });
          }
        }
      }

      await supabase
        .from('map_imports')
        .update({ summary: { created, updated, skipped, cablesCreated, errors: errors.length } })
        .eq('id', batchId);

      const result: ImportResult = { batchId, created, updated, skipped, cablesCreated, errors };
      lastResult.value = result;
      return result;
    } finally {
      committing.value = false;
    }
  }

  /** Borra SOLO lo que esa importación creó de cero (los elementos existentes que actualizó no se tocan). */
  async function revertBatch(batchId: string) {
    const infra = useInfraElementosStore();
    const fibra = useFoFibraStore();

    // Cables primero: pueden referenciar (origen/destino) las cajas creadas en el mismo batch.
    const { data: cables, error: cablesErr } = await supabase.from('fo_cables').select('id').eq('import_batch_id', batchId);
    if (cablesErr) throw cablesErr;
    for (const c of (cables ?? []) as { id: string }[]) {
      await fibra.deleteCable(c.id);
    }

    const { data: elementos, error: elErr } = await supabase.from('infra_elementos').select('id').eq('import_batch_id', batchId);
    if (elErr) throw elErr;
    for (const e of (elementos ?? []) as { id: string }[]) {
      await infra.deleteElemento(e.id);
    }

    if (lastResult.value?.batchId === batchId) lastResult.value = null;
  }

  return {
    NEW_ZONE,
    parsed,
    folderZoneChoice,
    folderInclude,
    parsing,
    parseError,
    committing,
    lastResult,
    preview,
    totals,
    loadFile,
    reset,
    commit,
    revertBatch,
  };
});
