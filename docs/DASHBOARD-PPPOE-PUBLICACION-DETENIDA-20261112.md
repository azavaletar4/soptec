# Publicación PPPoE detenida antes de construir o desplegar

**Estado: NO PUBLICADO / NO LISTO PARA REINTENTAR. Producción saludable, con sus imágenes anteriores.**

Autorización del usuario: publicar exclusivamente el paquete
`deploy/pppoe-20261112/`, con implementación `a4a5b41`, preparación `8875af0`
y fuentes aisladas `b3cdef65c2830c2f44270568d7038b342b68b3e6`.
Comprobación final: **12/11/2026, 14:17:30, horario Perú**.

## Resultado y motivo de parada

La comprobación inicial del paquete, respaldos y los cinco servicios pasó.
Las herramientas y los archivos de alcance, preparación, prueba de enlaces y
rollback coinciden con `8875af0`. Se ejecutó únicamente la fase `prepare` del
publicador existente con el scope y snapshot indicados en el procedimiento.
Creó staging privado, respaldos de imágenes y referencias de rollback; comprobó
su restauración sin arrancar las copias. No recreó servicios activos.

La comprobación inmediatamente posterior falló con **`PACKAGE_DRIFT:source.tar`**:

| Huella SHA-256 del archivo | Valor |
| --- | --- |
| Autorizado y validado antes de `prepare` | `9a31e1482afe364cdb74d4bab6fec5f54787583aa16133937164ce4a30c81965` |
| Regenerado y transferido por `prepare` | `ec1fdf08e6627346328900fa1c015deb625be1584fe23634b5e7c97b8926c8d0` |

**Se detuvo el procedimiento. No se ejecutaron `build`, `deploy` ni `rollback`.
No se actualizaron huellas para aceptar el archivo divergente ni se relajaron
controles.** El staging no contiene `built.json` ni `attempt.json`.

La causa está en el empaquetador: `frontend-consolidation-release.cjs` vuelve a
crear `source.tar` en `prepare`, sobrescribiendo el previamente validado, y
añade `release-source.json` mediante `tar.exe -rf`. Esa entrada incorpora
metadatos PAX del sistema de archivos, entre ellos `atime`, que puede cambiar
al leer el snapshot. El archivo original no se conservó por separado.

El diagnóstico posterior verifica que los **317 archivos** del TAR regenerado
coinciden byte a byte con el archivo Git de `b3cdef6` más el snapshot preparado;
`input.json`, snapshot y manifiesto del paquete siguen iguales. Esto descarta
una diferencia de contenido contra esas fuentes. Los metadatos variables son
una explicación de la divergencia binaria; sin el TAR original no se presenta
como una comparación directa y completa entre ambos archivos.

## Estado de producción

**Servicios e imágenes desplegados: ninguno.**

| Servicio | Imagen activa conservada |
| --- | --- |
| Backend | `sha256:87e442e9bdcf17fcd192dbe401fa533c5746e8fd96658b50e0fe24b175162001` |
| Frontend | `sha256:6ed5f7751bb2f8b7c26baf6bed8228c1c9ed695ef60a25c2ca676a36bbea923d` |

Backend, frontend, Caddy, Mongo y GenieACS conservan ID, imagen, hora de inicio,
estado en ejecución y huella de entorno originales. `/api/health` devuelve
`status: ok`. No hay reinicio de OLT, soporte, inventario o facturación ni
publicación de sus fuentes. Esto confirma continuidad del software anterior;
no equivale a una prueba funcional autenticada de cada módulo.

Las verificaciones posteriores de autenticación, navegación y comparación del
endpoint nuevo con CCR2116 **no se ejecutaron**, porque la versión candidata no
se publicó. Por la misma razón, no se presenta una validación en producción de
los cuatro perfiles o la exclusión de Morosos en esta ejecución. Las pruebas
locales de la preparación conservan su resultado anterior; no se construyó
una nueva candidata en esta ejecución.

Cero consultas a MikroTik, cero cambios de configuración de MikroTik, cero
escrituras en Supabase y cero migraciones realizadas por este procedimiento.
No se tocaron tablas de tráfico ni se guardaron lecturas PPPoE. Los schedulers
existentes permanecieron en ejecución, sin cambios.

## Respaldo y rollback

Los respaldos locales `.tar.gz` originales mantienen sus SHA-256 validados.
También se verificaron por lectura las nuevas copias completas en la VM:

`/opt/smartrayco-staging/frontend-consolidado-tr069-b3cdef6-d4ff4b8e1d/`

| Respaldo remoto | SHA-256 |
| --- | --- |
| `backend-before.image.tar` | `1396e3209f95005ce317935ec4febebcb4b607fc2d513f696a324be644ca749f` |
| `frontend-before.image.tar` | `5ac75dab0dd2d5be3b698a8bc4dbb761bb977fe5fb011576bf80338d2a192c98` |

`release.rollback.json` y las referencias a las imágenes originales están
disponibles en ese staging. **No corresponde ejecutar rollback ahora**:
los servicios nunca cambiaron y restaurarlos provocaría un reinicio innecesario.
No borrar ni reutilizar el staging de este intento.

## Condición para reintentar

Preparar y revisar por separado un ajuste mínimo del publicador que consuma
el archivo ya validado, sin regenerarlo durante la promoción. Si se necesita
regenerar el paquete, hacerlo antes de validarlo, conservar una copia inmutable
y obtener su nueva huella. El próximo intento requiere un staging nuevo y las
comprobaciones completas, incluida la coincidencia del build remoto con el
árbol probado localmente. No continuar con el archivo divergente ni con el
staging de este intento.

Evidencia legible por máquina: `deploy/pppoe-20261112/stopped-verification.json`.
Diagnóstico de solo lectura: `scripts/diagnostics/pppoe-publication-stopped.cjs`.
Los únicos cambios de este cierre son documentación y evidencia; no se modificó
código de producto ni el publicador autorizado.
