-- Fase 115b: habilita Supabase Realtime (postgres_changes) sobre profiles —
-- ninguna tabla del proyecto estaba en la publicacion supabase_realtime
-- todavia. Las tarjetas de "Tecnicos activos" se suscriben a UPDATE de esta
-- tabla para refrescar bateria/GPS sin recargar. postgres_changes respeta
-- las policies de SELECT ya existentes (profiles_select_staff_for_assignment,
-- Fase 6) — no expone nada que un staff no pudiera leer ya con un fetch normal.

alter publication supabase_realtime add table public.profiles;
