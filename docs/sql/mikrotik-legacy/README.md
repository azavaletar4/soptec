# Migraciones históricas archivadas

Estos dos SQL son copias históricas exactas de la rama local `0b60cb8`, conservadas al integrar con `f763d37`. **No ejecutar ni incluir en el runner de migraciones.**

| Original local archivado | Nombre canónico conservado en supabase/migrations |
| --- | --- |
| `20261024120000_fase168_mikrotik_device_role.sql` | `20261024120000_fase171_mikrotik_device_role.sql` |
| `20261024130000_fase169_mikrotik_borde_trafico.sql` | `20261024130000_fase172_mikrotik_borde_trafico.sql` |

Cada pareja contiene el mismo SQL; solo cambian comentarios de números de fase. Conservar ambos en `supabase/migrations` repetiría la misma versión temporal y la operación. Se preservan los originales aquí y en el historial/bundle; no se altera el SQL canónico remoto ni el historial instalado en ninguna BD. El manifiesto de preservación de la integración registra los movimientos y su verificación.
