# Despliegue seguro por commit explícito (`deploy/safe-update.sh`)

**Estado: commits ya publicados en `origin/main` (push verificado el
18/10/2026). Script todavía NO está en la VM ni se ejecutó nada contra
ella — falta el bootstrap (sección siguiente) y autorización explícita
para esa transferencia y para el primer uso real.**

Referencia: incidente del 18/10/2026 documentado en
`docs/TECNICOS-ACTIVOS-ASIGNADO-INCIDENTE-ALCANCE.md` — un `git pull
--ff-only` sobre una VM que estaba muchos commits detrás de `origin/main`
arrastró 4 fases completas nunca antes desplegadas, no solo el commit
autorizado ese día.

## Qué cambia

`deploy/update.sh` **no se modificó ni se borró** — sigue intacto, tal cual
estaba. Se agregó un script nuevo, independiente, como alternativa:
`deploy/safe-update.sh <commit-sha>`.

Diferencia clave: en vez de "traé lo que haya en `main`" (`git pull
--ff-only`), exige el commit exacto a desplegar y valida el estado del
repositorio ANTES de tocar nada.

## Qué valida, en orden, antes de aplicar cualquier cambio

1. **`git fetch origin`** — nunca asume que el remoto local ya está al día.
2. Resuelve y muestra **el commit actual (HEAD)** y **el commit
   solicitado** (y falla con un mensaje claro si el SHA/tag no existe).
3. **Bloquea si hay cambios locales sin commitear** en el checkout
   (`git status --porcelain` no vacío) — evita perder trabajo en curso.
4. **Bloquea si el commit actual no es ancestro de `origin/main`**
   (divergencia — alguien hizo un commit o un reset manual directo en la
   VM).
5. **Bloquea si el commit solicitado no está en el historial de
   `origin/main`** — nunca despliega algo que no pasó por el repositorio
   remoto compartido.
6. **Bloquea si el commit solicitado no es un avance (fast-forward) desde
   el commit actual** — nunca "despliega" hacia atrás con este mecanismo
   (eso es un rollback, flujo separado).
7. Muestra la **lista completa de commits entrantes** (`git log --oneline
   actual..solicitado`) y el **diff de archivos** que cambiarían.
8. **Bloquea si hay más de 1 commit entrante**, salvo que se indique
   explícitamente `DEPLOY_ALLOW_MULTI_COMMIT=1` — este es el control
   central que impide que entre "todo lo acumulado en `main`" sin que
   alguien lo vea y lo autorice a propósito.
9. Pide escribir **`si`** para confirmar (salvo `DEPLOY_YES=1`, pensado
   para uso no interactivo ya autorizado de antemano).
10. Recién ahí: crea un **tag de rollback** (`rollback-<timestamp>`) +
    `.last_rollback_tag` (mismo formato que ya usa la VM hoy, y ahora
    **ignorado por git** — ver corrección del 18/10/2026 más abajo) y
    **respalda las imágenes Docker actuales** de `frontend`/`backend` con
    ese mismo tag antes de reconstruir — para que un rollback no dependa de
    que `docker image prune` no haya borrado la imagen anterior.
11. Aplica el *fast-forward* (`git merge --ff-only`) y recién ahí construye
    y levanta los contenedores (`docker compose ... up -d --build`), igual
    que `deploy/update.sh`.

## Corrección del 18/10/2026 — `.last_rollback_tag` se bloqueaba a sí mismo

Una validación de solo lectura contra la VM real encontró que
`.last_rollback_tag` (el archivo que el propio script escribe en el paso
10) **no estaba en `.gitignore`** — así que, apenas se usara una segunda
vez, el paso 3 ("bloquear si hay cambios locales sin commitear") lo vería
como un cambio sin commitear y se bloquearía a sí mismo. Confirmado contra
la VM real: tenía exactamente ese archivo suelto desde el despliegue
anterior.

Corrección aplicada: se agregó `/.last_rollback_tag` a `.gitignore` (local,
sin tocar la VM). Se agregaron dos pruebas de regresión para confirmar que
esto no debilita la detección general: un `.last_rollback_tag` suelto ya
NO bloquea (escenario H), pero cualquier OTRO archivo sin seguimiento que
no esté en `.gitignore` sigue bloqueando igual que antes (escenario I).

