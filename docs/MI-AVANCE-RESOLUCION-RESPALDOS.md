# Mi Avance: resolución del bloqueo de imágenes — 20/10/2026

Actualización posterior: los dos pendientes solicitados (recuperación HTTP del
frontend y revisión visual móvil) quedaron cerrados en laboratorio, sin
despliegue. Véase [MI-AVANCE-CIERRE-DOS-PENDIENTES.md](MI-AVANCE-CIERRE-DOS-PENDIENTES.md).
Lo siguiente conserva el diagnóstico y los resultados históricos de esta etapa.

**El bloqueo original de identidad quedó resuelto, pero el candidato NO queda
certificado para retomar el despliegue.** Se detuvieron las comprobaciones
cuando el ensayo mínimo de recuperación y la auditoría visual no terminaron
correctamente, conforme a la instrucción de detenerse ante comprobaciones
que continúen fallando. No hubo push, migraciones ni despliegue.

## Causa raíz demostrada

El servidor usa Docker **29.8.1**. `docker image inspect` identifica el frontend
mediante un **índice OCI**, no mediante el objeto JSON de configuración:

| Objeto | SHA-256 |
| --- | --- |
| Índice OCI / ID exacto del frontend ejecutado | `21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c` |
| Configuración JSON de ese frontend | `e1f5a3c1ba24b6c6a5764c0bcb707a975cd823bf9c9a2ca93e1479582c92aae4` |

La comparación anterior tomaba `manifest.json[0].Config`, extraía su nombre
de archivo y exigía que fuera igual al ID del contenedor. Comparaba identidades
de objetos distintos. No era un problema de etiqueta ni una imagen distinta.

En el archivo original
`/opt/smartrayco-staging/mi-avance-20261020T160003Z/backup/frontend.image.tar`,
`index.json` referencia exactamente el índice `21e9c294…`. El hash calculado
sobre los bytes de ese índice coincide exactamente con el ID del contenedor.
Sus manifiestos incluyen el ejecutable linux/amd64 y una atestación.

## Corrección y respaldo de despliegue comprobados

`scripts/tests/mi-avance-image-verify.py` verifica:

- Un único índice raíz con el ID esperado exacto; no acepta otro digest por
  compartir etiqueta, configuración o capas.
- SHA-256 y tamaño real de cada objeto referenciado: índices, manifiestos,
  configuración, capas y objetos de atestación.
- Descriptores según su tipo; no interpreta el campo `config` del JSON de
  configuración como si fuera otro descriptor de manifiesto.
- Entradas regulares y únicas dentro del tar. No extrae archivos ni carga imágenes.

El procedimiento corregido está en `scripts/mi-avance-deployment-backup.py`.
Las condiciones de SHA base, checkout limpio, imágenes esperadas y capacidad
se conservan. No se relajó la identidad ni se modificaron servicios.

**Nuevo respaldo completo y verificado:**

`/opt/smartrayco-staging/mi-avance-20261020T160625Z/backup`

Resultado: `PREVIOUS_DEPLOYMENT_BACKUP_VERIFIED`, **117 archivos** con huellas
comprobadas, código anterior, configuración privada, assets, imágenes y override
de rollback. El directorio superior es privado, modo 0700; runtime.env, modo 0600.
Se conservó la copia parcial original.

| Imagen | ID exacto | Objetos verificados | Bytes de objetos verificados |
| --- | --- | ---: | ---: |
| Frontend | `sha256:21e9c2944a25660abb5611114b875d207e98e0ab779d2cfb0af759d1978b2e0c` | 16 | 30.382.577 |
| Backend | `sha256:0ee2ed7441fb08b66ecf437b3c1189c569449fac95a1842b692a43b4892f4466` | 16 | 295.887.462 |

No se confundió el digest del archivo tar con el digest de imagen. El manifiesto
privado del respaldo contiene además SHA-256 del archivo de cada exportación.

## PostgreSQL: restauración aislada PASS

Respaldo utilizado:

`C:\Users\USER\AppData\Local\SmartRaycoBackups\mi_avance_20261020_155830_e29392f9`

Se verificaron las huellas guardadas antes de restaurar. El ensayo usó una base
temporal en tmpfs, imagen `supabase/postgres:17.6.1.136`, `--network none`, sin
puertos publicados ni conexión a producción. Se restauraron roles sin contraseñas,
base completa, configuración y secuencias. Comparaciones aprobadas de huellas de
filas y catálogo de funciones, ACL, RLS, relaciones y roles.

Salida:

```text
RESTORE_PASS
RESTORE_ROWS_FUNCTIONS_ACL_RLS_RELATIONS_ROLES_PASS
RESTORE_ONLY_NO_MIGRATIONS_PASS
```

No se aplicó el candidato SQL ni el rollback en ese ensayo. No se repitieron las
pruebas de puntuación ya aprobadas. La lectura del directorio privado se realizó
esta vez con la autorización de herramienta correspondiente, sin alterar su ACL.

## Recuperación de contenedores: todavía no certificada

