import type { Context } from 'hono';
import type { AuthUser } from '../middleware/auth';

export const RANKING_READ_ROLES = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE'] as const;
type RankingRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const columns = ['technician_id','technician_name','installations_count','averias_count','reconexiones_count','rutinas_count','reincidencias_count','total_points','ranking'] as const;
const project = (rows: unknown) => Array.isArray(rows) ? rows.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))) : [];

export function createTechnicianRankingHandler(rpc: RankingRpc) {
  return async (c: Context) => {
    const user = c.get('user') as AuthUser | undefined;
    if (!user) return c.json({ error: 'No autenticado' }, 401);
    if (!(RANKING_READ_ROLES as readonly string[]).includes(user.role)) return c.json({ error: 'Sin permiso de ranking' }, 403);
    const period = c.req.query('periodo');
    if (period !== undefined) {
      if (!['day','week','month'].includes(period)) return c.json({ error: 'periodo invalido' }, 400);
      const date = c.req.query('fecha');
      if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2000-01-01' || date > '2100-12-31' ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) return c.json({ error: 'fecha invalida' }, 400);
      const { data, error } = await rpc('get_technician_period_ranking', { p_period: period, p_date: date ?? null });
      if (error) return c.json({ error: 'No se pudo consultar el ranking' }, 400);
      const result = data as Record<string, unknown> | null;
      return c.json({ period: result?.period, start: result?.start, end: result?.end,
        timezone: result?.timezone, asOf: result?.asOf, ranking: project(result?.ranking) });
    }
    // Legacy monthly request keeps the existing signature and calendar semantics.
    const now = new Date();
    const mes = c.req.query('mes') !== undefined ? Number(c.req.query('mes')) : now.getMonth()+1;
    const anio = c.req.query('anio') !== undefined ? Number(c.req.query('anio')) : now.getFullYear();
    if (!Number.isInteger(mes) || mes<1 || mes>12) return c.json({ error: 'mes invalido (1-12)' }, 400);
    if (!Number.isInteger(anio) || anio<2000 || anio>2100) return c.json({ error: 'anio invalido' }, 400);
    const { data, error } = await rpc('get_technician_ranking', { p_month: mes, p_year: anio });
    if (error) return c.json({ error: 'No se pudo consultar el ranking' }, 400);
    return c.json({ mes, anio, ranking: project(data) });
  };
}
