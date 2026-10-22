const fs=require('fs'),cp=require('child_process'),path=require('path');
const root=path.resolve(__dirname,'../..'),loc=JSON.parse(fs.readFileSync(__dirname+'/backup-location.json'));
const prior='D:/SmartRayco/scripts/inventory-auth-lab/runtime', workspace=__dirname+'/execution';
fs.mkdirSync(workspace,{recursive:true});
const source=prior+'/olt-stage2-expansion-2026-10-21T17-49-12-546Z';
const cfg={workspace,dir:loc.BackupDirectory,candidate:'1da360de999fad64ac0a82a5be170c3812bdc6c6',integrationBase:'b201183d9324a855f72ee2e2c8cae8ba9ab45edf',productionHead:'3cf2596bc2d556b1d99830b7200b36d967c73b5b',migration:'supabase/migrations/20261021170000_olt_retirement_expand.sql',sha256:'fe3f33584eac4ce3c80a054967f2a66737cee680b6381c73aef244cf8482038e'};
fs.writeFileSync(__dirname+'/execution-config.json',JSON.stringify(cfg,null,2));
const snap=JSON.parse(fs.readFileSync(cfg.dir+'/preflight.private.json'));
fs.writeFileSync(cfg.dir+'/catalog-before.private.json',JSON.stringify(snap.catalog));
for(const f of ['catalog.sql','extra-catalog.sql','ledger-read.sql','read-preflight.sh','read-preflight.ps1'])fs.copyFileSync(source+'/'+f,workspace+'/'+f);
fs.writeFileSync(workspace+'/20261021170000_olt_retirement_expand.sql',fs.readFileSync(root+'/supabase/migrations/20261021170000_olt_retirement_expand.sql','utf8').replace(/\r\n/g,'\n'));
let prep=fs.readFileSync(prior+'/olt-stage2-prepare-execution.cjs','utf8');
prep=prep.slice(0,prep.indexOf('let sh=fs.readFileSync'));
prep=prep.replace("JSON.parse(fs.readFileSync(rt+'/olt-stage2-location.json','utf8').replace(/^\\uFEFF/,''))","JSON.parse(fs.readFileSync(process.argv[2],'utf8'))");
fs.writeFileSync(__dirname+'/prepare-expansion.cjs',prep);
cp.execFileSync(process.execPath,[__dirname+'/prepare-expansion.cjs',__dirname+'/execution-config.json'],{stdio:'inherit'});
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const restoreAcl=(object,acl)=>`REVOKE ALL ON ${object} FROM PUBLIC,postgres,anon,authenticated,service_role;\nDO $acl$ DECLARE a record; BEGIN FOR a IN SELECT * FROM aclexplode(${quote(acl)}::aclitem[]) LOOP IF a.grantor <> 'postgres'::regrole THEN RAISE EXCEPTION 'Unexpected grantor'; END IF; EXECUTE format('GRANT %s ON ${object} TO %s%s', a.privilege_type, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END); END LOOP; END $acl$;\n`;
let acl=restoreAcl('TABLE public.olt_onts',snap.catalog.preflight.rls.acl);
for(const f of snap.catalog.functions.functions)acl+=restoreAcl(`FUNCTION public.${f.proname}(${f.arguments})`,f.grants);
acl+='ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;\n';
fs.writeFileSync(cfg.dir+'/restore-target-acl.sql',acl);
let restore=fs.readFileSync(__dirname+'/restore.sh','utf8').replace(/^createdb .* restaurado\r?\n/m,'').replaceAll('-d restaurado','-d postgres');
restore=restore.replace('pg_ctl -D "$PGDATA" -m fast -w stop',`mkdir -p /evidence/lab-current
psql -h /var/run/postgresql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f /backup/restore-target-acl.sql >/evidence/target-acl-restore.log 2>/evidence/target-acl-restore-errors.log
PGOPTIONS='-c default_transaction_read_only=off -c timezone=UTC -c extra_float_digits=0' psql -h /var/run/postgresql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1 -f /candidate/scripts/olt-janet-estiven/execution/lab-apply.sql >/evidence/expansion-lab.log 2>/evidence/expansion-lab-errors.log
pg_ctl -D "$PGDATA" -m fast -w stop`);
fs.writeFileSync(__dirname+'/restore-and-expand.sh',restore);
let ps=fs.readFileSync(__dirname+'/backup.ps1','utf8').replace("'restore.sh'","'restore-and-expand.sh'").replace("'restore-verify'","('restore-verify-'+[DateTime]::UtcNow.ToString('yyyyMMdd_HHmmss'))");
ps=ps.replace("--mount \"type=bind,source='+$evidence+',target=/evidence\"", "--mount \"type=bind,source='+$evidence+',target=/evidence\" --mount \"type=bind,source='+(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path+',target=/candidate,readonly\" --mount \"type=bind,source='+(Join-Path $evidence 'lab-current')+',target=/out\" --mount \"type=bind,source='+(Join-Path $PSScriptRoot 'execution')+',target=/scripts,readonly\"");
// Docker bind mount creates lab-current under the restricted evidence directory.
fs.writeFileSync(__dirname+'/restore-and-expand.ps1',ps);
console.log('Preparado ensayo aislado desde respaldo actual; sin ejecutar SQL productivo');
