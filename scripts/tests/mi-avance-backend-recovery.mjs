import assert from 'node:assert/strict';
const result=[];
let ready=false;
for(let n=0;n<50;n++) {
 try {ready=(await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1000)})).status===200;} catch {}
 if(ready)break;
 await new Promise(r=>setTimeout(r,200));
}
assert(ready,'restored backend must become healthy');
for(const [path,status] of [['/api/health',200],['/api/soporte/ranking-tecnicos',401]]) {
 const r=await fetch('http://127.0.0.1:3000'+path,{signal:AbortSignal.timeout(5000)});
 assert.equal(r.status,status);
 if(path==='/api/health')assert.equal((await r.json()).status,'ok');
 result.push({path,status:r.status});
}
console.log(JSON.stringify({result:'PASS',network:'none',syntheticConfig:true,responses:result}));
