// Inventario técnico del dispositivo. No abre apps, instala ni lee sus datos.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const adb='D:/Android/platform-tools/adb.exe';
const run=args=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true,timeout:15000}).trim();
const list=run(['devices','-l']).split(/\r?\n/).slice(1).filter(Boolean).map(line=>{const [serial,status,...detail]=line.trim().split(/\s+/);return {serial,status,detail:detail.join(' ')};});
const usable=list.filter(x=>x.status==='device'&&!x.serial.startsWith('emulator-'));
const report={at:new Date().toISOString(),adbVersion:run(['version']).split(/\r?\n/).slice(0,2),devices:list.map(({serial,status,detail})=>({serialSha256:createHash('sha256').update(serial).digest('hex'),status,detail})),physicalAndroidExecuted:false,productionAppOpened:false,productionStorageRead:false,productionWrites:0};
if(usable.length===1){
 const serial=usable[0].serial,device=(...args)=>run(['-s',serial,...args]);
 report.android={manufacturer:device('shell','getprop','ro.product.manufacturer'),model:device('shell','getprop','ro.product.model'),release:device('shell','getprop','ro.build.version.release'),sdk:device('shell','getprop','ro.build.version.sdk'),abis:device('shell','getprop','ro.product.cpu.abilist')};
 report.webviewUpdate=device('shell','dumpsys','webviewupdate');
 report.raycoPackages=device('shell','pm','list','packages','com.smartrayco').split(/\r?\n/).filter(Boolean);
 report.next='Dispositivo identificado; aún no ejecutó pruebas de aplicación.';
}else report.next=usable.length>1?'Seleccionar un solo celular físico para evitar actuar sobre otro equipo.':'Conectar por USB, desbloquear y autorizar depuración USB. No abrir ni borrar Campo.';
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
