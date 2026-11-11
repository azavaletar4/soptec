# Altas Dúo IPTV — migración SQL aplicada en producción

**Estado: migración aplicada y verificada completa. Producción operativa.**
Commit del paquete ya desplegado: `bcb3ec4c432c6baa39f175cca115795d5ae1cd45`.
Archivo aplicado: `supabase/migrations/20261111140000_installation_iptv_mode.sql`
(el nombre citado en la autorización, `...400000...`, no existe — confirmado
error de tipeo con el propietario antes de ejecutar; se aplicó el único
archivo real).

## Reconfirmación inmediata antes de ejecutar (las 4 exigidas)

1. Respaldo PostgreSQL íntegro: SHA-256 `2f00a7d7a90b3f4eb4e2cab5e9bdd2e6a19bb4cd97acdf87f21d07a810ebe017` re-verificado byte a byte contra el valor registrado.
2. Hash del trigger de cierre antes de migrar: `e452ec213962f70d8db289ac17ed361f` (coincide con la precondición de la migración). `iptvColumnsPresent: false` confirmado justo antes.
3. Frontend desplegado: imagen `sha256:6ed5f7751bb2f8b7c26baf6bed8228c1c9ed695ef60a25c2ca676a36bbea923d`, `release-manifest.json` → `commit: bcb3ec4c432c...`.
4. 0 instalaciones en ejecución (`inProgressCount:0`), 9 órdenes/4 sesiones idénticas a las lecturas anteriores — sin cambios incompatibles.

## Aplicación

`scripts/apply-installation-iptv-mode-migracion.ps1` (nuevo, mismo patrón
probado de `apply-campo-available-custody-hotfix.ps1`: credencial DPAPI,
Docker aislado, `psql -v ON_ERROR_STOP=1`, sin `supabase db push`). El
script reportó `MIGRATION_BLOCKED=APLICACION_O_GUARDA` — **falso positivo**:
la función compartida `Invoke-PrivateDocker` tiene un límite de 60s
(ya documentado en otro script del proyecto como insuficiente para
operaciones largas); el `commit;` de la migración ya había terminado
antes de que el script recibiera la respuesta completa. Confirmado de
inmediato con una lectura de solo lectura separada: la migración **sí se
aplicó** — no se intentó ningún rollback (hubiera sido incorrecto revertir
una migración que en realidad tuvo éxito).

## Verificación completa (solo lectura, `scripts/verify-installation-iptv-mode-migracion-readonly.ps1`)

```json
{
  "columns": ["closure_operation_id:uuid", "closure_payload_hash:text", "iptv_installation_mode:text", "iptv_policy_version:smallint DEFAULT 1"],
  "constraints": ["installations_closure_receipt_check", "installations_iptv_mode_check", "installations_iptv_policy_check"],
  "triggers": ["b_installation_iptv_insert", "b_installation_iptv_update"],
  "completion_trigger_md5": "aefea82d144a6c6f3218d0f81b43816f",
  "legacy_assert_present": true, "new_assert_present": true, "preflight_present": true,
  "guard_trigger_fn_present": true, "assert_mode_fn_present": true,
  "installations_total": 92, "installations_with_mode_set": 0,
  "installations_by_status": [{"completed":86},{"cancelled":6}],
  "contracts_total": 766, "inventory_units_total": 247,
  "preflight_grants": ["authenticated:EXECUTE"]
}
```

- Las 4 columnas, 3 constraints y 2 triggers nuevos existen exactamente
  como declara la migración.
- `completion_trigger_md5` coincide EXACTO con el valor documentado como
  esperado post-migración (`aefea82d144a6c6f3218d0f81b43816f`) — confirma
  que el trigger de cierre se actualizó correctamente con la lógica de
  tres modalidades.
- `assert_material_closure_ready_iptv_legacy` (RPC vieja renombrada) y el
  nuevo wrapper `assert_material_closure_ready` ambos presentes — rechazo
  temprano y recuperable del cliente viejo (`PIP09`) sin perder evidencia.
- `installation_iptv_preflight` (RPC de 5 argumentos) presente, con el
  grant exacto declarado (`authenticated`, sin `anon`/`service_role`).
- **Cero filas alteradas**: `installations_total=92` idéntico a la línea
  base verificada en la restauración del respaldo; `installations_with_mode_set=0`
  confirma que ninguna fila existente recibió retroactivamente
  `iptv_policy_version` (NULL preservado, sin backfill, exactamente como
  exige el diseño). `installations_by_status` (86 completadas + 6
  canceladas) idéntico a antes. `contracts_total=766` e
  `inventory_units_total=247` también idénticos a la línea base.
- Solo Rayco TV Box exige serie/MAC+custodia: confirmado por el código de
  la migración (línea 69-77, `tvbox_count` solo se exige cuando
  `contract_xui_line_id is not null and ... mode='rayco_tv_box'`) — Smart TV
  y dispositivo propio nunca ejecutan esa validación.

## Producción después de la migración

- `smartrayco-frontend-1`/`backend-1`/`caddy-1`/`genieacs-1`/`mongo-1`: sin
  reinicios, mismas imágenes que antes del SQL (el SQL no reinicia
  contenedores).
- GenieACS: cola de tareas `[]` (vacía) — cero tareas TR-069,
  confirmado después de la migración.
- OLT, MikroTik, PPPoE y facturación: no se tocaron en ningún momento de
  esta operación (ningún comando se ejecutó contra esos sistemas).

## Pendiente (no ejecutado, fuera del alcance autorizado)

- No se creó ni cerró ninguna orden real de prueba.
- Validación operativa normal con la primera Alta Dúo real nueva: pendiente,
  requiere autorización y ocurrencia natural (no se fuerza).
- Reapertura/monitoreo de Campo por grupos: ya estaba abierto según la
  autorización de esta fase (los técnicos ya actualizaron antes del SQL).

**Estado final: PRODUCCIÓN OPERATIVA.** Migración aplicada, verificada
completa, históricos e inventario intactos, rollback (`scripts/rollback-installation-iptv-mode.sql`)
disponible y sin usar.
