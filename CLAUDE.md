# SmartRayco — guía para Claude Code

## Antes de empezar

Lee primero `ESTADO_DESARROLLO.md` (raíz del repo) — tiene el estado real
(implementado/desplegado/pendiente), la arquitectura, el último commit
desplegado y los riesgos/trabajos pendientes conocidos. Evita repetir
análisis ya hecho. Mantenlo actualizado al final de cada sesión relevante
(qué cambió, qué quedó pendiente, próximo paso recomendado) — es la
referencia compartida entre Claude Code y ChatGPT para este proyecto.

## Contexto

SmartRayco está en fase de pruebas operativas reales (octubre 2026). Técnicos y
administradores lo usan en campo. Clientes, servicios y datos son reales —
protegerlos siempre (ver regla 13).

## Modo de desarrollo y validación eficiente

Objetivo: detectar, corregir y validar problemas sin auditorías completas en
cada modificación — reducir trabajo/tokens redundantes, no bajar el estándar
de calidad.

1. Antes de modificar código, identifica únicamente el módulo y los archivos
   relacionados (usa Grep/Glob dirigido, no una exploración amplia).
2. No leas todo el repositorio si el problema está localizado.
3. No repitas análisis que ya estén documentados — revisa primero
   `docs/ERRORES-CAMPO.md` y la memoria de proyecto.
4. Usa primero las pruebas automatizadas existentes (`npm pkg get scripts`
   para ver las disponibles: `test:telnet`, `test:provisioning`,
   `test:fetch-timeout`, `test:nap-sql`, `test:single-active-job-sql`, etc.)
   antes de escribir pruebas nuevas desde cero.
5. Al corregir un error funcional, crea una prueba de regresión pequeña y
   reutilizable — para RPCs/triggers de Supabase, sigue el patrón de
   `server/tests/*.sql.test.ts` (Postgres real en Docker, aislado, con el
   archivo de migración real cargado tal cual).
6. Usa mocks y datos sintéticos para pruebas que puedan modificar
   información real. Nunca ejecutes escrituras de prueba contra Supabase de
   producción, la OLT real ni MikroTik real.
7. Evita generar documentación HTML o informes extensos para correcciones
   menores — un resumen de texto alcanza.
8. No repitas compilaciones (`vue-tsc`, `tsc`, `npm run build`) si los
   archivos relevantes no cambiaron desde la última corrida.
9. No ejecutes suites completas salvo que el alcance o el riesgo lo
   justifique — corre primero solo el/los scripts de prueba del módulo
   tocado.
10. Resume resultados en un máximo de 10 líneas, salvo errores importantes.
11. No muestres logs completos si basta con indicar el resultado y las
    líneas relevantes del error.
12. No hagas preguntas cuando el problema se pueda resolver con la
    arquitectura existente — pregunta solo ante una decisión que de verdad
    requiera al usuario (dato ambiguo, cambio que afecte datos/equipos
    reales, alcance fuera de lo pedido).
13. Datos reales protegidos siempre: nunca un `UPDATE`/`DELETE` de prueba
    contra Supabase de producción, la OLT real (10.15.15.2) ni MikroTik
    real. Confirmar el destino antes de cualquier escritura en vivo.
14. Revisar primero si una funcionalidad ya existe (y cómo) antes de
    implementarla — buscar en el código, no asumir desde memoria ni desde
    un prompt anterior. No duplicar funciones/componentes ya existentes.
15. Comentarios/commits en español, consistente con el resto del proyecto.
    Commit solo después de pasar las pruebas correspondientes al cambio.
16. **Nunca aplicar una migración en Supabase de producción ni ejecutar
    `bash deploy/update.sh` en la VM sin que el usuario lo pida
    explícitamente en ese mismo turno** — "implementa esto" o "corrige
    esto" NO es autorización para migrar/desplegar; esperar un pedido
    explícito tipo "aplica la migración y despliega". Esto aplica incluso
    si ya se desplegó algo similar antes en la misma sesión.

