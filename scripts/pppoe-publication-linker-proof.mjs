// Compara sin modificar assets. Prueba que los JS ajenos solo renombraron
// aliases import/export de Rollup hacia el mismo simbolo del mismo modulo.
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createHash } from 'node:crypto';
const strip = value => value.replace(/^(.*?)-[\w-]{8,12}(\.(?:js|css))$/, (_,name,ext)=>name+ext);
const normalize = value => value.replace(/([\w.\-]+?)-[\w-]{8,12}(\.(?:js|css))/g,(_,name,ext)=>name+ext);
const ast = value => parse(value,{sourceType:'module'}).program.body;
export function proveLinkerOnly({before,after,oldMain,newMain,assets}) {
  const oldText=before[oldMain],newText=after[newMain];
  const exportsOf=text=>ast(text).filter(node=>node.type==='ExportNamedDeclaration'&&!node.source&&node.specifiers.length);
  const oldExports=exportsOf(oldText),newExports=exportsOf(newText);
  assert.equal(oldExports.length,1);assert.equal(newExports.length,1);
  const oldNode=oldExports[0],newNode=newExports[0];
  const remove=(text,node)=>text.slice(0,node.start)+text.slice(node.end);
  assert.equal(normalize(remove(newText,newNode)),normalize(remove(oldText,oldNode)),'MAIN_FUNCTIONAL_CODE_CHANGED');
  const pairs=node=>node.specifiers.map(spec=>{
    assert.equal(spec.local.type,'Identifier');assert.equal(spec.exported.type,'Identifier');
    return [spec.local.name,spec.exported.name];
  });
  const oldMap=new Map(pairs(oldNode)),newMap=new Map(pairs(newNode));
  assert.deepEqual([...newMap.keys()].sort(),[...oldMap.keys()].sort(),'MAIN_EXPORT_SYMBOLS_CHANGED');
  const aliases=new Map([...newMap].map(([local,exported])=>[exported,oldMap.get(local)]));
  const locate=(files,name)=>{
    const matches=Object.keys(files).filter(file=>strip(file)===name);
    assert.equal(matches.length,1,'AMBIGUOUS_COMPILED_MODULE:'+name);return matches[0];
  };
  const protectedModules=[];
  const canonicalImports=(text,coreAliases)=>{
    assert.ok(!/\b__pppoe_proof_/.test(text),'PROOF_NAMESPACE_COLLISION');
    const options={allowJs:true,noResolve:true,noLib:true,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext};
    const sf=ts.createSourceFile('/proof.js',normalize(text),ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
    const host=ts.createCompilerHost(options);host.getSourceFile=name=>name==='/proof.js'?sf:undefined;
    const program=ts.createProgram(['/proof.js'],options,host),checker=program.getTypeChecker();
    const symbols=new Map(),imports=new Map();
    for(const node of sf.statements){
      if(!ts.isImportDeclaration(node))continue;
      assert.ok(!node.attributes,'UNEXPECTED_IMPORT_ATTRIBUTES');
      const module=node.moduleSpecifier.text,core=strip(module.split('/').at(-1))==='index.js';
      const register=(binding,name)=>{
        const symbol=checker.getSymbolAtLocation(binding);assert.ok(symbol,'UNRESOLVED_IMPORT_BINDING');
        const imported=core&&coreAliases&&name!=='default'&&name!=='*'?coreAliases.get(name):name;
        assert.ok(imported,'UNKNOWN_CORE_EXPORT');
        const stable='__pppoe_proof_import_'+createHash('sha256').update(JSON.stringify([module,imported])).digest('hex');
        symbols.set(symbol,stable);return {imported,stable};
      };
      const clause=node.importClause;let defaultName,bindings;
      if(clause?.name)defaultName=ts.factory.createIdentifier(register(clause.name,'default').stable);
      if(clause?.namedBindings){
        if(ts.isNamespaceImport(clause.namedBindings))bindings=ts.factory.createNamespaceImport(ts.factory.createIdentifier(register(clause.namedBindings.name,'*').stable));
        else bindings=ts.factory.createNamedImports(clause.namedBindings.elements.map(spec=>{
          const entry=register(spec.name,(spec.propertyName??spec.name).text);
          return ts.factory.createImportSpecifier(false,ts.factory.createIdentifier(entry.imported),ts.factory.createIdentifier(entry.stable));
        }).sort((a,b)=>a.propertyName.text.localeCompare(b.propertyName.text)));
      }
      imports.set(node,ts.factory.createImportDeclaration(undefined,clause?ts.factory.createImportClause(false,defaultName,bindings):undefined,ts.factory.createStringLiteral(module)));
    }
    // El minificador tambien reasigna nombres locales al cambiar sus imports.
    // Resolver simbolos distingue referencias, sombras y claves publicas.
    let bindingIndex=0;
    const registerBinding=name=>{
      if(ts.isIdentifier(name)){
        const symbol=checker.getSymbolAtLocation(name);assert.ok(symbol,'UNRESOLVED_LOCAL_BINDING');
        if(!symbols.has(symbol))symbols.set(symbol,'__pppoe_proof_binding_'+bindingIndex++);
      }else for(const item of name.elements)if(ts.isBindingElement(item))registerBinding(item.name);
    };
    const bindings=node=>{
      if(ts.isImportDeclaration(node))return;
      assert.ok(!node.modifiers?.some(mod=>mod.kind===ts.SyntaxKind.ExportKeyword),'UNEXPECTED_DIRECT_EXPORT');
      if((ts.isVariableDeclaration(node)||ts.isParameter(node))&&node.name)registerBinding(node.name);
      if((ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||ts.isClassDeclaration(node)||ts.isClassExpression(node))&&node.name)registerBinding(node.name);
      ts.forEachChild(node,bindings);
    };bindings(sf);
    const transformed=ts.transform(sf,[context=>{
      const visit=node=>{
        if(imports.has(node))return imports.get(node);
        if(ts.isShorthandPropertyAssignment(node)){
          const stable=symbols.get(checker.getShorthandAssignmentValueSymbol(node));
          if(stable)return ts.factory.createPropertyAssignment(node.name.text,ts.factory.createIdentifier(stable));
        }
        if(ts.isBindingElement(node)&&ts.isObjectBindingPattern(node.parent)&&!node.propertyName&&!node.dotDotDotToken&&ts.isIdentifier(node.name)){
          const stable=symbols.get(checker.getSymbolAtLocation(node.name));
          if(stable)return ts.factory.updateBindingElement(node,node.dotDotDotToken,ts.factory.createIdentifier(node.name.text),ts.factory.createIdentifier(stable),node.initializer?ts.visitNode(node.initializer,visit):undefined);
        }
        if(ts.isExportSpecifier(node)){
          const stable=symbols.get(checker.getExportSpecifierLocalTargetSymbol(node));
          if(stable)return ts.factory.createExportSpecifier(false,ts.factory.createIdentifier(stable),node.name);
        }
        if(ts.isIdentifier(node)){
          const stable=symbols.get(checker.getSymbolAtLocation(node));
          if(stable)return ts.factory.createIdentifier(stable);
        }
        return ts.visitEachChild(node,visit,context);
      };return node=>ts.visitNode(node,visit);
    }]);
    const result=ts.createPrinter({removeComments:true,newLine:ts.NewLineKind.LineFeed}).printFile(transformed.transformed[0]);
    transformed.dispose();return result;
  };
  for(const logical of assets){
    if(['assets/DashboardView.js','assets/index.css','assets/index.js'].includes(logical))continue;
    assert.ok(logical.endsWith('.js'),'UNRELATED_NON_JS_ASSET:'+logical);
    const oldPath=locate(before,logical),newPath=locate(after,logical);
    const previous=before[oldPath],current=after[newPath];
    assert.ok(canonicalImports(current,aliases)===canonicalImports(previous,null),'UNRELATED_FUNCTIONAL_ASSET:'+logical);
    protectedModules.push({module:logical,onlyGeneratedBindingsChanged:true});
  }
  return {mainBodyIdentical:true,sameExportSymbols:oldMap.size,scopeResolvedAlphaEquivalence:true,protectedModules,
    functionalAssets:['assets/DashboardView.js','assets/index.css'],artifactsModifiedByProof:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [oldFolder,newFolder,scopeFile,output]=process.argv.slice(2);
  const meta=folder=>JSON.parse(fs.readFileSync(path.join(folder,'.vite/manifest.json'),'utf8'));
  const read=folder=>Object.fromEntries(Object.values(meta(folder)).filter(row=>row.file.endsWith('.js')).map(row=>[row.file,fs.readFileSync(path.join(folder,row.file),'utf8')]));
  const main=folder=>Object.values(meta(folder)).find(row=>row.isEntry).file;
  const result=proveLinkerOnly({before:read(oldFolder),after:read(newFolder),oldMain:main(oldFolder),newMain:main(newFolder),assets:JSON.parse(fs.readFileSync(scopeFile,'utf8')).frontendAssets});
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({linkerProof:'PASS',protectedModules:result.protectedModules.length,mainBodyIdentical:true,artifactsModified:false}));
}
