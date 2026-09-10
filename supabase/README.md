# supabase/

Aquí viven las migraciones SQL del proyecto (`supabase/migrations/*.sql`), gestionadas con la
Supabase CLI (`supabase db push`). Se crean a partir de la **Fase 2**, cuando se agreguen las
primeras tablas (clientes, planes, zonas, contratos, profiles).

La Fase 1 no requiere tablas propias: usa `auth.users`, gestionado por Supabase Auth.
