-- Deteccion automatica de ONT autorizadas externamente (2026-11-04).
--
-- Aditiva pura: agrega 2 columnas a una tabla ya existente (Fase 40,
-- olt_sync_cache), mismo patron exacto que la columna `unconfigured_onts`
-- ya presente en esa tabla (jsonb, default lista vacia). No crea tabla
-- nueva, no toca RLS (esta tabla ya tiene RLS activado SIN policies -- solo
-- el backend con service_role la lee/escribe, igual que unconfigured_onts),
-- no modifica `olt_onts` ni ninguna otra tabla.
--
-- `new_onts_detected`: lista de ONT con onu-id YA autorizado en la OLT real
-- pero sin ninguna fila en `olt_onts` todavia -- llenada por
-- server/src/services/oltSyncService.ts (performFullSync) en cada ciclo del
-- sync periodico de 20 min, reutilizando el MISMO escaneo que ya hacia para
-- telemetria (cero Telnet adicional) y el mismo clasificador que ya usaba
-- `import-existing` (classifyImportCandidates.newlyDetected).
--
-- `new_onts_checked_at`: momento del ULTIMO ciclo que SI completo la
-- deteccion (a diferencia de `checked_at`, que se actualiza en CADA intento
-- exista o no exito). Permite que el panel avise "estos datos son de hace
-- X" sin nunca confundir "la OLT no respondio esta vez" con "ya no hay ONT
-- nuevas" -- requisito explicito: un fallo de sincronizacion nunca debe
-- reemplazar un resultado valido anterior por una lista vacia.
begin;

alter table public.olt_sync_cache
  add column if not exists new_onts_detected jsonb not null default '[]'::jsonb,
  add column if not exists new_onts_checked_at timestamptz;

commit;
