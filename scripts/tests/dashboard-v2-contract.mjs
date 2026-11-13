// Garantias de alcance y logica conservada. Solo lee fuentes y Git local.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';
const normalize=bytes=>String(bytes).replaceAll('\r\n','\n');
const reference='45f993e';
const read=file=>normalize(fs.readFileSync(file,'utf8'));
const base=file=>normalize(execFileSync('git',['show',reference+':'+file],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024}));
const unchanged=[
 'src/stores/olt.ts','src/router/index.ts','src/lib/api.ts',
 'src/lib/pppoeProfileCounts.ts','src/components/layout/AppLayout.vue','package.json','package-lock.json',
 'server/src/routes/dashboard.ts','server/src/services/dashboardPppoeProfiles.ts',
 'server/src/services/dashboardPppoeHandler.ts',
];
for(const file of unchanged)assert.equal(read(file),base(file),'UNRELATED_OR_DATA_CONTRACT_CHANGED:'+file);
const setup=text=>text.slice(text.indexOf('<script setup'),text.indexOf('</script>')).split('>\n').slice(1).join('>\n');
const ppp='src/components/dashboard/PppoeProfileCards.vue';
assert.equal(setup(read(ppp)),setup(base(ppp)),'PPPOE_FETCH_PERMISSIONS_OR_POLLING_CHANGED');
const declarations=text=>{
 const source=ts.createSourceFile('dashboard.ts',setup(text),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const result=new Map();
 for(const node of source.statements){
  if(ts.isFunctionDeclaration(node)&&node.name)result.set(node.name.text,node.getText(source));
  if(ts.isVariableStatement(node))for(const item of node.declarationList.declarations)if(ts.isIdentifier(item.name))result.set(item.name.text,item.getText(source));
 }
 return result;
};
const before=declarations(base('src/views/DashboardView.vue')),after=declarations(read('src/views/DashboardView.vue'));
const approvedReference='80e8e7e';
const approved=declarations(normalize(execFileSync('git',['show',approvedReference+':src/views/DashboardView.vue'],{encoding:'utf8'})));
const datePresentationOnly=['oltCheckedAtLabel','lastSuccessLabel'];
const operationalCountChanges=['ticketStatus'];
assert.deepEqual([...after.keys()],[...approved.keys()],'DASHBOARD_DECLARATIONS_CHANGED');
for(const [name,value] of approved)if(![...datePresentationOnly,...operationalCountChanges].includes(name))assert.equal(after.get(name),value,'APPROVED_DASHBOARD_LOGIC_CHANGED:'+name);
assert.equal(after.get('ticketStatus'),approved.get('ticketStatus').replace("open: 'Abierto',", "open: 'Abierto', pending: 'Pendiente', scheduled: 'Programado',"));
const storeBefore=base('src/stores/dashboard.ts'),storeAfter=read('src/stores/dashboard.ts');
const between=(text,start,end)=>{const a=text.indexOf(start);assert.ok(a>=0,start);const b=text.indexOf(end,a);assert.ok(b>a,end);return text.slice(a,b);};
assert.equal(between(storeAfter,'function todayIso()',"export const useDashboardStore"),between(storeBefore,'function todayIso()',"export const useDashboardStore"),'BILLING_DATES_AND_COMPUTATIONS_CHANGED');
assert.equal(between(storeAfter,"        supabase.from('invoices')",'      ]);'),between(storeBefore,"        supabase.from('invoices')",'      ]);'),'BILLING_QUERIES_CHANGED');
assert.equal(between(storeAfter,'      const pendingInvoices =','      summary.value ='),between(storeBefore,'      const pendingInvoices =','      summary.value ='),'BILLING_INPUTS_CHANGED');
assert.equal(between(storeAfter,'        billing: {','      lastUpdated.value'),between(storeBefore,'        billing: {','      lastUpdated.value'),'BILLING_SUMMARY_CHANGED');
assert.equal(storeAfter.slice(storeAfter.indexOf('      lastUpdated.value')),storeBefore.slice(storeBefore.indexOf('      lastUpdated.value')),'SUCCESS_ERROR_LIFECYCLE_CHANGED');
for(const query of ["apiFetch<NetworkStatus>('/api/dashboard/network-status')","apiFetch<OltAggregateSummary>('/api/dashboard/olt-summary')","supabase.from('service_contracts').select('*', { count: 'exact', head: true }).eq('status', 'active')"]){assert.ok(storeBefore.includes(query));assert.ok(storeAfter.includes(query));}
assert.match(storeAfter,/\.in\('status', ACTIVE_STATUS\[jobType\]\)/);
assert.match(storeAfter,/pendingInstallationClients: clientCounts\.pending/);
const preserved=['refresh','goTo','goToOlt','goToUnconfigured','REFRESH_SECONDS','updatedLabel','CHART_WIDTH','CHART_HEIGHT','CHART_PAD','chartBars','hasChartData'];
for(const name of preserved){assert.ok(before.has(name));assert.equal(after.get(name),before.get(name),'EXISTING_LOGIC_CHANGED:'+name);}
const expectedRate=before.get('recaudoBarClass').replaceAll('bg-green-500/80','rate-good').replaceAll('bg-amber-500/80','rate-warning').replaceAll('bg-red-500/80','rate-low');
assert.equal(after.get('recaudoBarClass'),expectedRate,'BILLING_THRESHOLDS_CHANGED');
assert.match(read('src/views/DashboardView.vue'),/<style scoped src=/);
assert.match(read(ppp),/<style scoped>/);
const report={status:'PASS',baseCommit:execFileSync('git',['rev-parse',reference],{encoding:'utf8'}).trim(),unchanged,
 approvedReference,approvedDashboardLogicUnchangedExceptDateFormatting:datePresentationOnly,
 pppoeScriptUnchanged:true,preservedFunctionsAndValues:preserved,billingThresholdsUnchanged:true,
 scopedStyles:true,dependenciesAdded:0,productionAccess:false};
const output=process.argv.includes('--output-dir')?process.argv[process.argv.indexOf('--output-dir')+1]:'docs/dashboard-support-prospects-local';
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(output+'/contract-verification.json',JSON.stringify({...report,operationalCountChanges,billingQueriesAndSummaryUnchanged:true},null,2)+'\n');
console.log(JSON.stringify({status:'PASS',unchangedFiles:unchanged.length,preserved:preserved.length,pppoeScriptUnchanged:true}));
