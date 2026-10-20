import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { createTechnicianRankingHandler, RANKING_READ_ROLES } from '../services/technicianRanking';

// Authenticated staff share aggregate productivity. Scoring stays in SQL;
// the handler validates periods and projects only the public ranking fields.
export const soporteRoutes = new Hono();

const STAFF_READ = RANKING_READ_ROLES;

soporteRoutes.use('*', requireAuth, requireRole(...STAFF_READ));

export interface TechnicianRankingRow {
  technician_id: string;
  technician_name: string;
  installations_count: number;
  averias_count: number;
  reconexiones_count: number;
  rutinas_count: number;
  reincidencias_count: number;
  total_points: number;
  ranking: number;
}

soporteRoutes.get('/ranking-tecnicos', createTechnicianRankingHandler((name, args) => supabaseAdmin.rpc(name, args)));