## Validación por niveles

- **Nivel 1** (cambio cosmético/UI acotado): prueba localizada + comprobación
  visual.
- **Nivel 2** (cambio funcional de un módulo): pruebas del módulo + validación
  backend + comprobación en campo (pedir al usuario que lo pruebe si aplica).
- **Nivel 3** (cambio estructural/BD/multi-módulo): pruebas de integración +
  respaldo + revisión de riesgos + reversión preparada antes de aplicar.

Elige el nivel según el riesgo real del cambio, no automáticamente el más alto.

## Migración OLT — vínculo cliente/contrato/ONT (permanente)

SmartRayco está migrando gradualmente la administración desde SmartOLT y
registros anteriores — faltan ~400 abonados por registrar (2026-10-13).
Mientras dure esa migración, **toda sesión debe consultar esto antes de
tocar flujos de OLT, clientes o aprovisionamiento** — ver el caso real
documentado en `ESTADO_DESARROLLO.md` (Violeta García Silva / Clara
Caballero Valderrama / Mayco Paredes Rodríguez) para el precedente
completo.

**Tres situaciones posibles, permanentes mientras dure la migración:**

- **A — ONT online sin cliente/contrato en SmartRayco**: el abonado puede
  ser real y estar navegando normalmente; su info administrativa
  simplemente no se migró todavía. **Nunca asumir** que es una ONT
  abandonada, duplicada o disponible para eliminar.
- **B — Cliente y contrato registrados, pero sin ONT vinculada**: el
  abonado existe en SmartRayco, falta relacionar su ONT física. No
  implica necesariamente que esté sin servicio — verificar serial,
  posición, contrato y PPPoE antes de vincular.
- **C — Cliente, contrato y ONT correctamente vinculados**: igual hay que
  distinguir el estado real de la OLT del último `last_synced_at` de
  SmartRayco — no son lo mismo.

**Reglas permanentes:**

1. La OLT real es la referencia para serial, posición y estado físico
   — siempre que la consulta sea actual y verificable (no asumir desde
   una lectura vieja).
2. Supabase es la referencia para clientes, contratos y sus relaciones
   administrativas.
3. Nunca eliminar ni desautorizar una ONT solo porque aparece sin
   cliente vinculado (Situación A) — eliminar su fila en `olt_onts`
   también manda `no onu` a la OLT real y corta el servicio.
4. No duplicar clientes, contratos, usuarios PPPoE ni equipos durante
   la migración — buscar primero si ya existe (por nombre, documento,
   serial) antes de crear algo nuevo.
5. No reprovisionar una ONT que ya navega solo para completar
   información administrativa — vincular `client_id`/`contract_id` es
   una escritura de metadatos en Supabase, nunca requiere volver a
   autorizar/registrar en la OLT.
6. No sobrescribir nombres o descripciones administrativas sin
   comprobar su procedencia — un `description` puede venir de la OLT
   (texto libre, no confiable) o de una edición administrativa real.
7. Mantener intactos los servicios existentes durante toda la
   migración — cualquier corrección se valida de solo lectura primero.
8. Si hay discrepancia entre lo que dice la OLT y lo que dice
   Supabase, **detener la operación y pedir verificación** — no
   adivinar cuál de las dos fuentes tiene razón.
9. Solo usamos 3 roles operativos reales: **SUPERADMIN, ADMIN y
   TECNICO_RED** — SOPORTE/FACTURACION no se usan; no desarrollar
   funcionalidades nuevas para ellos ni tocar sus políticas existentes.

## Registro de errores de campo

Todo bug reportado desde campo (técnicos/administradores usando el sistema
real) se registra en `docs/ERRORES-CAMPO.md` — ver ese archivo por el
formato. Revisarlo antes de investigar un problema nuevo: puede que ya esté
documentado.
