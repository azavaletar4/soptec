// Preparacion LOCAL. Lee el informe privado READ ONLY; no abre conexiones.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'deploy/ranking-counters-20261112');
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const md5 = value => createHash('md5').update(value).digest('hex');
const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const report = JSON.parse(read('scripts/inventory-auth-lab/runtime/ranking-counters-activation-private.json'));
if (report.length !== 3 || report.some(row => row.read_only !== 'on')) throw Error('Informe READ ONLY incompleto');
const snapshot = report[0];
const target = snapshot.functions.find(fn => fn.name === 'technician_ranking_between');
const backup = target.definition;
if (!read('server/tests/technicianRankingCountersBaseline.sql').includes(backup.trim())) throw Error('Deriva respecto a e114fb6');
if (md5(backup) !== target.definition_md5 || target.owner !== 'postgres') throw Error('Definicion/owner inesperado');
const candidate = read('server/queries/technicianRankingCounters.sql').trim();
if (!candidate.includes("or (category='other'")) throw Error('La candidata debe excluir billing/installation');
const candidateDefinition = backup.replace(/(AS \$function\$)[\s\S]*(\$function\$)/,
  (_, start, end) => `${start}\n${candidate}\n${end}`);
const signature = `public.${target.signature}`;
const currentRows = report[2].ranking.ranking;
const proposedRows = report[1].candidate;
const sortRows = rows => [...rows].sort((a,b) => a.technician_id.localeCompare(b.technician_id));
const stableRows = rows => sortRows(rows).map(({averias_count,rutinas_count,...rest}) => rest);
if (JSON.stringify(stableRows(currentRows)) !== JSON.stringify(stableRows(proposedRows))) {
  throw Error('La comparacion READ ONLY cambia puntos/penalizaciones/Altas/posiciones');
}
const actualCase = snapshot.other_tickets.find(row => row.ticket_number === 'TCK-2026-00104');
if (!actualCase || actualCase.points !== 2 || actualCase.frozen_category !== 'other' || !actualCase.motivo_averia) {
  throw Error('Evidencia del caso real incompleta');
}
const targetOid = `${literal(signature)}::regprocedure`;
const depsQuery = `select coalesce(jsonb_agg(to_jsonb(d) order by d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid,d.deptype),'[]') from pg_depend d
    where (d.classid='pg_proc'::regclass and d.objid=${targetOid})
       or (d.refclassid='pg_proc'::regclass and d.refobjid=${targetOid})`;
const helpers = snapshot.functions.filter(fn => fn !== target);
const helpersQuery = `select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p
    where p.oid in (${helpers.map(fn => `${literal(`public.${fn.signature}`)}::regprocedure`).join(',')})`;
const expectedHelpers = Object.fromEntries(helpers.map(fn => [fn.signature, fn.definition_md5]));
const helperGuard = `if v_helpers is distinct from ${literal(JSON.stringify(expectedHelpers))}::jsonb then
    raise exception 'Deriva en funciones relacionadas: detener y regenerar respaldo'; end if;`;
const periods = `select * from (values
    ('case_day','2026-11-06 05:00Z'::timestamptz,'2026-11-07 05:00Z'::timestamptz),
    ('case_week','2026-11-02 05:00Z'::timestamptz,'2026-11-09 05:00Z'::timestamptz),
    ('official_month','2026-11-01 05:00Z'::timestamptz,'2026-12-01 05:00Z'::timestamptz),
    ('historical_month','2026-10-01 05:00Z'::timestamptz,'2026-11-01 05:00Z'::timestamptz),
    ('mixed_week','2026-10-26 05:00Z'::timestamptz,'2026-11-02 05:00Z'::timestamptz)
  ) p(label,start_at,end_at)
  union all select 'current_month',date_trunc('month',now() at time zone 'America/Lima') at time zone 'America/Lima',
    (date_trunc('month',now() at time zone 'America/Lima')+interval '1 month') at time zone 'America/Lima'`;
