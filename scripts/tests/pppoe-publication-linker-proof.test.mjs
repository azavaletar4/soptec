import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proveLinkerOnly} from '../pppoe-publication-linker-proof.mjs';
const oldMain='assets/index-11111111.js',newMain='assets/index-22222222.js';
function fixture(){return {
 oldMain,newMain,assets:['assets/Other.js','assets/index.js'],
 before:{[oldMain]:'const a=1,b=2;export{a as A,b as B};',
 'assets/Other-11111111.js':'import{A as q,B as r}from"./index-11111111.js";function calc(q){return q+1}console.log(q,r,calc(2));'},
 after:{[newMain]:'const a=1,b=2;export{a as x,b as y};',
 'assets/Other-22222222.js':'import{y as n,x as m}from"./index-22222222.js";function changed(m){return m+1}console.log(m,n,changed(2));'},
};}
test('acepta solo renombrado de linker, bindings locales y orden de imports',()=>{
 const proof=proveLinkerOnly(fixture());assert.equal(proof.protectedModules.length,1);assert.equal(proof.artifactsModifiedByProof,false);
});
test('rechaza una constante distinta dentro de un componente ajeno',()=>{
 const f=fixture();f.after['assets/Other-22222222.js']=f.after['assets/Other-22222222.js'].replace('m+1','m+9');
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});
test('no confunde el parametro que oculta un import con el import exterior',()=>{
 const f=fixture();f.after['assets/Other-22222222.js']=f.after['assets/Other-22222222.js'].replace('return m+1','return n+1');
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});
test('rechaza cambio del simbolo importado aunque coincida el nombre local',()=>{
 const f=fixture();f.after['assets/Other-22222222.js']=f.after['assets/Other-22222222.js'].replace('y as n,x as m','x as n,y as m');
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});
test('rechaza logica nueva en el entrypoint compartido',()=>{
 const f=fixture();f.after[newMain]=f.after[newMain].replace('a=1','a=99');
 assert.throws(()=>proveLinkerOnly(f),/MAIN_FUNCTIONAL_CODE_CHANGED/);
});
test('conserva claves publicas y rechaza renombrarlas',()=>{
 const f=fixture();f.before['assets/Other-11111111.js']+='console.log({total:q});';f.after['assets/Other-22222222.js']+='console.log({total:m});';
 proveLinkerOnly(f);f.after['assets/Other-22222222.js']=f.after['assets/Other-22222222.js'].replace('{total:m}','{balance:m}');
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});
test('los nombres exportados publicos no se normalizan como variables locales',()=>{
 const f=fixture();f.before['assets/Other-11111111.js']+='export{q as publicValue};';f.after['assets/Other-22222222.js']+='export{m as publicValue};';
 proveLinkerOnly(f);f.after['assets/Other-22222222.js']=f.after['assets/Other-22222222.js'].replace('as publicValue','as differentApi');
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});

test('normaliza bindings de arrays sin inventar claves de objeto',()=>{
 const f=fixture();
 f.before['assets/Other-11111111.js']='const helper=(a,b)=>{const t=a.__vccOpts||a;for(const[k,v]of b)t[k]=v;return t};export{helper as _};';
 f.after['assets/Other-22222222.js']='const moved=(component,props)=>{const target=component.__vccOpts||component;for(const[key,value]of props)target[key]=value;return target};export{moved as _};';
 proveLinkerOnly(f);
});

test('rechaza intercambiar key/value de un binding de array',()=>{
 const f=fixture();
 f.before['assets/Other-11111111.js']='const helper=(a,b)=>{for(const[k,v]of b)a[k]=v;return a};export{helper as _};';
 f.after['assets/Other-22222222.js']='const helper=(a,b)=>{for(const[k,v]of b)a[v]=k;return a};export{helper as _};';
 assert.throws(()=>proveLinkerOnly(f),/UNRELATED_FUNCTIONAL_ASSET/);
});
