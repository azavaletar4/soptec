# TR-069: identificación de serial GPON corregida (Huawei)

Corrige el hallazgo de `TR069-HUAWEI-INCIDENTE-Y-RECUPERACION-20261027.md`:
GenieACS reporta el serial de `HWTC1D3691B7` como `485754431D3691B7`
(16 hex) en vez del formato ASCII+hex que usa la OLT — comparación
literal nunca encontraba la coincidencia aunque sea la misma ONT real.

## Causa real (no es un bug de GenieACS ni del equipo)

El serial GPON (ITU-T G.984.3) son 8 bytes: 4 bytes de vendor ID + 4
bytes de identificador propio del fabricante. La OLT lo muestra como
"ASCII + hex" (`HWTC` + `1D3691B7`). Esta Huawei lo reporta por TR-069
con el vendor ID TAMBIÉN hex-codificado: `48575443` decodifica
byte a byte a `H`,`W`,`T`,`C` — es el **mismo serial**, otra
representación del mismo valor de 8 bytes.

## Cambios

- **Nuevo** `src/lib/gponSerial.ts`: `normalizeGponSerial` (decodifica el
  vendor ID hex si hace falta, nunca inventa un formato no reconocido),
  `gponSerialsMatch`, `matchTr069Device` (sin coincidencias parciales;
  `INVALID_ONT_SERIAL` / `NO_MATCH` / `AMBIGUOUS` nunca vinculan).
- `src/lib/gponVendorId.ts`: `gponVendorFromSerial` ahora normaliza antes
  de leer el prefijo (si no, un serial hex de 16 caracteres daba un
  prefijo sin sentido).
- `server/src/routes/olt.ts`, dos consumidores corregidos (ambos
  comparaban serial literal, mismo problema):
  - `GET /:id/onts/:ontDbId/tr069/status` (estado del botón TR-069
    guiado — ya no usa `.ilike` literal).
  - `GET /onts/status` (estado OLT por serial, usado por `Tr069View.vue`
    — ya no filtra por `.in('serial', ...)` en SQL, normaliza en código).
- 26 pruebas nuevas (Huawei, ZTE, inválido, ambiguo, null) — todas en
  verde. `tsc` backend/frontend limpio. 452+247 pruebas existentes sin
  regresión.

## Compatibilidad conservada

ZTE y cualquier serial ya en formato canónico (`AAAA` + 8 hex) pasa
igual que antes — el único camino nuevo es el de 16 hex, y solo si
decodifica a 4 bytes ASCII imprimibles válidos.

## Evidencia con datos reales (solo lectura, sin tocar OLT/ONT/MikroTik)

```
normalizeGponSerial('HWTC1D3691B7')      -> 'HWTC1D3691B7'
normalizeGponSerial('485754431D3691B7')  -> 'HWTC1D3691B7'   (dato real de tr069_devices)
matchTr069Device('HWTC1D3691B7', [...])  -> encuentra el dispositivo real,
                                             last_seen_at = 2026-10-27 19:52:30 UTC
deriveTr069EnableStatus(...)             -> 'conectado'  (antes: 'esperando_conexion')
```

## No se tocó

Supabase productivo (solo lecturas), OLT, ONT, MikroTik, contratos.
Sin migraciones, sin push, sin despliegue.
