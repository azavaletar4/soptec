import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Compatibilidad real con el hotfix YA DESPLEGADO en Cloud
// (20261015220000_cuadrillas_cierre_vigente.sql, confirmado vivo: existen
// set_current_job_crew/assert_current_job_operator) que NO esta en el
// historial de git de `main` (produccion esta en 592d282, una rama que
// nunca se integro de vuelta). Fase 163 se desarrollo sobre `main`, que no
// conoce estos triggers nuevos — esta prueba carga los 4 objetos reales
// del hotfix (trigger de cierre, trigger "candado" de job_assignees,
// set_current_job_crew) tal como existen en 592d282, para confirmar que
// postpone_installation sigue funcionando correctamente contra el esquema
// REAL de Cloud, no solo contra el esquema simplificado de
// installationPostponements.sql.test.ts (que no incluye estos triggers
// porque no estan en el historial de `main`). No repite las 23 pruebas ya
// aprobadas; solo cubre esta interaccion especifica.
const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const tech = '00000000-0000-0000-0000-000000000003';
const admin = '00000000-0000-0000-0000-000000000002';
const installation = '20000000-0000-0000-0000-000000000001';
const migration = '../../supabase/migrations/20261017010000_fase163_postergar_instalaciones.sql';

// Copiado literal de 592d282:supabase/migrations/20261015220000_cuadrillas_cierre_vigente.sql
// (solo las 4 funciones/triggers relevantes para installations/job_assignees;
// se omiten los triggers de work_order_closures/work_order_photos/
// client_equipment_photos, ajenos a esta prueba).
const HOTFIX_FUNCTIONS = `
CREATE FUNCTION public.assert_current_job_operator(p_job_type text,p_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s text; r public.user_role := public.current_user_role();
BEGIN
 IF auth.uid() IS NULL OR r IS NULL THEN RAISE EXCEPTION 'Usuario no autorizado o inactivo'; END IF;
 IF p_job_type='installation' THEN SELECT status::text INTO s FROM public.installations WHERE id=p_job_id;
 ELSIF p_job_type='ticket' THEN SELECT status::text INTO s FROM public.tickets WHERE id=p_job_id;
 ELSIF p_job_type='routine' THEN SELECT status::text INTO s FROM public.routines WHERE id=p_job_id;
 ELSE RAISE EXCEPTION 'Tipo de orden no valido'; END IF;
 IF s IS NULL THEN RAISE EXCEPTION 'Orden no disponible'; END IF;
 IF r='SUPERADMIN' THEN RETURN; END IF;
 IF r IN ('ADMIN','SOPORTE') THEN
   IF p_job_type='installation' AND (r='SOPORTE' OR s IN ('completed','cancelled')) THEN
     RAISE EXCEPTION 'No tienes permiso para modificar esta Alta';
   END IF;
   RETURN;
 END IF;
 IF r<>'TECNICO_RED' OR s IN ('completed','cancelled','resolved','closed') OR NOT EXISTS (
   SELECT 1 FROM public.job_assignees WHERE job_type=p_job_type AND job_id=p_job_id AND technician_id=auth.uid()
 ) THEN RAISE EXCEPTION 'No puedes operar esta orden: revisa su estado y tu asignacion vigente'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_current_job_operator(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assert_current_job_operator(text,uuid) TO authenticated;

CREATE FUNCTION public.guard_job_completion_crew()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Usuario inactivo o no autorizado'; END IF;
 IF public.current_user_role()='TECNICO_RED' THEN
   IF OLD.status::text IN ('completed','cancelled','resolved','closed') THEN
     RAISE EXCEPTION 'La orden ya esta finalizada o cancelada';
   END IF;
   IF NEW.status::text IN ('completed','resolved','closed') THEN
     PERFORM public.assert_current_job_operator(TG_ARGV[0],OLD.id);
     IF TG_ARGV[0]='ticket' AND NEW.status::text='closed' THEN
       RAISE EXCEPTION 'El cierre administrativo corresponde a oficina';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_job_completion_crew() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_installations_current_crew BEFORE UPDATE OF status ON public.installations
 FOR EACH ROW EXECUTE FUNCTION public.guard_job_completion_crew('installation');
CREATE TRIGGER trg_tickets_current_crew BEFORE UPDATE OF status ON public.tickets
 FOR EACH ROW EXECUTE FUNCTION public.guard_job_completion_crew('ticket');
CREATE TRIGGER trg_routines_current_crew BEFORE UPDATE OF status ON public.routines
 FOR EACH ROW EXECUTE FUNCTION public.guard_job_completion_crew('routine');

CREATE FUNCTION public.lock_job_crew_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j record; s text; previous jsonb; following jsonb;
BEGIN
 IF auth.uid() IS NOT NULL AND public.current_user_role() IS NULL THEN RAISE EXCEPTION 'Usuario inactivo o no autorizado'; END IF;
 IF TG_OP<>'INSERT' THEN previous:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN following:=to_jsonb(NEW); END IF;
 FOR j IN SELECT DISTINCT x->>'job_type' AS job_type,(x->>'job_id')::uuid AS job_id
   FROM jsonb_array_elements(jsonb_build_array(previous,following)) x
   WHERE x<>'null'::jsonb ORDER BY job_type,job_id
 LOOP
   IF j.job_type='installation' THEN SELECT status::text INTO s FROM public.installations WHERE id=j.job_id FOR UPDATE;
   ELSIF j.job_type='ticket' THEN SELECT status::text INTO s FROM public.tickets WHERE id=j.job_id FOR UPDATE;
   ELSIF j.job_type='routine' THEN SELECT status::text INTO s FROM public.routines WHERE id=j.job_id FOR UPDATE;
   ELSE RAISE EXCEPTION 'Tipo de orden no valido'; END IF;
   IF public.current_user_role()='TECNICO_RED' AND s IN ('completed','cancelled','resolved','closed') THEN
     RAISE EXCEPTION 'No puedes cambiar la cuadrilla de una orden finalizada o cancelada';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.lock_job_crew_parent() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_job_assignees_lock_parent BEFORE INSERT OR UPDATE OR DELETE ON public.job_assignees
 FOR EACH ROW EXECUTE FUNCTION public.lock_job_crew_parent();

CREATE FUNCTION public.set_current_job_crew(p_job_type text,p_job_id uuid,p_expected jsonb,p_members jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.user_role:=public.current_user_role(); s text; actual jsonb;
BEGIN
 IF auth.uid() IS NULL OR r IS NULL OR r NOT IN ('SUPERADMIN','ADMIN','SOPORTE') THEN
   RAISE EXCEPTION 'Solo despacho puede reasignar la cuadrilla';
 END IF;
 IF p_job_type='installation' THEN SELECT status::text INTO s FROM public.installations WHERE id=p_job_id FOR UPDATE;
 ELSIF p_job_type='ticket' THEN SELECT status::text INTO s FROM public.tickets WHERE id=p_job_id FOR UPDATE;
 ELSIF p_job_type='routine' THEN SELECT status::text INTO s FROM public.routines WHERE id=p_job_id FOR UPDATE;
 ELSE RAISE EXCEPTION 'Tipo de orden no valido'; END IF;
 IF s IS NULL THEN RAISE EXCEPTION 'Orden no disponible'; END IF;
 IF p_job_type='installation' AND s IN ('completed','cancelled') AND r<>'SUPERADMIN' THEN
   RAISE EXCEPTION 'Solo SUPERADMIN puede cambiar la cuadrilla de un Alta cerrada';
 END IF;
 IF p_expected IS NULL OR jsonb_typeof(p_expected)<>'array' OR p_members IS NULL OR jsonb_typeof(p_members)<>'array' THEN
   RAISE EXCEPTION 'Cuadrilla no valida';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('technician_id',technician_id,'role',role) ORDER BY technician_id),'[]'::jsonb)
 INTO actual FROM public.job_assignees WHERE job_type=p_job_type AND job_id=p_job_id;
 IF actual IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x->>'technician_id'),'[]'::jsonb) FROM jsonb_array_elements(p_expected) x) THEN
   RAISE EXCEPTION 'La cuadrilla cambio: recarga antes de guardar';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_members) m WHERE jsonb_typeof(m)<>'object'
    OR NOT (m ? 'technician_id' AND m ? 'role') OR m->>'technician_id' IS NULL
    OR m->>'role' IS NULL OR m->>'role' NOT IN ('leader','support')
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(m->>'technician_id')::uuid AND p.active AND p.role='TECNICO_RED'))
 OR (SELECT count(*) FROM jsonb_array_elements(p_members))<>(SELECT count(DISTINCT x->>'technician_id') FROM jsonb_array_elements(p_members) x)
 OR (SELECT count(*) FROM jsonb_array_elements(p_members) x WHERE x->>'role'='leader')>1 THEN
   RAISE EXCEPTION 'Cuadrilla no valida: usa tecnicos activos sin duplicados y un solo lider';
 END IF;
 DELETE FROM public.job_assignees WHERE job_type=p_job_type AND job_id=p_job_id;
 INSERT INTO public.job_assignees(job_type,job_id,technician_id,role)
 SELECT p_job_type,p_job_id,(m->>'technician_id')::uuid,m->>'role' FROM jsonb_array_elements(p_members) m;
END $$;
REVOKE ALL ON FUNCTION public.set_current_job_crew(text,uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_current_job_crew(text,uuid,jsonb,jsonb) TO authenticated;
`;

