// Regression of the complementary verifier only. PostgreSQL is network-isolated.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const template=fs.readFileSync(path.join(root,'scripts/tests/fase162-complementary-read.sql'),'utf8');
const old=template.replaceAll(/jsonb_array_elements\(coalesce\(nullif\(([ab])->'(columns|constraints|indexes|triggers)','null'::jsonb\),'\[\]'::jsonb\)\)/g,(_,a,k)=>`jsonb_array_elements(${a}->'${k}')`);
const baseline={functions:[{signature:'synthetic()',definition_md5:'one',acl:null}],tables:[{name:'synthetic_no_trigger',rls:true,force:false,acl:null,columns:[{name:'id'}],constraints:[],indexes:[],triggers:null},{name:'synthetic_trigger',rls:true,force:false,acl:null,columns:[{name:'id'}],constraints:[{name:'pk'}],indexes:['synthetic_index'],triggers:[{name:'guard'}]}],policies:[{policyname:'synthetic_policy'}]};
const clone=x=>JSON.parse(JSON.stringify(x));
const name='smartrayco-verifier-'+process.pid+'-'+Date.now();
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
const sql=q=>docker(['exec','-i','-e','PGCLIENTENCODING=UTF8',name,'psql','-h','127.0.0.1','-U','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],q);
const query=(t,actual=baseline,expected=baseline)=>`BEGIN READ ONLY; WITH observed(j) AS (VALUES($j$${JSON.stringify(actual)}$j$::jsonb)), expected(j) AS (VALUES($j$${JSON.stringify(expected)}$j$::jsonb)) ${t} ROLLBACK;`;
const report={at:new Date().toISOString(),environment:'ISOLATED_POSTGRES_NO_NETWORK_SYNTHETIC_METADATA',originalServerErrorNotRetained:true,results:[]};
const pass=(test)=>{report.results.push({test,status:'PASS'});console.log('PASS '+test)};
(async()=>{let started=false;try{
 docker(['run','--rm','-d','--pull=never','--name',name,'--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
 for(let i=0;i<60;i++){try{sql('select 1');break}catch(e){if(i===59)throw e;await new Promise(r=>setTimeout(r,200))}}
 sql('create table public.routine_inventory_operations(id int);');
 try{sql(query(old));throw Error('Expected scalar extraction error')}catch(e){assert.match(e.stderr??'',/22023: cannot extract elements from a scalar/);report.reproducedError={sqlstate:'22023',message:'cannot extract elements from a scalar',source:'Isolated reproduction, not recovered historical server log'};pass('original verifier reproduces SQLSTATE 22023 on JSON null')}
 const good=JSON.parse(sql(query(template)));assert(Object.entries(good).filter(([k])=>k.startsWith('legacy')).every(([,v])=>v===true));pass('fixed verifier accepts JSON null and empty arrays');
 const missingIndex=clone(baseline);missingIndex.tables[1].indexes=[];assert.equal(JSON.parse(sql(query(template,missingIndex))).legacyIndexes,false);pass('missing legacy index still denied');
 const badColumn=clone(baseline);badColumn.tables[1].columns=[{name:'wrong'}];assert.equal(JSON.parse(sql(query(template,badColumn))).legacyColumns,false);pass('changed legacy column still denied');
 const removedTrigger=clone(baseline);removedTrigger.tables[1].triggers=null;assert.equal(JSON.parse(sql(query(template,removedTrigger))).legacyTriggers,false);pass('removed required trigger is not hidden by null handling');
 const missingTable=clone(baseline);missingTable.tables.pop();assert.equal(JSON.parse(sql(query(template,missingTable))).legacyTableCount,false);pass('missing legacy table detected despite inner joins');
 const missingFn=clone(baseline);missingFn.functions=[];assert.equal(JSON.parse(sql(query(template,missingFn))).legacyFunctionCount,false);pass('missing legacy function detected');
 const malformed=clone(baseline);malformed.tables[1].triggers={invalid:true};try{sql(query(template,malformed));throw Error('Expected malformed metadata denial')}catch(e){assert.match(e.stderr??'',/22023: cannot extract elements from an object/);pass('unexpected non-array metadata fails closed')}
 report.status='PASS';fs.writeFileSync(path.join(root,'docs/FASE162-COMPLEMENTARIA-PRUEBAS.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS '+report.results.length+' focused verifier regressions; no Cloud');
}finally{if(started)docker(['rm','-f',name])}})().catch(e=>{console.error(e.message);process.exitCode=1});
