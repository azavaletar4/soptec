// Copia de laboratorio: nunca modifica mobile_app ni instala sobre la APK real.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import vue from '@vitejs/plugin-vue';
const root=fs.realpathSync.native(process.cwd());
const sourceCommit='bcb3ec4c432c6baa39f175cca115795d5ae1cd45';
const run=(bin,args,options={})=>execFileSync(bin,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,...options});
if(run('git',['diff','--name-only',sourceCommit,'--','src','mobile_app']).trim())throw Error('CANDIDATE_SOURCE_DRIFT');
const runtime=path.join(root,'scripts/inventory-auth-lab/runtime','android-iptv-'+Date.now());
fs.mkdirSync(runtime,{recursive:true});
run('git',['archive',sourceCommit,'--format=tar','--output='+path.join(runtime,'mobile.tar'),'mobile_app']);
run('tar.exe',['-xf','mobile.tar'],{cwd:runtime});
const mobile=path.join(runtime,'mobile_app');
for(const file of ['android/local.properties','android/gradlew.bat','android/gradle/wrapper/gradle-wrapper.jar'])fs.copyFileSync(path.join(root,'mobile_app',file),path.join(mobile,file));
const mainFile=path.join(mobile,'lib/main.dart'),original=fs.readFileSync(mainFile,'utf8');
let main=original.replace("https://panel.rayconetworks.com/","http://127.0.0.1:4176/scripts/android-iptv-lab/lab.html").replace("const String _panelHost = 'panel.rayconetworks.com';","const String _panelHost = '127.0.0.1';");
main=main.replace("final isOwnDomain = uri.host == _panelHost || uri.host.endsWith('.$_panelHost');","final isOwnDomain = uri.host == _panelHost && uri.port == 4176;");
main=main.replace('launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);','// Laboratorio: bloquear toda navegación externa, sin abrir otras apps.');
main=main.replace('final controller = WebViewController()','AndroidWebViewController.enableDebugging(true);\n    final controller = WebViewController()');
if(main===original||main.includes('panel.rayconetworks.com'))throw Error('LAB_HOST_NOT_ISOLATED');
fs.writeFileSync(mainFile,main);
const gradleFile=path.join(mobile,'android/app/build.gradle.kts');
fs.writeFileSync(gradleFile,fs.readFileSync(gradleFile,'utf8').replace('applicationId = "com.smartrayco.app"','applicationId = "com.smartrayco.iptvlab"'));
const manifestFile=path.join(mobile,'android/app/src/main/AndroidManifest.xml');
fs.writeFileSync(manifestFile,fs.readFileSync(manifestFile,'utf8').replace('android:label="SmartRayco"','android:label="IPTV LAB - NO PRODUCCION"').replace('android:usesCleartextTraffic="false"','android:usesCleartextTraffic="false"\n        android:networkSecurityConfig="@xml/lab_network_security"'));
const xml=path.join(mobile,'android/app/src/main/res/xml');fs.mkdirSync(xml,{recursive:true});
fs.writeFileSync(path.join(xml,'lab_network_security.xml'),'<network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain>127.0.0.1</domain></domain-config></network-security-config>');
process.env.NODE_ENV='production';process.env.VITE_USER_NODE_ENV='production';
await build({configFile:false,root,plugins:[vue()],resolve:{alias:{'@':path.join(root,'src')}},define:{
 'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://iptv-lab.invalid'),
 'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('synthetic-only'),
 '__LAB_SOURCE_COMMIT__':JSON.stringify(sourceCommit),
},logLevel:'error',build:{outDir:path.join(runtime,'web'),rollupOptions:{input:[path.join(root,'scripts/android-iptv-lab/lab.html'),path.join(root,'scripts/android-iptv-lab/legacy.html')]}}});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result={sourceCommit,runtime,mobile,web:path.join(runtime,'web'),packageId:'com.smartrayco.iptvlab',productionPackageId:'com.smartrayco.app',url:'http://127.0.0.1:4176/scripts/android-iptv-lab/lab.html',originalFlutterSha256:sha('mobile_app/lib/main.dart'),labFlutterSha256:sha(mainFile),nativeChanges:['URL/host loopback','ID y etiqueta separados','navegación externa bloqueada','depuración WebView','HTTP permitido solo en 127.0.0.1'],apkBuilt:false,physicalTestsExecuted:false,productionWrites:0};
fs.writeFileSync(path.join(runtime,'prepared.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