test('Fase 163 vs hotfix real de Cloud (cuadrillas_cierre_vigente, ausente en git de main)', { timeout: 60000 }, async t => {
  const container = `smartrayco-f163-hotfix-compat-${process.pid}-${Date.now()}`;
  const docker = (args: string[], input?: string) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const args = ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'];
  const sql = (s: string) => docker(args, s).trim();
  const user = (s: string, uid = tech) => sql(`set role authenticated; set request.jwt.claim.sub='${uid}'; ${s}`);
  try {
    docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(ready);
    sql(file('./jobWorkSessionsSchema.sql'));
    sql(`alter table installations add column notes text;
      alter table job_assignees enable row level security;
      alter table installations enable row level security;
      alter table profiles enable row level security;`);
    sql(file('../../supabase/migrations/20260919020000_fase13_gestion_usuarios.sql').match(/create or replace function public\.current_user_role\(\)[\s\S]*?\$\$;/)![0]);
    sql(file('../../supabase/migrations/20261005020000_fase101_rutinas_mantenimiento.sql').match(/create or replace function public\.sync_assigned_to_from_job_assignees\(\)[\s\S]*?\$\$;/)![0]);
    sql(`create trigger sync_crew after insert or update or delete on job_assignees for each row execute function sync_assigned_to_from_job_assignees();`);
    sql(file('../../supabase/migrations/20261012140000_fase150_sesiones_trabajo.sql'));
    sql(file('../../supabase/migrations/20261012200000_fase150b_fix_track_job_work_session_enum.sql'));
    sql(file(migration));
    sql(HOTFIX_FUNCTIONS);
    const reset = () => sql(`truncate installation_postponements, job_work_sessions, job_assignees, installations;
      insert into installations(id,status,assigned_to,notes) values ('${installation}','pending','${tech}','Conservar');
      insert into job_assignees values ('installation','${installation}','${tech}','leader');
      update installations set status='in_progress' where id='${installation}';`);

    await t.test('postpone_installation sigue funcionando con los triggers reales del hotfix activos', () => {
      reset();
      user(`select public.postpone_installation('${installation}', 'Cliente ausente');`);
      assert.equal(sql(`select status || '|' || coalesce(assigned_to::text,'libre') from installations;`), 'pending|libre');
      assert.equal(sql('select count(*) from job_assignees;'), '0');
      assert.equal(sql("select end_reason from job_work_sessions where job_type='installation';"), 'paused');
      assert.equal(sql('select count(*) from installation_postponements;'), '1');
    });

    await t.test('tras postergar, administracion reasigna con el RPC real set_current_job_crew (no insert directo)', () => {
      reset();
      user(`select public.postpone_installation('${installation}', 'Cliente ausente');`);
      user(`select public.set_current_job_crew('installation','${installation}','[]'::jsonb,'[{"technician_id":"${tech}","role":"leader"}]'::jsonb);`, admin);
      assert.equal(sql('select assigned_to from installations;'), tech);
      assert.equal(sql('select count(*) from job_assignees;'), '1');
      assert.equal(sql('select count(*) from installation_postponements;'), '1');
    });

    await t.test('tecnico no puede postergar una Alta ya finalizada (trigger del hotfix la protege primero)', () => {
      reset();
      sql(`update installations set status='completed' where id='${installation}';`);
      assert.throws(() => user(`select public.postpone_installation('${installation}', 'Cliente ausente');`), /en progreso/);
    });
  } finally { try { docker(['rm', '-f', container]); } catch {} }
});
