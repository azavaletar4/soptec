-- SmartRayco — Fase 80: reseteo de contraseña por SUPERADMIN + cambio forzado
-- Cuando un SUPERADMIN resetea la clave de alguien (olvido su contraseña), la
-- deja en un valor por defecto y marca esta bandera — el panel bloquea al
-- usuario en /cambiar-password hasta que elija una propia.

alter table public.profiles
  add column must_change_password boolean not null default false;
