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
 'src/stores/dashboard.ts','src/stores/olt.ts','src/router/index.ts','src/lib/api.ts',
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
const preserved=['refresh','goTo','goToOlt','goToUnconfigured','REFRESH_SECONDS','updatedLabel','CHART_WIDTH','CHART_HEIGHT','CHART_PAD','chartBars','hasChartData'];
for(const name of preserved){assert.ok(before.has(name));assert.equal(after.get(name),before.get(name),'EXISTING_LOGIC_CHANGED:'+name);}
const expectedRate=before.get('recaudoBarClass').replaceAll('bg-green-500/80','rate-good').replaceAll('bg-amber-500/80','rate-warning').replaceAll('bg-red-500/80','rate-low');
assert.equal(after.get('recaudoBarClass'),expectedRate,'BILLING_THRESHOLDS_CHANGED');
assert.match(read('src/views/DashboardView.vue'),/<style scoped src=/);
assert.match(read(ppp),/<style scoped>/);
const report={status:'PASS',baseCommit:execFileSync('git',['rev-parse',reference],{encoding:'utf8'}).trim(),unchanged,
 pppoeScriptUnchanged:true,preservedFunctionsAndValues:preserved,billingThresholdsUnchanged:true,
 scopedStyles:true,dependenciesAdded:0,productionAccess:false};
fs.mkdirSync('docs/dashboard-v2-local',{recursive:true});
fs.writeFileSync('docs/dashboard-v2-local/contract-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',unchangedFiles:unchanged.length,preserved:preserved.length,pppoeScriptUnchanged:true}));
