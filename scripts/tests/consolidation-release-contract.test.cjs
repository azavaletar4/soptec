// Python estándar de la VM, pruebas puras en memoria: sin Docker, datos ni tareas.
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const contract=fs.readFileSync('scripts/consolidation-release-contract.py','utf8');
const program=fs.readFileSync('scripts/frontend-consolidation-release.py','utf8');
const tests=fs.readFileSync('scripts/tests/consolidation-release-contract.test.py','utf8');
const input=contract+'\nRELEASE_PROGRAM='+JSON.stringify(program)+'\n'+tests;
const result=cp.spawnSync('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','-i',path.join(process.env.USERPROFILE,'.ssh','smartrayco-deploy'),'root@192.168.55.201','python3 -'],{input,encoding:'utf8',timeout:60000,windowsHide:true});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
