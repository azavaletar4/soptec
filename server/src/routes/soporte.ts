import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';

// Ranking mensual de tecnicos de campo (Fase 27) — la logica de puntaje
// vive entera en la funcion SQL get_technician_ranking (ver migracion), acá
// solo se valida el rol y se parsean mes/anio.
export const soporteRoutes = new Hono();

const STAFF_READ = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;

soporteRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

export interface TechnicianRankingRow {
  technician_id: string;
  technician_name: string;
  installations_count: number;
  averias_count: number;
  reconexiones_count: number;
  reincidencias_count: number;
  total_points: number;
  ranking: number;
}

soporteRoutes.get('/ranking-tecnicos', async (c) => {
  const mesRaw = c.req.query('mes');
  const anioRaw = c.req.query('anio');
  const now = new Date();
  const mes = mesRaw ? Number(mesRaw) : now.getMonth() + 1;
  const anio = anioRaw ? Number(anioRaw) : now.getFullYear();

  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return c.json({ error: 'mes invalido (1-12)' }, 400);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return c.json({ error: 'anio invalido' }, 400);

  const { data, error } = await supabaseAdmin.rpc('get_technician_ranking', { p_month: mes, p_year: anio });
  if (error) return c.json({ error: error.message }, 400);

  return c.json({ mes, anio, ranking: (data ?? []) as TechnicianRankingRow[] });
});