const stripCounters = `(select coalesce(jsonb_agg(e-'averias_count'-'rutinas_count' order by e->>'technician_id'),'[]') from jsonb_array_elements(v_before) e)
        is distinct from (select coalesce(jsonb_agg(e-'averias_count'-'rutinas_count' order by e->>'technician_id'),'[]') from jsonb_array_elements(v_expected) e)`;
const candidateQuery = candidate.replaceAll('p_start', '$1').replaceAll('p_end', '$2').replace(/;\s*$/, '');
const aggregateCandidate = `select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') from (${candidateQuery}) r`;
const header = `-- PREPARADO LOCALMENTE. NO EJECUTADO EN SUPABASE. Requiere autorizacion posterior.
-- Origen: e114fb6; refinamiento: solo other oficial, sin billing/installation.
-- Una unica funcion. Sin DROP, GRANT/REVOKE, DML ni cambios en otras funciones.
begin isolation level repeatable read;
set local search_path=public;
set local lock_timeout='2s';
set local statement_timeout='30s';
`;
const commonDeclarations = `v_metadata jsonb; v_deps jsonb; v_helpers jsonb;`;
const capture = `select to_jsonb(p)-'prosrc' into v_metadata from pg_proc p where p.oid=${targetOid};
  ${depsQuery} into v_deps;
  ${helpersQuery} into v_helpers;
  ${helperGuard}
  if (select pg_get_userbyid(proowner)<>'postgres' or to_jsonb(proacl) is distinct from ${literal(JSON.stringify(target.acl))}::jsonb from pg_proc where oid=${targetOid}) then
    raise exception 'Deriva en owner/permisos de ranking'; end if;`;
// INSERT no se usa: todas las comparaciones viven en variables de la transaccion.
const preserved = `if v_metadata is distinct from (select to_jsonb(p)-'prosrc' from pg_proc p where p.oid=${targetOid}) then
    raise exception 'Firma/OID/owner/permisos/atributos alterados'; end if;
  if v_deps is distinct from (${depsQuery}) then raise exception 'Dependencias alteradas'; end if;
  if v_helpers is distinct from (${helpersQuery}) then raise exception 'Otra funcion alterada'; end if;`;
