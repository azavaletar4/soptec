import type { Prospect, ProspectEstado } from '@/types/domain';

export type ProspectFilter = ProspectEstado | 'active' | 'all';

// Una relación conserva su carácter histórico aunque el estado haya sido editado.
export function isConvertedProspect(p: Prospect): boolean {
  return p.estado === 'convertido' || !!p.converted_client_id;
}

export function isActiveProspect(p: Prospect): boolean {
  return !isConvertedProspect(p) && ['interesado', 'por_contactar', 'en_negociacion'].includes(p.estado);
}

export function isProspectDue(p: Prospect, today: string): boolean {
  return isActiveProspect(p) && !!p.proximo_seguimiento && p.proximo_seguimiento <= today;
}

export function filterProspects(prospects: Prospect[], filter: ProspectFilter, query: string, today: string): Prospect[] {
  const q = query.trim().toLowerCase();
  return prospects.filter(p => {
    if (filter === 'active') return isActiveProspect(p);
    if (filter === 'convertido') return isConvertedProspect(p);
    if (filter === 'all') return true;
    return !isConvertedProspect(p) && p.estado === filter;
  }).filter(p => !q || `${p.full_name} ${p.phone}`.toLowerCase().includes(q))
    .sort((a, b) => Number(isProspectDue(b, today)) - Number(isProspectDue(a, today)) || b.created_at.localeCompare(a.created_at));
}

export function prospectCounts(prospects: Prospect[], today: string) {
  return {
    activos: prospects.filter(isActiveProspect).length,
    pendientes: prospects.filter(p => isProspectDue(p, today)).length,
    convertidos: prospects.filter(isConvertedProspect).length,
    total: prospects.length,
  };
}
