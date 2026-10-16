// Reloj público de laboratorio: no importa configuración, Auth, SQL ni aplicación.
import {createServer} from 'node:http';
if(process.env.LAB_GENERIC_CLOCK!=='1')throw Error('Activación explícita de laboratorio requerida');
const frame='event: invalidate\ndata: {"v":1}\n\n';
const clients=new Set();
const server=createServer((req,res)=>{
 res.sendDate=false;
 if(req.method==='GET'&&req.url==='/health'){res.end('GENERIC_LAB_CLOCK');return;}
 if(req.method!=='GET'||req.url!=='/events'){res.writeHead(404);res.end();return;}
 if(clients.size>=64){res.writeHead(503);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
 res.flushHeaders();clients.add(res);
 res.on('close',()=>clients.delete(res));res.on('error',()=>clients.delete(res));
});
// Un único reloj global. No se reinicia al conectar, revocar ni cambiar de usuario.
const clock=setInterval(()=>{
 for(const res of clients){
  if(res.destroyed||res.writableNeedDrain||res.writableLength>0){clients.delete(res);res.destroy();continue;}
  if(!res.write(frame)){clients.delete(res);res.destroy();}
 }
},10000);
server.listen(54388,'127.0.0.1',()=>console.log('GENERIC_CLOCK_READY 127.0.0.1:54388; periodo fijo 10000 ms; sin datos operativos'));
// Métricas solo IPC del runner, nunca en HTTP/SSE.
process.on('message',m=>{if(m==='stats')process.send?.({cpu:process.cpuUsage(),memory:process.memoryUsage(),connections:clients.size});});
const stop=()=>{clearInterval(clock);for(const res of clients)res.destroy();server.close(()=>process.exit(0));};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