También se agregó `deploy/rollback.sh` (ver sección siguiente) y se
actualizó el mensaje final de `safe-update.sh` para apuntar a él en vez de
a un `git reset --hard ... && docker compose up -d --build` manual.

## `deploy/rollback.sh` — prioriza reusar imágenes, no reconstruir

**Corregido el 18/10/2026 tras un incidente real** (detalle completo en
`ESTADO_DESARROLLO.md`): la primera versión, invocada sin argumentos,
leía `.last_rollback_tag` en silencio y ejecutaba el rollback de
inmediato, sin ningún paso de confirmación — así se disparó un `git
reset --hard` real contra la VM por accidente. La versión corregida:

- **Nunca actúa sin un tag explícito.** `bash deploy/rollback.sh
  <rollback-tag>` o `bash deploy/rollback.sh --use-last-rollback` (esta
  última, una opción explícita para usar el tag de `.last_rollback_tag`
  — ya no es el comportamiento por defecto). Sin argumentos, con `-h` o
  con `--help`: solo muestra el uso y sale, sin tocar nada.
- Valida, en orden, **antes de pedir confirmación**: que el commit/tag
  exista, que no haya cambios locales sin commitear, y la disponibilidad
  de imágenes Docker respaldadas para `frontend`/`backend` (si falta
  alguna, avisa que esa reconstruiría en vez de reusar).
- **Exige confirmación explícita** (escribir `"si"`, igual que
  `safe-update.sh`) antes de aplicar nada, salvo `DEPLOY_YES=1`. Si no
  hay nada que leer en la entrada (por ejemplo, invocado por SSH sin
  terminal interactiva y sin pipear una respuesta, como en el incidente),
  la lectura falla y el script aborta sin modificar nada — nunca asume
  una confirmación que no se dio.
- Recién con todo lo anterior confirmado: revierte el código (`git reset
  --hard`) y, por servicio, reusa la imagen Docker ya respaldada
  (`docker tag ... :latest` + `docker compose up -d --no-build`) o
  reconstruye solo el/los servicios sin imagen respaldada.

12/12 pruebas en `scripts/tests/deploy-rollback.test.sh`, incluyendo la
reproducción exacta del incidente (sin argumentos, `--help`, canal sin
terminal interactiva, argumentos inválidos/de más) — todas confirman que
nada se modifica hasta que la confirmación es explícita.

## Bootstrap pendiente — estado verificado el 18/10/2026 (NO ejecutado)

El script no puede traerse a sí mismo a la VM la primera vez (no existe
ahí todavía), así que su primera llegada es, necesariamente, un paso
manual revisado — no `deploy/update.sh`, no `safe-update.sh` (todavía no
está), solo un `git merge --ff-only` a un commit exacto ya verificado.

**Verificado por SSH (solo lectura, nada modificado en la VM):**

- VM: `HEAD = bdf3df2fcb1e7ea1233e694705816b97ba2941b4`, rama `main`,
  working tree limpio salvo `?? .last_rollback_tag` (el mismo archivo
  suelto de siempre — se vuelve inocuo en cuanto este bootstrap traiga el
  `.gitignore` corregido).
- `origin/main` (tras `git fetch`, ya con el push de hoy): exactamente
  **2 commits** por delante de la VM — `ba01049` y
  `38ef2d4fdd192c2119e7a4d85afb076c4cc31359` (este último, la punta
  actual) — ningún commit ajeno de otra sesión.
- Diff real `bdf3df2..38ef2d4` (confirmado con `git diff --stat`, ver
  commits): **solo 7 archivos de herramienta de despliegue/documentación**
  — `.gitignore`, `ESTADO_DESARROLLO.md`, `deploy/safe-update.sh`,
  `deploy/rollback.sh`, `docs/DEPLOY-SEGURO-POR-COMMIT.md`,
  `scripts/tests/deploy-safe-update.test.sh`,
  `scripts/tests/deploy-rollback.test.sh`. **Cero archivos de
  `src/`, `server/` ni `supabase/migrations/`** — no hay nada de código
  de aplicación en este salto, por eso el bootstrap no requiere
  reconstruir contenedores.
