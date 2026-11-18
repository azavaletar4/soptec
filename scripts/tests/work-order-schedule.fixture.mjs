/** Servicio sintético en memoria del navegador, persistido SOLO en sessionStorage. */
export function fixture() {
  window.EventSource=class extends EventTarget { close() {} };
  const RealDate=Date;
  // En Tokio ya es 19; en Perú todavía 18. Los filtros deben usar el día peruano.
  window.Date=class extends RealDate {
    constructor(...args) {super(...(args.length?args:['2026-11-18T23:30:00Z']));}
    static now() {return new RealDate('2026-11-18T23:30:00Z').getTime();}
  };
  const techId=window.techId='00000000-0000-4000-8000-000000000003';
  const client={id:'20000000-0000-4000-8000-000000000001',first_name:'Cliente',last_name:'Sintético',phone:'999000000',address:'Dirección local'};
  const contract={id:'30000000-0000-4000-8000-000000000001',client_id:client.id,contract_number:'CTR-LOCAL',status:'active',service_type:'internet',installation_address:'Dirección contrato local',clients:client};
  const profile={id:techId,email:'local@example.invalid',full_name:'Técnico sintético',role:'TECNICO_RED',active:true};
  const defaults={created_at:'2026-10-01T15:00:00Z',updated_at:'2026-10-01T15:00:00Z',status:'pending',assigned_to:null,priority:'medium',points:10,
    client_id:client.id,contract_id:contract.id,clients:client,contracts:contract,assigned_profile:null,scheduled_date:null,scheduled_time:null,scheduled_start_at:null,scheduled_end_at:null,
    notes:null,description:null,rescheduled_to:null,resolved_at:null,closed_at:null,completed_at:null,installation_postponements:[],routine_returns:[],tipo_rutina:'planta_interna',subtipo:null};
  let db=JSON.parse(sessionStorage.getItem('schedule-fixture')||'null')||{tickets:[],installations:[],routines:[],job_assignees:[],clients:[client],service_contracts:[contract],profiles:[profile]};
  window.calls=[];window.locked=false;
  window.db=db;
  const persist=()=>sessionStorage.setItem('schedule-fixture',JSON.stringify(db));
  window.seedOrder=(type,patch={})=>{
    const table={ticket:'tickets',installation:'installations',routine:'routines'}[type];
    const row={...defaults,id:crypto.randomUUID(),title:`${type} local`,ticket_number:'AV-LOCAL',routine_number:'RUT-LOCAL',category:'averia',...patch};
    db[table].push(row);persist();return row.id;
  };
  window.resetOrders=()=>{for(const key of ['tickets','installations','routines','job_assignees'])db[key]=[];persist();};
  const real=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin===location.origin&&!url.pathname.startsWith('/api/'))return real(input,init);
    if(url.hostname!=='schedule.invalid'&&!url.pathname.startsWith('/api/'))throw Error('External network denied: '+url.origin);
    const method=init.method||(input instanceof Request?input.method:'GET');
    const body=init.body?JSON.parse(init.body):{};
    const headers=new Headers(init.headers||(input instanceof Request?input.headers:{}));
    const table=url.pathname.split('/').at(-1);
    window.calls.push({table,method,body,query:url.search,path:url.pathname});
    const result=(value,status=200,count=Array.isArray(value)?value.length:1)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,count-1)}/${count}`}});
    if(url.pathname.includes('/rpc/')) {
      if(table==='work_order_is_final')return result(window.locked);
      if(table==='inventory_order_read')return result({context:{actorId:techId,jobType:body.p_job_type,jobId:body.p_job_id,clientId:client.id,contractId:contract.id},items:[],next:null});
      if(table==='my_inventory_custody')return result({units:[],materials:[],pendingReturnRequests:[]});
      if(table==='my_field_progress') {
        const period={start:'2026-11-18T05:00:00Z',end:'2026-11-19T05:00:00Z',points:0};
        return result({asOf:new Date().toISOString(),timezone:'America/Lima',periods:{today:period,week:period,month:period},contributions:[]});
      }
      if(table==='my_field_job_points')return result([]);
      return result(null);
    }
    if(url.pathname.startsWith('/api/campo-inventory/')) {
      const [, ,jobType,jobId]=url.pathname.split('/');
      return result({context:{actorId:techId,jobType,jobId,clientId:client.id,contractId:contract.id},items:[],next:null});
    }
    if(url.pathname.startsWith('/api/'))return result([]);
    let rows=db[table]||[];
    for(const [key,value]of url.searchParams) {
      if(value.startsWith('eq.'))rows=rows.filter(r=>String(r[key])===value.slice(3));
      else if(value.startsWith('neq.'))rows=rows.filter(r=>String(r[key])!==value.slice(4));
      else if(value==='not.is.null')rows=rows.filter(r=>r[key]!=null);
      else if(value.startsWith('gte.'))rows=rows.filter(r=>r[key]>=value.slice(4));
      else if(value.startsWith('lte.'))rows=rows.filter(r=>r[key]<=value.slice(4));
    }
    if(method==='POST') {
      if(!['tickets','installations','routines','job_assignees'].includes(table))return result({message:'Unexpected synthetic write'},403);
      const row=table==='job_assignees'?{id:crypto.randomUUID(),...body,profile}:{...defaults,status:table==='tickets'?'open':'pending',id:crypto.randomUUID(),ticket_number:'AV-LOCAL',routine_number:'RUT-LOCAL',...body};
      if(!db[table])db[table]=[];db[table].push(row);
      if(table==='job_assignees') {
        const job=db[{ticket:'tickets',installation:'installations',routine:'routines'}[row.job_type]].find(r=>r.id===row.job_id);
        job.assigned_to=row.technician_id;job.assigned_profile=profile;
      }
      rows=[row];persist();
    } else if(method==='PATCH') {
      if(window.locked)return result({message:'Orden cerrada'},403);
      for(const row of rows)Object.assign(row,body);
      persist();
    } else if(!['GET','HEAD'].includes(method))return result({message:'Unexpected write'},403);
    if(headers.get('Accept')?.includes('vnd.pgrst.object'))return result(rows[0]??null);
    return result(rows);
  };
  window.setField=(label,value)=>{
    const form=document.querySelector('.modal-overlay form')||document.querySelector('[data-schedule-editor] form');
    const labelEl=[...form.querySelectorAll('label')].find(el=>el.textContent.trim().startsWith(label));
    const matches=labelEl?[...labelEl.querySelectorAll('input,select,textarea')]:[];
    if(labelEl&&!matches.length)for(let n=labelEl.nextElementSibling;n&&n.tagName!=='LABEL';n=n.nextElementSibling)if(n.matches('input,select,textarea'))matches.push(n);
    const el=form.querySelector(`[aria-label="${label}"]`)||matches.find(el=>el.tagName==='SELECT')||matches[0];
    if(!el)throw Error('Missing field '+label);
    el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  };
  window.clickText=(text,root=document)=>{
    const button=[...root.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
    if(!button)throw Error('Missing button '+text);button.click();
  };
}
