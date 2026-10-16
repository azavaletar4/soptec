// Preparation only; refuses expired windows and never opens a Cloud connection.
process.chdir(require('node:path').resolve(__dirname,'..'));
const fs=require('fs'),crypto=require('crypto');const dir='scripts/inventory-auth-lab/runtime/';const window=JSON.parse(fs.readFileSync(dir+'fase162-authorization-window.json'));if(Date.now()+180000>Date.parse(window.deadline))throw Error('VENTANA_INSUFICIENTE');
const bundle=fs.readFileSync(dir+'fase162-installation-bundle.sql','utf8');if(crypto.createHash('sha256').update(bundle).digest('hex')!=='898c34ab4d0c9f44960af346e380ba4bef5a7f9c6d6b49cf58c08b24f7dc9d1b')throw Error('HASH');
const raw=fs.readFileSync(dir+'fase162-authorized-precheck.sql','utf8');const core=raw.slice(raw.indexOf('WITH targets AS'),raw.lastIndexOf(';ROLLBACK;'));const expected=JSON.parse(fs.readFileSync('docs/FASE162-PRECHECKS-OPERATIVOS-CLOUD.json','utf8').replace(/^\uFEFF/,''));
const clauses=['functions','tables','policies','types'].map(k=>`j->'${k}'=$approved$${JSON.stringify(expected[k])}$approved$::jsonb`);clauses.push("(j->>'origin')::boolean","(j->>'fase162_absent')::boolean",...['inventory_writer_locks','other_open_client_transactions','waiting_relation_locks','invalid_stock'].map(k=>`(j->>'${k}')::int=0`),"(j->>'historical_without_contract')::int=8");
const data=fs.readFileSync('scripts/tests/fase162-installation-data-check.sql','utf8');const post=fs.readFileSync('scripts/tests/fase162-installation-postcheck.sql','utf8').trim().replace(/;$/,'');
const sql=`\\set ON_ERROR_STOP on
BEGIN READ ONLY;
WITH observed(j) AS (${core}) SELECT ${clauses.join(' AND ')} AS pause_safe FROM observed
\\gset
ROLLBACK;
\\if :pause_safe
\\echo F162_GATE_PASSED
${data}
\\echo F162_BASELINE_END
${bundle}
\\echo F162_COMMIT_CONFIRMED
BEGIN READ ONLY;
WITH results AS (${post}) SELECT jsonb_build_object('stage','postchecks','rows',(SELECT jsonb_agg(to_jsonb(results)) FROM results));
ROLLBACK;
\\echo F162_POSTCHECKS_END
${data}
\\echo F162_AFTER_END
\\else
\\echo F162_ABORTED_UNSAFE
\\quit 9
\\endif
`;
fs.writeFileSync(dir+'fase162-authorized-install.sql',sql);
let ps=fs.readFileSync(dir+'fase162-authorized-precheck.ps1','utf8');ps=ps.replace("$stage='CONFIGURACION'",()=>`$window=Get-Content 'D:/SmartRayco/${dir}fase162-authorization-window.json' -Raw|ConvertFrom-Json
    if([DateTime]::UtcNow.AddSeconds(180) -gt [DateTime]::Parse($window.deadline).ToUniversalTime()){throw 'SAFE:VENTANA_INSUFICIENTE'}
    if(Test-Path 'D:/SmartRayco/${dir}fase162-install-attempt.json'){throw 'SAFE:INTENTO_PREVIO_NO_REPETIR'}
    $invoke=(Get-Command Invoke-PrivateDocker).ScriptBlock.ToString().Replace('$p.WaitForExit(60000)','$p.WaitForExit(150000)')
    Set-Item -LiteralPath Function:Invoke-PrivateDocker -Value ([scriptblock]::Create($invoke))
    $stage='CONFIGURACION'`);
ps=ps.replace('fase162-authorized-precheck.sql','fase162-authorized-install.sql').replace('-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=2000','-c default_transaction_read_only=off -c statement_timeout=60000 -c lock_timeout=2000 -c transaction_timeout=120000');
ps=ps.replace("$stage='DOCKER_SQL'",()=>`$stage='DOCKER_SQL'
    [IO.File]::WriteAllText('D:/SmartRayco/${dir}fase162-install-attempt.json',('{"started":"'+[DateTime]::UtcNow.ToString('o')+'"}'))`);
ps=ps.replace("    $stage='DOCKER_SQL'",()=>"    . 'D:/SmartRayco/scripts/fase162-executor-result.ps1'\n    $stage='DOCKER_SQL'");
const start=ps.indexOf('    if($response.Code -ne 0)');const end=ps.indexOf('} catch {',start);
ps=ps.slice(0,start)+`    [IO.File]::WriteAllText('D:/SmartRayco/${dir}fase162-install-output.txt',$response.Output)
    [IO.File]::WriteAllText('D:/SmartRayco/${dir}fase162-install-error.txt',$response.Error)
    $summary=Get-Fase162InstallationResult $response.Code $response.Output
    $summary | Add-Member -NotePropertyName at -NotePropertyValue ([DateTime]::UtcNow.ToString('o'))
    [IO.File]::WriteAllText('D:/SmartRayco/docs/FASE162-INSTALACION-CLOUD-RESULTADO.json',($summary|ConvertTo-Json))
    Write-Output ($summary|ConvertTo-Json -Compress)
    if(-not $summary.success){throw 'SAFE:INSTALACION_DETENIDA_REVISAR_EVIDENCIA'}
`+ps.slice(end);ps=ps.replace('no cambios remotos; errores originales ocultos','resultado remoto requiere inspeccion de solo lectura; no reintento automatico; errores originales ocultos');fs.writeFileSync(dir+'fase162-authorized-install.ps1',ps);
console.log('PREPARED_EXACT_BUNDLE_WITH_READ_ONLY_GATE');