`scripts/mi-avance-image-recovery.ps1` copió ambos tar y el manifiesto al
subdirectorio privado `deployment-images` del respaldo local. Los hashes de
transferencia se comprueban antes de cargar cada imagen en Docker **local**.

El frontend cargó con su ID **exacto**, sin cambios de etiquetas de producción.
El primer `nginx -t` falló porque el contenedor aislado no tenía el DNS `backend`
de Compose. Se corrigió exclusivamente el entorno del ensayo mediante
`--add-host backend:127.0.0.1`, manteniendo la red deshabilitada.

El siguiente intento produjo:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
chown("/var/cache/nginx/client_temp", 101) failed (1: Operation not permitted)
nginx: configuration file /etc/nginx/nginx.conf test failed
```

El ensayo tiene `--cap-drop ALL`, mientras que Nginx intenta asignar el propietario
de su caché temporal. Esta restricción del ensayo impide completarlo. **No se
omitió el fallo ni se afirmó recuperación funcional.** La comprobación backend
todavía no se ejecutó porque el script se detuvo en frontend.

Pendiente para una continuación: revisar el ensayo contra los permisos reales
del contenedor y proporcionar únicamente la capacidad necesaria o directorios
temporales con propietarios correctos; conservar imagen, configuración, red
deshabilitada y verificación exacta de todos los digests. Ejecutar después ambas
comprobaciones. No iniciar la API ni sus schedulers contra producción.

## Organización móvil: revisión incompleta

Se inspeccionaron el componente real y la captura previa
[MI-AVANCE-MOVIL-LOCAL.png](MI-AVANCE-MOVIL-LOCAL.png). El candidato tiene una
ruta propia de campo para el técnico, encabezado Mi Avance, resumen Hoy/Semana/Mes,
ranking, custodia y sección Mis órdenes. Asistencia está plegada al final.
Operaciones de Hoy administrativa permanece en su componente separado.
No se modificaron componentes de aplicación en esta ejecución.

Se preparó el modo `--layout-only` de `scripts/tests/field-progress-browser.mjs`
con datos ficticios de tres órdenes pendientes (Alta, Avería, Rutina), una
atendida, nombres largos y captura de pantalla prevista para 320/360/390/412/1280.
No llama a producción; las conexiones externas permanecen bloqueadas.

**La auditoría no terminó y no generó las capturas nuevas.** Su aserción de orden
selecciona `main.querySelector('ul>li')`, que puede tomar una fila del historial
anidado de puntos en lugar de la lista principal de órdenes. El diagnóstico fue:

```text
points=92; ranking=333.5; custody=390.5; orders=448.5;
firstOrder=400.5; secondary=1321.46875
```

Antes de esa aserción, a 320 px pasaron los controles de ancho horizontal,
recorte de texto y ausencia de enlaces/controles administrativos. Esto **no**
certifica los otros anchos ni demuestra un defecto de orden en la aplicación:
la referencia a primera orden del verificador es incorrecta. Debe acotarse a
la lista principal y reejecutarse antes de afirmar PASS o publicar evidencia.
No se sustituyeron las capturas anteriores por evidencia parcial.

## Rollback preparado, no ejecutado

Con imágenes disponibles y configuración intacta, el comando preparado es:

```sh
cd /opt/smartrayco
docker compose -f docker-compose.onprem.yml -f /opt/smartrayco-staging/mi-avance-20261020T160625Z/backup/rollback.override.json up -d --no-deps --no-build --pull never frontend backend
```

Si las imágenes hubieran desaparecido del daemon, antes correspondería cargar
sus tar verificados con `docker load --input`, comprobar los IDs exactos y recién
entonces recuperar contenedores. **Ninguno de estos comandos se ejecutó en
producción.** No se hizo reset Git, prune ni recreación de dependencias.

La recuperación PostgreSQL certificada aquí es una restauración aislada del
respaldo. No autoriza restaurar la base completa sobre producción ni reemplaza
el rollback SQL específico ya aprobado en docs/sql.

## Archivos y estado final

- Nuevos: este informe; `scripts/mi-avance-deployment-backup.py`;
  `scripts/tests/mi-avance-image-verify.py`; `scripts/mi-avance-image-recovery.ps1`.
- Ajustados: `scripts/mi-avance-backup.ps1` (verificación previa de hashes),
  `scripts/tests/mi-avance-backup-restore.sh` (solo restauración, sin candidato),
  `scripts/tests/field-progress-browser.mjs` (modo visual focalizado),
  referencia de estado en MI-AVANCE-DESPLIEGUE-CONTROLADO.md.
- Auxiliares ignorados en runtime: diagnósticos SSH y ensamblado del verificador.
- Sin cambios a SQL de puntuación, permisos, frontend/backend de aplicación,
  datos operativos ni archivos pendientes ajenos.
- Sin commits nuevos, push, migraciones o despliegue. Producción observada en
  `40cd3967b573db0d8379e2df67449584ab10051b`, contenedores originales sin reinicios.

**No listo aún:** falta terminar recuperación de ambas imágenes y auditoría
visual con capturas nuevas. Android físico tampoco fue validado. No continuar
la activación basándose únicamente en que el problema original de digest quedó
resuelto.
