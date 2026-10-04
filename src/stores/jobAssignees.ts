import { defineStore } from 'pinia';
import { ref } from 'vue';
import { supabase } from '@/lib/supabase';
import type { JobAssignee, JobType } from '@/types/domain';

const ASSIGNEE_SELECT = '*, profile:profiles!job_assignees_technician_id_fkey(id, full_name, email)';

/**
 * Cuadrilla (multiples tecnicos) de un ticket/instalacion puntual (Fase 94).
 * Armar/editar la cuadrilla es una decision de despacho — la RLS solo deja
 * escribir a SUPERADMIN/ADMIN/SOPORTE (ver migracion), esto no lo repite en
 * el frontend porque la BD ya lo rechaza si alguien mas lo intenta.
 */
export const useJobAssigneesStore = defineStore('jobAssignees', () => {
  const loading = ref(false);

  async function fetchAssignees(jobType: JobType, jobId: string): Promise<JobAssignee[]> {
    loading.value = true;
    try {
      const { data, error } = await supabase
        .from('job_assignees')
        .select(ASSIGNEE_SELECT)
        .eq('job_type', jobType)
        .eq('job_id', jobId)
        .order('role');
      if (error) throw error;
      return (data ?? []) as unknown as JobAssignee[];
    } finally {
      loading.value = false;
    }
  }

  /** Agrega un tecnico a la cuadrilla — lider si es el primero, apoyo si ya hay cuadrilla. */
  async function addAssignee(jobType: JobType, jobId: string, technicianId: string, current: JobAssignee[]) {
    const role = current.some((a) => a.role === 'leader') ? 'support' : 'leader';
    const { error } = await supabase.from('job_assignees').insert({ job_type: jobType, job_id: jobId, technician_id: technicianId, role });
    if (error) throw error;
  }

  async function removeAssignee(jobType: JobType, jobId: string, technicianId: string) {
    const { error } = await supabase
      .from('job_assignees')
      .delete()
      .eq('job_type', jobType)
      .eq('job_id', jobId)
      .eq('technician_id', technicianId);
    if (error) throw error;
  }

  /** Promueve a lider: primero degrada al lider actual (si hay) para no chocar con el indice "1 solo lider". */
  async function setLeader(jobType: JobType, jobId: string, technicianId: string) {
    const { error: demoteErr } = await supabase
      .from('job_assignees')
      .update({ role: 'support' })
      .eq('job_type', jobType)
      .eq('job_id', jobId)
      .eq('role', 'leader');
    if (demoteErr) throw demoteErr;

    const { error: promoteErr } = await supabase
      .from('job_assignees')
      .update({ role: 'leader' })
      .eq('job_type', jobType)
      .eq('job_id', jobId)
      .eq('technician_id', technicianId);
    if (promoteErr) throw promoteErr;
  }

  return { loading, fetchAssignees, addAssignee, removeAssignee, setLeader };
});