- Respaldo ya existente en la VM (de un despliegue anterior, sin
  relación con este bootstrap): tag git `rollback-20261018174723` →
  commit `b128e42`, más la imagen `smartrayco-frontend:rollback-pre-tecnico-asignado-b128e42`.
  Ninguno de los dos se toca ni se necesita para este paso.

**Procedimiento exacto (pendiente de autorización para ejecutarse — nada de esto corrió todavía):**

```bash
ssh root@192.168.55.201
cd /opt/smartrayco

# 1. Traer referencias remotas, sin tocar el working tree todavia.
git fetch origin

# 2. Confirmar que lo entrante es EXACTAMENTE lo esperado antes de aplicar nada.
git log --oneline HEAD..38ef2d4fdd192c2119e7a4d85afb076c4cc31359
#   debe mostrar solo:
#     38ef2d4 Corrige el bloqueo de .last_rollback_tag y agrega rollback que reusa imagenes
#     ba01049 Documenta el incidente de alcance del 18/10 y agrega despliegue seguro por commit
git diff --stat HEAD 38ef2d4fdd192c2119e7a4d85afb076c4cc31359
#   debe mostrar solo los 7 archivos listados arriba -- si aparece
#   CUALQUIER otro archivo (src/, server/, supabase/migrations/, o algo
#   no documentado aqui), DETENERSE y no continuar.

# 3. Recien con lo anterior confirmado: avanzar al commit exacto (no a
#    "origin/main" generico -- al SHA preciso que ya se reviso).
git merge --ff-only 38ef2d4fdd192c2119e7a4d85afb076c4cc31359

# 4. Permisos de ejecucion (git en Linux normalmente ya preserva el bit,
#    pero confirmarlo no hace dano).
chmod +x deploy/safe-update.sh deploy/rollback.sh

# 5. Confirmar que no quedo nada pendiente -- .last_rollback_tag ya NO
#    deberia aparecer (ahora esta en .gitignore).
git status --short
```

Explícitamente **NO** incluye: `bash deploy/update.sh`, `docker compose
... up -d --build`, ni ejecutar `safe-update.sh`/`rollback.sh`. Es
únicamente avanzar el checkout de git a un commit ya revisado byte a
byte, de herramientas de despliegue, sin código de aplicación.

**Recuperación si algo saliera mal con este bootstrap puntual** (no hay
Docker involucrado, así que no hay nada que reconstruir): `git reset
--hard bdf3df2fcb1e7ea1233e694705816b97ba2941b4` vuelve la VM exactamente
a donde está ahora.

## Uso previsto (cuando se autorice)

```bash
# Ver que haria, sin aplicar nada (valida todo, pide confirmacion, pero
# podes responder "no" para no tocar Docker):
bash deploy/safe-update.sh <sha-del-commit-autorizado>

# Uso no interactivo, ya autorizado de antemano (por ejemplo, llamado
# desde otra automatizacion que ya pidio permiso):
DEPLOY_YES=1 bash deploy/safe-update.sh <sha>

# Si de verdad se autorizo desplegar varios commits de una vez (no el
# caso normal):
DEPLOY_ALLOW_MULTI_COMMIT=1 DEPLOY_YES=1 bash deploy/safe-update.sh <sha>
```

El commit a pasar es el que ya se pusheó a `origin/main` (mismo flujo de
hoy: commit local → push → recién ahí se puede desplegar).

## Riesgos y limitaciones conocidas

- **No sustituye criterio humano**: si alguien decide correr con
  `DEPLOY_ALLOW_MULTI_COMMIT=1` sin revisar la lista de commits que se
  mostró, el control pierde su propósito. El script muestra la
  información; no puede obligar a leerla.
- **No valida contenido semántico**: verifica que el commit sea el
  correcto y que el salto sea limpio, pero no sabe si ESE commit en
  particular es "solo el fix visual" o "una fase entera" — eso lo decide
  quien pasa el SHA. Mitigación: siempre pasar el SHA exacto autorizado,
  nunca `main` ni `HEAD` de origin.
