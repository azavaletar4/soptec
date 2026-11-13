// Prueba específica V2. No cambia assets ni relaja el contrato compartido.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse} from '@babel/parser';
import {proveLinkerOnly} from './pppoe-publication-linker-proof.mjs';
const runtime=path.resolve('scripts/inventory-auth-lab/runtime/dashboard-v2-publication');
const option=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const output=option('--output','deploy/dashboard-v2-20261112/artifact-scope-proof.json');
const oldFolder=path.join(runtime,'baseline-frontend'),newFolder=path.resolve(option('--candidate-dir',path.join(runtime,'build-1/dist')));
const read=folder=>{const result={};const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile())result[path.relative(folder,p).replaceAll('\\','/')]=fs.readFileSync(p);}};walk(folder);return result;};
const old=read(oldFolder),current=read(newFolder),hash=b=>createHash('sha256').update(b).digest('hex');
const strip=p=>p.replace(/^(.*?)-[\w-]{8,12}(\.(?:js|css))$/,(_,n,e)=>n+e);
const meta=files=>JSON.parse(files['.vite/manifest.json']);
const mains=[old,current].map(files=>Object.values(meta(files)).find(row=>row.isEntry).file);
const addedCss='assets/DashboardView.css';
const coverage=[];
function resolvePreloads(text,after){
 const nodes=parse(text,{sourceType:'module'}).program.body;
 const helper=nodes.find(n=>n.type==='VariableDeclaration'&&n.declarations.length===1&&n.declarations[0].id.name==='__vite__mapDeps');
 assert.ok(helper,'MISSING_VITE_PRELOAD_HELPER');
 const arrays=[];const visit=(node,callback)=>{if(!node||typeof node!=='object')return;if(node.type)callback(node);for(const [key,value]of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(x=>visit(x,callback));else if(value&&typeof value==='object')visit(value,callback);}};
 visit(helper,n=>{if(n.type==='ArrayExpression')arrays.push(n);});assert.equal(arrays.length,1);
 const array=arrays[0];assert.ok(array.elements.every(e=>e.type==='StringLiteral'));
 const deps=array.elements.map(e=>strip(e.value));assert.equal(new Set(deps).size,deps.length,'AMBIGUOUS_PRELOAD_IDENTITIES');
 const signature=text.slice(helper.start,array.start)+'[]'+text.slice(array.end,helper.end);
 const replacements=[{start:helper.start,end:helper.end,value:''}];
 const used=new Set();let cssChanges=0,helperChanges=0,calls=0;
 visit({type:'Program',body:nodes.filter(n=>n!==helper)},n=>{
  if(n.type!=='CallExpression'||n.callee.type!=='Identifier'||n.callee.name!=='__vite__mapDeps')return;
  assert.equal(n.arguments.length,1);assert.equal(n.arguments[0].type,'ArrayExpression');
  const indices=n.arguments[0].elements.map(e=>{assert.equal(e.type,'NumericLiteral');assert.ok(Number.isInteger(e.value)&&e.value>=0&&e.value<deps.length);used.add(e.value);return e.value;});
  let paths=indices.map(i=>deps[i]);
  if(after&&paths.includes(addedCss)){
   assert.ok(paths.includes('assets/DashboardView.js'),'CSS_PRELOAD_OUTSIDE_DASHBOARD');assert.equal(paths.filter(p=>p===addedCss).length,1);
   assert.equal(paths.filter(p=>p==='assets/_plugin-vue_export-helper.js').length,1,'DASHBOARD_SCOPE_HELPER_PRELOAD');
   paths=paths.filter(p=>p!==addedCss);cssChanges++;
  }
  if(after&&paths.includes('assets/_plugin-vue_export-helper.js')){
   assert.ok(paths.some(p=>['assets/DashboardView.js','assets/AsistenciaView.js'].includes(p)),'HELPER_PRELOAD_OUTSIDE_OWNERS');
   paths=paths.filter(p=>p!=='assets/_plugin-vue_export-helper.js');helperChanges++;
  }
  replacements.push({start:n.start,end:n.end,value:JSON.stringify(paths)});calls++;
 });
 assert.equal(used.size,deps.length,'UNUSED_PRELOAD_REFERENCE');
 assert.equal(cssChanges,after?1:0,'DASHBOARD_CSS_PRELOAD_COUNT');
 coverage.push({calls,references:used.size,cssChanges,helperChanges});
 for(const r of replacements.sort((a,b)=>b.start-a.start))text=text.slice(0,r.start)+r.value+text.slice(r.end);
 return {text,signature};
}
const previous=resolvePreloads(old[mains[0]].toString(),false),next=resolvePreloads(current[mains[1]].toString(),true);
assert.equal(previous.signature,next.signature,'PRELOAD_HELPER_CODE_CHANGED');
const js=files=>Object.fromEntries(Object.values(meta(files)).filter(x=>x.file.endsWith('.js')).map(x=>[x.file,files[x.file].toString()]));
const beforeJs=js(old),afterJs=js(current);beforeJs[mains[0]]=previous.text;afterJs[mains[1]]=next.text;
const logical=[...new Set(Object.keys(afterJs).map(strip))];
const helperName='assets/_plugin-vue_export-helper.js';
const priorLogical=[...new Set(Object.keys(beforeJs).map(strip))];
assert.deepEqual(logical.filter(p=>!priorLogical.includes(p)),[helperName],'UNEXPECTED_JS_EXTRACTION');
assert.ok(priorLogical.every(p=>logical.includes(p)),'JS_MODULE_REMOVED');
const helperPath=Object.keys(afterJs).find(p=>strip(p)===helperName),helperText=afterJs[helperPath];
const extracted=[];
for(const module of ['assets/AsistenciaView.js']){
 const oldPath=Object.keys(beforeJs).find(p=>strip(p)===module),newPath=Object.keys(afterJs).find(p=>strip(p)===module);
 const oldText=beforeJs[oldPath],newText=afterJs[newPath];
 const nodes=parse(oldText,{sourceType:'module'}).program.body,newNodes=parse(newText,{sourceType:'module'}).program.body;
 const matches=[];
 for(const declaration of nodes.filter(n=>n.type==='VariableDeclaration'))for(const item of declaration.declarations)if(item.init?.type==='ArrowFunctionExpression'&&oldText.slice(item.init.start,item.init.end).includes('__vccOpts'))matches.push({declaration,item});
 assert.equal(matches.length,1,'INLINE_SCOPE_HELPER_NOT_UNIQUE:'+module);
 const {declaration,item}=matches[0];assert.equal(item.id.type,'Identifier');
 const isolated='const '+oldText.slice(item.start,item.end)+';export{'+item.id.name+' as _};';
 proveLinkerOnly({before:{'assets/index-11111111.js':'const a=1;export{a as A};','assets/Helper-11111111.js':isolated},after:{'assets/index-22222222.js':'const a=1;export{a as A};','assets/Helper-22222222.js':helperText},oldMain:'assets/index-11111111.js',newMain:'assets/index-22222222.js',assets:['assets/Helper.js']});
 const imports=nodes.filter(n=>n.type==='ImportDeclaration'),newImports=newNodes.filter(n=>n.type==='ImportDeclaration');
 const index=newImports.findIndex(n=>strip('assets/'+n.source.value.split('/').at(-1))===helperName);
 assert.ok(index>=0);assert.equal(newImports.length,imports.length+1,'UNEXPECTED_EXTRACTION_IMPORTS');
 const binding=newImports[index];assert.equal(binding.specifiers.length,1);assert.equal(binding.specifiers[0].type,'ImportSpecifier');assert.equal(binding.specifiers[0].imported.name,'_');
 const synthetic='import{_ as '+item.id.name+'}from"./'+helperPath.split('/').at(-1)+'";';
 const at=index<imports.length?imports[index].start:imports.at(-1)?.end??0;
 const body=declaration.kind+' '+declaration.declarations.filter(n=>n!==item).map(n=>oldText.slice(n.start,n.end)).join(',')+';';
 assert.ok(declaration.declarations.length>1,'UNEXPECTED_HELPER_DECLARATION_SHAPE');
 const replacements=[{start:declaration.start,end:declaration.end,value:body},{start:at,end:at,value:synthetic}];
 let transformed=oldText;for(const r of replacements.sort((a,b)=>b.start-a.start))transformed=transformed.slice(0,r.start)+r.value+transformed.slice(r.end);
 beforeJs[oldPath]=transformed;extracted.push({module,inlineFunctionAlphaEquivalent:true,onlyBindingMovedToSharedHelper:true});
}
beforeJs[helperPath]=helperText;
const proof=proveLinkerOnly({before:beforeJs,after:afterJs,oldMain:mains[0],newMain:mains[1],assets:logical});
// El verificador compartido comprueba imports reales, metadata, hashes y estáticos.
// V2 añade únicamente CSS del Dashboard, sin extender permisos de otros módulos.
const python=String.raw`import runpy,pathlib,json,sys,hashlib
c=runpy.run_path('scripts/consolidation-release-contract.py')
def read(root):
 root=pathlib.Path(root);return {p.relative_to(root).as_posix():p.read_bytes() for p in root.rglob('*') if p.is_file()}
a,b=map(read,sys.argv[1:3]);ra,rb=[c['reachable'](x) for x in [a,b]]
groups=lambda paths:{c['stripname'](p):{x for x in paths if c['stripname'](x)==c['stripname'](p)} for p in paths}
ga,gb=map(groups,[ra,rb]);pinned=set()
for name in set(ga)|set(gb):
 if len(ga.get(name,()))>1 or len(gb.get(name,()))>1:
  assert ga.get(name)==gb.get(name),'AMBIGUOUS_ASSETS_CHANGED'
  for p in ga[name]:assert a[p]==b[p],'AMBIGUOUS_ASSET_BYTES_CHANGED'
  pinned.update(ga[name])
ma,mb=[c['validate_vite_manifest'](files,pinned) for files in [a,b]]
assert set(mb)-set(ma)=={'assets/_plugin-vue_export-helper.js'} and not set(ma)-set(mb),'UNEXPECTED_METADATA_ENTRY'
assert set(gb)-set(ga)=={'assets/DashboardView.css','assets/_plugin-vue_export-helper.js'} and not set(ga)-set(gb),'UNEXPECTED_GRAPH_TRANSITION'
assert ma['assets/DashboardView.js']['css']==[] and mb['assets/DashboardView.js']['css']==['assets/DashboardView.css'],'DASHBOARD_CSS_BINDING'
helper='assets/_plugin-vue_export-helper.js'
leaf=mb.pop(helper)
assert leaf=={'name':'_plugin-vue_export-helper','imports':[],'dynamicImports':[],'css':[],'assets':[]},'UNEXPECTED_HELPER_METADATA'
for owner in ['assets/DashboardView.js','assets/AsistenciaView.js']:
 assert helper not in ma[owner]['imports'] and set(mb[owner]['imports'])==set(ma[owner]['imports'])|{helper},'UNEXPECTED_HELPER_IMPORT:'+owner
 mb[owner]['imports'].remove(helper)
mb['assets/DashboardView.js']['css']=[]
assert ma==mb,'NON_DASHBOARD_METADATA_CHANGED'
for p in set(a)|set(b):
 if p not in ra|rb|{'index.html','release-manifest.json','.vite/manifest.json'}:assert a.get(p)==b.get(p),'UNRELATED_STATIC_CHANGED:'+p
assert c['normcontent'](a['index.html'])==c['normcontent'](b['index.html']),'HTML_CHANGED'
for name in set(ga)&set(gb):
 if name.endswith('.css'):assert name in ['assets/index.css'] or all(a.get(p)==b.get(p) for p in ga[name]|gb[name]),'NON_DASHBOARD_CSS_CHANGED:'+name
print(json.dumps({'status':'PASS','addedCss':'assets/DashboardView.css','allOtherMetadataIdentical':True,'compiledImportsAndArtifactHashesValid':True,'unrelatedStaticAssetsUnchanged':True,'htmlStructureUnchanged':True}))`;
const graph=JSON.parse(execFileSync('python',['-c',python,oldFolder,newFolder],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}));
const manifest=JSON.parse(current['release-manifest.json']);
const result={status:'PASS',sourceCommit:manifest.commit,sourceFiles:['src/components/dashboard/DashboardIcon.vue','src/components/dashboard/PppoeProfileCards.vue','src/components/dashboard/dashboard-v2.css','src/views/DashboardView.vue'],functionalAssets:['assets/DashboardView.js','assets/DashboardView.css','assets/index.css'],mainCodeUnchangedAfterResolvingPreloads:true,preloadCoverage:coverage,graph,helperExtraction:{module:helperName,sha256:hash(helperText),owners:extracted},protectedModules:proof.protectedModules,protectedModuleCount:proof.protectedModules.length,scopeResolvedAlphaEquivalence:true,artifactsModifiedByProof:false,manifestSha256:hash(current['release-manifest.json'])};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PASS',protectedModules:result.protectedModuleCount,mainCodeUnchanged:true,addedCss,artifactsModified:false}));
