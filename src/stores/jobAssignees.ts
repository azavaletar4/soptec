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

  /**
   * Fase 98: el propio tecnico toma un ticket SIN asignar desde la App de
   * Campo. A diferencia de addAssignee (bloqueado por RLS para TECNICO_RED,
   * ver migracion), esto llama a una funcion SECURITY DEFINER que valida
   * puntualmente que el ticket no tenga ya alguien asignado antes de
   * convertir al tecnico en su lider.
   */
  async function selfAssignTicket(ticketId: string) {
    const { error } = await supabase.rpc('self_assign_ticket', { p_ticket_id: ticketId });
    if (error) throw error;
  }

  /** Fase 118: mismo mecanismo que selfAssignTicket, para una Alta sin tecnico. */
  async function selfAssignInstallation(installationId: string) {
    const { error } = await supabase.rpc('self_assign_installation', { p_installation_id: installationId });
    if (error) throw error;
  }

  /** Fase 118: mismo mecanismo que selfAssignTicket, para una Rutina sin tecnico. */
  async function selfAssignRoutine(routineId: string) {
    const { error } = await supabase.rpc('self_assign_routine', { p_routine_id: routineId });
    if (error) throw error;
  }

  /**
   * Fase 99: el tecnico devuelve un ticket que ya habia tomado (ej. el
   * cliente no estaba) — libera la cuadrilla completa y deja una nota
   * obligatoria (ticket_comments) con el motivo. Mismo patron que
   * selfAssignTicket: RPC SECURITY DEFINER, la RLS normal se lo niega.
   */
  async function returnTicket(ticketId: string, reason: string) {
    const { error } = await supabase.rpc('return_ticket', { p_ticket_id: ticketId, p_reason: reason });
    if (error) throw error;
  }

  return { loading, fetchAssignees, addAssignee, removeAssignee, setLeader, selfAssignTicket, selfAssignInstallation, selfAssignRoutine, returnTicket };
});