const apply = `${header}do $activation$
declare ${commonDeclarations}
  v_period record; entry jsonb; v_before jsonb; v_expected jsonb; v_after jsonb; snapshots jsonb:='[]';
begin
  if md5(pg_get_functiondef(${targetOid}))<>${literal(md5(backup))} then
    raise exception 'Deriva en funcion de produccion: no aplicar'; end if;
  ${capture}
  for v_period in ${periods} loop
    select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') into v_before
      from public.technician_ranking_between(v_period.start_at,v_period.end_at) r;
    execute $candidate_query$${aggregateCandidate}$candidate_query$ into v_expected using v_period.start_at,v_period.end_at;
    if ${stripCounters} then raise exception 'Cambian puntos/penalizaciones/Altas/posiciones: %',v_period.label; end if;
    snapshots:=snapshots||jsonb_build_array(jsonb_build_object('label',v_period.label,'start',v_period.start_at,'end',v_period.end_at,'expected',v_expected));
  end loop;
  execute $replacement$${candidateDefinition};$replacement$;
  if md5(pg_get_functiondef(${targetOid}))<>${literal(md5(candidateDefinition))} then raise exception 'Definicion candidata inesperada'; end if;
  ${preserved}
  for entry in select value from jsonb_array_elements(snapshots) loop
    select coalesce(jsonb_agg(to_jsonb(r) order by technician_id),'[]') into v_after
      from public.technician_ranking_between((entry->>'start')::timestamptz,(entry->>'end')::timestamptz) r;
    if v_after is distinct from entry->'expected' then raise exception 'Verificacion posterior fallo: %',entry->>'label'; end if;
  end loop;
  raise notice 'PASS: contadores esperados; puntos/Altas/posiciones/permisos/dependencias conservados';
end $activation$;
commit;
`;
const rollback = `${header}do $rollback$
declare ${commonDeclarations}
begin
  if md5(pg_get_functiondef(${targetOid})) not in (${literal(md5(backup))},${literal(md5(candidateDefinition))}) then
    raise exception 'Deriva posterior: no sobrescribir cambios ajenos'; end if;
  ${capture}
  execute $original$${backup};$original$;
  if md5(pg_get_functiondef(${targetOid}))<>${literal(md5(backup))} then raise exception 'Rollback no coincide con respaldo'; end if;
  ${preserved}
  raise notice 'PASS: definicion original restaurada exactamente; metadatos conservados';
end $rollback$;
commit;
`;
const verify = `-- Verificacion posterior de SOLO LECTURA. No aplica ni revierte nada.
begin isolation level repeatable read read only;
set local search_path=public;
set local statement_timeout='15s';
select jsonb_build_object('read_only',current_setting('transaction_read_only'),
  'definition_matches_candidate',md5(pg_get_functiondef(${targetOid}))=${literal(md5(candidateDefinition))},
  'definition_matches_backup',md5(pg_get_functiondef(${targetOid}))=${literal(md5(backup))},
  'owner',(select pg_get_userbyid(proowner) from pg_proc where oid=${targetOid}),
  'acl',(select proacl from pg_proc where oid=${targetOid}),
  'helpers_unchanged',(${helpersQuery})=${literal(JSON.stringify(expectedHelpers))}::jsonb,
  'ticket_contributions',(select jsonb_agg(c) from public.technician_point_contributions('2026-11-06 05:00Z','2026-11-07 05:00Z') c
    where c.job_id=(select id from public.tickets where ticket_number='TCK-2026-00104')));
set local role service_role;
select jsonb_build_object('read_only',current_setting('transaction_read_only'),'day',public.get_technician_period_ranking('day','2026-11-06'),
  'week',public.get_technician_period_ranking('week','2026-11-06'),
  'month',public.get_technician_period_ranking('month','2026-11-01'),
  'legacy_month',(select jsonb_agg(r) from public.get_technician_ranking(11,2026) r));
rollback;
`;
mkdirSync(out, { recursive: true });
const artifacts = { '.gitattributes': '* text eol=lf\n', 'backup.sql': `${backup};\n`,
  'apply.sql': apply, 'rollback.sql': rollback, 'verify-readonly.sql': verify };
for (const [name, content] of Object.entries(artifacts)) writeFileSync(resolve(out, name), content);
const manifest = {
  sourceCommit: 'e114fb6620a9fe6fc09cd3de7ca33067fa5c1476', readOnlyAt: snapshot.as_of,
  remoteChangesExecuted: false, signature, bodyMd5Before: target.body_md5,
  definitionMd5Before: md5(backup), definitionMd5Candidate: md5(candidateDefinition),
  owner: target.owner, acl: target.acl, arguments: target.arguments, result: target.result,
  volatility: target.volatility, securityDefiner: target.security_definer, config: target.config,
  oidAtCapture: target.oid, dependenciesAtCapture: snapshot.dependencies, callers: snapshot.body_callers,
  helpers: helpers.map(({ signature, definition_md5 }) => ({ signature, definition_md5 })),
  validation: {
    nonCounterFieldsEqual: true,
    otherCreditedTickets: snapshot.other_tickets.length,
    otherWithTechnicalReason: snapshot.other_tickets.filter(row=>row.motivo_averia).length,
    case: { ticket: actualCase.ticket_number, points: actualCase.points, status: actualCase.status,
      category: actualCase.frozen_category, technicalReason: actualCase.motivo_averia },
    ranking: proposedRows.map(row=>({ technician: row.technician_name,
      averiasBefore: currentRows.find(old=>old.technician_id===row.technician_id).averias_count,
      averiasAfter: row.averias_count, routines: row.rutinas_count, installations: row.installations_count,
      points: row.total_points, rank: row.ranking })),
  },
  files: Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, { sha256: sha(content) }])),
};
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ preparedLocally: true, directory: out, beforeMd5: manifest.definitionMd5Before,
  candidateMd5: manifest.definitionMd5Candidate, remoteChangesExecuted: false }));
