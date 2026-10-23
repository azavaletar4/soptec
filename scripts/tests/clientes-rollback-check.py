"""Comprueba el rollback y emite comandos revisables. Nunca los ejecuta."""
import pathlib,json,hashlib,sys,importlib.util,shlex

root=pathlib.Path(sys.argv[1]).resolve()
backup=root/'backup' if (root/'backup').is_dir() else root
manifest=json.loads((backup/'manifest.json').read_text())
for name,meta in manifest['files'].items():
    p=backup/name;h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    assert p.stat().st_size==meta['bytes'] and h.hexdigest()==meta['sha256'],'BACKUP_HASH_MISMATCH'
spec=importlib.util.spec_from_file_location('image_verifier',root/'image-verifier.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
verification=module.verify_image_archive(backup/'frontend.image.tar',manifest['image'])
assert json.loads((backup/'rollback.override.json').read_text())['services']['frontend']['image']==manifest['image']
# Usar las rutas originales de Compose conserva su contexto .env. Primero
# verificar que sus hashes siguen siendo los respaldados; detener si difieren.
for i,name in enumerate(manifest['composeFiles']):
    p=pathlib.Path(name)
    if p.exists():assert hashlib.sha256(p.read_bytes()).hexdigest()==manifest['files']['compose-'+str(i)+'.yml']['sha256'],'LIVE_COMPOSE_DRIFT'
compose=['docker','compose']
for name in manifest['composeFiles']:compose+=['-f',name]
commands=[['docker','load','-i',str(backup/'frontend.image.tar')],
 compose+['-f',str(backup/'rollback.override.json'),'up','-d','--no-deps','--no-build','--pull','never','frontend']]
print(json.dumps({'check':'PASS','exactImage':verification['exactIdentity'],'image':manifest['image'],
 'commandsNotExecuted':[shlex.join(c) for c in commands],'requiresDeploymentApproval':True}))