- **Divergencia real en la VM todavía requeriría intervención manual** —
  el script la detecta y bloquea (correcto), pero no la resuelve solo; eso
  es intencional (ver regla 8 de `CLAUDE.md`: ante discrepancia, detener y
  pedir verificación, no adivinar).
- **El respaldo de imágenes Docker usa `docker compose images -q`**, que
  depende de que el servicio ya tenga un contenedor corriendo con esa
  imagen; si un servicio nunca se desplegó antes, no habrá nada que
  retaguear (no rompe el flujo, solo no genera ese respaldo puntual).
- **No se probó todavía contra la VM real ni contra Docker real** — las
  pruebas corren en repositorios Git sintéticos y temporales, con
  `DEPLOY_SKIP_DOCKER=1` siempre activo. La primera vez que se use de
  verdad conviene hacerlo con un commit de bajo riesgo y mirar el
  resultado antes de confiar en él para un cambio sensible.
- **`deploy/rollback.sh` no se probó con un daemon Docker real** (mismo
  motivo: no hay Docker garantizado en este entorno de pruebas) — la
  lógica de reutilizar `docker image inspect`/`docker tag` se revisó por
  lectura de código, no ejecutándola. Verificar esto en la primera prueba
  real contra la VM.
- **Requiere bash** (ya es el caso de `deploy/update.sh`, sin cambio de
  infraestructura).

## Pruebas (entorno aislado, no toca nada real)

`scripts/tests/deploy-safe-update.test.sh` — crea un "origin" (bare) y
varios clones "VM" sintéticos en un directorio temporal (`mktemp -d`,
borrado al salir), con una historia de 4 commits (`C0` base, `C1` fix
autorizado, `C2`/`C3` simulando fases NO autorizadas). Nunca toca el
repositorio real, la VM de producción, Supabase ni Docker
(`DEPLOY_SKIP_DOCKER=1` en todas las corridas).

Escenarios cubiertos (11/11 PASS):

| Escenario | Qué prueba | Resultado esperado |
|---|---|---|
| A | 1 commit autorizado (`C0→C1`) | se aplica |
| B | pedir `C3` desde `C0` (3 commits, 2 no autorizados) sin bandera | se bloquea |
| B2 | mismo caso, con `DEPLOY_ALLOW_MULTI_COMMIT=1` | se aplica (autorización explícita) |
| C | cambios locales sin commitear (archivo trackeado modificado) | se bloquea |
| D | divergencia (commit local nunca pusheado a origin) | se bloquea |
| E | SHA inválido | se bloquea con mensaje claro |
| F | pedir retroceder (`C1→C0`) | se bloquea (no es avance) |
| G | confirmación interactiva: `no` cancela, `si` aplica | ambos casos correctos |
| H | `.last_rollback_tag` suelto (ignorado) | NO se bloquea |
| I | archivo ajeno sin seguimiento, NO ignorado | sigue bloqueando |

Ejecutar: `bash scripts/tests/deploy-safe-update.test.sh`

`scripts/tests/deploy-rollback.test.sh` — mismo enfoque aislado, para
`deploy/rollback.sh` (12/12 PASS): sin argumentos muestra ayuda sin
modificar nada, `--help` igual, tag válido por un canal sin terminal
interactiva y sin `DEPLOY_YES` se bloquea (reproduce el incidente real),
opción desconocida y argumentos de más bloqueados, `--use-last-rollback`
sin/con `.last_rollback_tag`, cambios locales sin commitear bloquean,
tag/commit inexistente bloqueado, `DEPLOY_YES=1` aplica, y ambas ramas de
la confirmación interactiva (`"si"`/`"no"` por stdin).

Ejecutar: `bash scripts/tests/deploy-rollback.test.sh`

## Pendiente

- Autorización explícita para empezar a usar `deploy/safe-update.sh` en la
  VM real en vez de (o además de) `deploy/update.sh`.
- Opcional, no implementado: un script de "chequeo de drift" que compare
  periódicamente el commit de la VM contra `origin/main` sin desplegar
  nada, para detectar acumulación temprano (propuesto en el incidente,
  todavía no construido).
