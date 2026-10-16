// Controlador exclusivo de laboratorio. Una sola orden visible; sin caché durable.
export function createGenericRefresh({load,clear,publish,state}){
 let generation=0,current=null,token='',blocked=false,online=true,visible=true,flight=null;
 let requests=0,completed=0,maxConcurrent=0,concurrent=0;
 const reset=()=>{generation++;flight?.abort();flight=null;clear();};
 async function refresh(){
  if(!current||!token||blocked||!online||!visible||flight)return;
  const g=generation,context=current,bearer=token,abort=new AbortController();flight=abort;
  requests++;concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);state('loading');
  try{
   const value=await load(context,bearer,abort.signal);
   if(g!==generation||abort.signal.aborted)return;
   publish(value);completed++;state('ready');
  }catch(e){
   if(g!==generation||abort.signal.aborted)return;
   clear();
   if(e?.status===401||e?.status===403){blocked=true;reset();state('blocked');}
   else state('unavailable');
  }finally{concurrent--;if(g===generation&&flight===abort)flight=null;}
 }
 return {
  setContext(context,bearer=''){reset();current=context;token=bearer;blocked=false;state(context?'idle':'signed-out');void refresh();},
  tick:refresh,
  retry(){if(!current||!online||!visible)return;blocked=false;reset();void refresh();},
  setOnline(value){if(online===value)return;online=value;if(!value){reset();state(blocked?'blocked':'offline');}},
  setVisible(value){if(visible===value)return;visible=value;if(!value)reset();else void refresh();},
  dispose(){reset();current=null;token='';blocked=true;},
  stats(){return {generation,blocked,online,visible,inFlight:!!flight,requests,completed,maxConcurrent};},
 };
}
