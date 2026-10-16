// Adaptador psql exclusivo del laboratorio: no descarga drivers ni abre el DB al host.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {project,config} from './common.mjs';
export class LabPgSession {
 constructor(){
  config();this.healthy=true;this.buffer='';this.pending=null;
  this.child=spawn('docker',['exec','-i',project+'-db','psql','-U','lab_sse_backend','-d','inventory_lab','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const fail=()=>{this.healthy=false;if(this.pending){this.pending.reject(Error('Sesión SQL cerrada o denegada'));this.pending=null;}this.onFailure?.();};
  this.child.once('error',fail);this.child.once('exit',fail);
  this.child.stderr.on('data',chunk=>{this.lastError=chunk.toString().slice(0,800);fail();});
  this.child.stdout.setEncoding('utf8');
  this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;
   let pos;
   while((pos=this.buffer.indexOf('\n'))>=0){
    const line=this.buffer.slice(0,pos).trimEnd();this.buffer=this.buffer.slice(pos+1);
    if(this.pending){if(line===this.pending.marker){const p=this.pending;this.pending=null;p.resolve(p.lines.join('\n'));}else if(line)this.pending.lines.push(line);}
   }
  });
 }
 run(statement){
  if(!this.healthy)return Promise.reject(Error('SQL no disponible'));
  if(this.pending)return Promise.reject(Error('Sesión SQL ocupada'));
  return new Promise((resolve,reject)=>{
   const marker='sse_'+randomUUID().replaceAll('-','');
   this.pending={marker,lines:[],resolve,reject};
   this.child.stdin.write(statement+`;\nselect '${marker}';\n`);
  });
 }
 close(){this.onFailure=null;this.healthy=false;this.child.stdin.end('rollback;\n\\q\n');}
}
