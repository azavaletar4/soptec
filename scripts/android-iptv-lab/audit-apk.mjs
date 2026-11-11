// Verifica el APK construido, sin instalarlo ni interactuar con el teléfono.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const file=path.resolve(process.argv[2]),config=JSON.parse(fs.readFileSync(file,'utf8'));
const apk=path.join(config.mobile,'build/app/outputs/apk/debug/app-debug.apk');
const aapt=args=>execFileSync('D:/Android/build-tools/36.0.0/aapt.exe',args,{encoding:'utf8',windowsHide:true});
const badging=aapt(['dump','badging',apk]),network=aapt(['dump','xmltree',apk,'res/xml/lab_network_security.xml']);
assert.match(badging,/package: name='com\.smartrayco\.iptvlab'/);
assert.match(badging,/application-label:'IPTV LAB - NO PRODUCCION'/);
assert.match(network,/C: "127\.0\.0\.1"/);
assert.equal((network.match(/E: domain \(/g)??[]).length,1);
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert.equal(sha('mobile_app/lib/main.dart'),config.originalFlutterSha256);
const normalized=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
assert.equal(normalized('mobile_app/pubspec.lock'),normalized(path.join(config.mobile,'pubspec.lock')));
const parsed={packageId:badging.match(/package: name='([^']+)'/)[1],minSdk:badging.match(/sdkVersion:'([^']+)'/)[1],targetSdk:badging.match(/targetSdkVersion:'([^']+)'/)[1],activity:badging.match(/launchable-activity: name='([^']+)'/)[1],nativeCode:badging.match(/native-code: (.*)/)?.[1]};
Object.assign(config,{apk,apkSha256:sha(apk),apkBytes:fs.statSync(apk).size,apkBuilt:true,apkMetadata:parsed,flutterLockfileUnchanged:true,productionFlutterUnchanged:true});
const webFiles={};
function walk(folder){for(const item of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(folder,item.name);if(item.isDirectory())walk(p);else webFiles[path.relative(config.web,p).replaceAll('\\','/')]=sha(p);}}
walk(config.web);config.webFiles=webFiles;config.webTreeSha256=createHash('sha256').update(JSON.stringify(webFiles)).digest('hex');
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
fs.writeFileSync(path.join(path.dirname(file),'apk-badging.txt'),badging);
fs.writeFileSync(path.join(path.dirname(file),'apk-network-security.txt'),network);
console.log(JSON.stringify({apk:config.apk,apkSha256:config.apkSha256,webTreeSha256:config.webTreeSha256,...parsed,flutterLockfileUnchanged:true,productionFlutterUnchanged:true,physicalAndroidExecuted:false}));
