import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { config,sql,runtime,gateway,wait } from './common.mjs';
const c=config();
await wait(async()=> (await fetch(gateway+'/auth/v1/health')).ok);
const users={};
for(const account of c.accounts){
 const auth=createClient(gateway,c.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await auth.auth.signUp({email:account.email,password:account.password});
 if(error||!data.user?.id)throw Error('No se pudo crear cuenta ficticia: '+(error?.code??'sin usuario'));
 users[account.role]=data.user.id;
}
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const client=id(1),otherClient=id(2),contractA=id(3),contractB=id(4),otherContract=id(5);
const installation=id(10),ticket=id(11),otherInstallation=id(12),otherTicket=id(13);
const material='50000000-0000-0000-0000-000000000002',model='50000000-0000-0000-0000-000000000001',tv=id(6);
const assignedInstallation=id(20),assignedTicket=id(21),otherUnit=id(22);
sql(`insert into profiles(id,role,active) values ${Object.values(users).map(uid=>`('${uid}','TECNICO_RED',true)`).join(',')};
 insert into clients(id) values('${client}'),('${otherClient}');
 insert into service_contracts(id,client_id,contract_number,zone_id) values('${contractA}','${client}','LAB-A','${id(7)}'),('${contractB}','${client}','LAB-B','${id(7)}'),('${otherContract}','${otherClient}','LAB-AJENO','${id(7)}');
 insert into installations(id,status,client_id,contract_id) values('${installation}','scheduled','${client}','${contractA}'),('${otherInstallation}','scheduled','${otherClient}','${otherContract}');
 insert into tickets(id,status,client_id,contract_id) values('${ticket}','open','${client}','${contractB}'),('${otherTicket}','open','${otherClient}','${otherContract}');
 insert into job_assignees(job_type,job_id,technician_id,role) values
 ('installation','${installation}','${users.leader}','leader'),('installation','${installation}','${users.support}','support'),('installation','${installation}','${users.removed}','support'),
 ('ticket','${ticket}','${users.leader}','leader'),('ticket','${ticket}','${users.support}','support'),('ticket','${ticket}','${users.removed}','support'),
 ('installation','${otherInstallation}','${users.outsider}','leader'),('ticket','${otherTicket}','${users.outsider}','leader');
 update inventory_products set current_stock=100;insert into inventory_products(id,name,is_serialized) values('${tv}','Equipo ficticio Avería',true);
 insert into inventory_units(id,product_id,serial_number) values('${assignedInstallation}','${model}','LAB-ALTA'),('${assignedTicket}','${tv}','LAB-AVERIA'),('${otherUnit}','${tv}','LAB-AJENO');
 insert into inventory_unit_events(unit_id,to_status,client_id,contract_id,installation_id) values('${assignedInstallation}','assigned','${client}','${contractA}','${installation}');
 insert into inventory_unit_events(unit_id,to_status,client_id,contract_id,ticket_id) values('${assignedTicket}','assigned','${client}','${contractB}','${ticket}'),('${otherUnit}','assigned','${otherClient}','${otherContract}','${otherTicket}');
 insert into inventory_movements(product_id,movement_type,quantity,installation_id,reason) values('${material}','egreso',1,'${installation}','LAB material Alta'),('${material}','egreso',3,'${otherInstallation}','LAB ajeno');
 insert into inventory_movements(product_id,movement_type,quantity,ticket_id,reason) values('${material}','egreso',2,'${ticket}','LAB material Avería'),('${material}','egreso',4,'${otherTicket}','LAB ajeno');
 NOTIFY pgrst,'reload schema';`);
writeFileSync(runtime+'manifest.json',JSON.stringify({users,jobs:[
 {type:'installation',id:installation,clientId:client,contractId:contractA,unitId:assignedInstallation,label:'Alta ficticia asignada'},
 {type:'ticket',id:ticket,clientId:client,contractId:contractB,unitId:assignedTicket,label:'Avería ficticia asignada'},
 {type:'installation',id:otherInstallation,clientId:otherClient,contractId:otherContract,label:'Alta ficticia ajena'},
 {type:'ticket',id:otherTicket,clientId:otherClient,contractId:otherContract,label:'Avería ficticia ajena'},
]},null,2));
console.log('LAB_SEED_READY: cuatro usuarios Auth y cuatro órdenes, exclusivamente ficticios.');
