import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireRole, invalidateProfileCache } from '../middleware/auth';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import type { Role } from '../types';

export const usersRoutes = new Hono();

// Gestion de usuarios de staff (crear/editar/eliminar) es exclusiva de
// SUPERADMIN — a diferencia de otros modulos, no se comparte con ADMIN.
const MANAGE = ['SUPERADMIN'] as const;

// CLIENTE no es un rol que se gestione aqui (los clientes no inician sesion
// en esta plataforma via profiles — este modulo es solo para tecnicos y
// administradores).
const ASSIGNABLE_ROLES: Role[] = ['SUPERADMIN', 'ADMIN', 'TECNICO_RED', 'SOPORTE', 'FACTURACION'];

const PROFILE_FIELDS = 'id, email, username, full_name, phone, role, active, must_change_password, created_at';
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// Clave a la que un SUPERADMIN resetea la cuenta de alguien que olvido la
// suya (Fase 80) — junto con must_change_password=true, bloquea al usuario
// en /cambiar-password hasta que elija una propia.
const DEFAULT_RESET_PASSWORD = '12345678';

usersRoutes.use('*', requireAuth);

// Cambio de contraseña por el propio usuario (cualquier rol de staff, no solo
// SUPERADMIN) — por eso va ANTES de /:id/reset-password: con 2 segmentos
// ambas rutas podrian calzar con "me" como :id si esta se registrara despues.
// Pide la contraseña actual (verificada contra Auth con la anon key, nunca
// con la service_role) en vez de confiar en que la sesion siga activa.
usersRoutes.post('/me/change-password', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser.email) return c.json({ error: 'No se pudo verificar la cuenta' }, 400);

  const body = await c.req.json();
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword) return c.json({ error: 'Ingresa tu contraseña actual' }, 400);
  if (newPassword.length < 8) return c.json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }, 400);
  if (newPassword === currentPassword) {
    return c.json({ error: 'La nueva contraseña debe ser distinta a la actual' }, 400);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  const anonClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: verifyErr } = await anonClient.auth.signInWithPassword({
    email: currentUser.email,
    password: currentPassword,
  });
  if (verifyErr) return c.json({ error: 'La contraseña actual no es correcta' }, 400);

  const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(currentUser.id, { password: newPassword });
  if (pwErr) return c.json({ error: pwErr.message }, 400);

  await supabaseAdmin.from('profiles').update({ must_change_password: false }).eq('id', currentUser.id);

  return c.json({ ok: true });
});

usersRoutes.get('/', requireRole(...MANAGE), async (c) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_FIELDS)
    .neq('role', 'CLIENTE')
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data ?? []);
});

usersRoutes.post('/', requireRole(...MANAGE), async (c) => {
  const body = await c.req.json();
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const role = body.role as Role;

  if (!email || !password || !role || !username) {
    return c.json({ error: 'email, username, password y role son requeridos' }, 400);
  }
  if (!USERNAME_RE.test(username)) {
    return c.json({ error: 'Usuario invalido: 3-32 caracteres, solo letras, numeros, punto, guion o guion bajo' }, 400);
  }
  if (!ASSIGNABLE_ROLES.includes(role)) return c.json({ error: 'Rol invalido' }, 400);
  if (password.length < 8) return c.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    return c.json({ error: createErr?.message ?? 'Error al crear el usuario' }, 400);
  }

  // El trigger handle_new_user ya inserto el profile (rol CLIENTE y un
  // username auto-generado del correo) — lo completamos con el nombre,
  // rol y username reales.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .update({ full_name: fullName || null, role, username, phone: phone || null })
    .eq('id', created.user.id)
    .select(PROFILE_FIELDS)
    .single();

  if (profileErr) {
    // Revertir: no dejar un auth.users huerfano sin su profile correcto.
    // Causa mas comun aqui: el username ya esta en uso (indice unico).
    await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
    const message = /duplicate key|unique/i.test(profileErr.message)
      ? 'Ese nombre de usuario ya esta en uso'
      : profileErr.message;
    return c.json({ error: message }, 400);
  }

  return c.json(profile, 201);
});

usersRoutes.patch('/:id', requireRole(...MANAGE), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Falta el id' }, 400);
  const currentUser = c.get('user');
  const body = await c.req.json();
  const updates: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    updates.full_name = typeof body.full_name === 'string' ? body.full_name.trim() || null : null;
  }

  if (body.phone !== undefined) {
    updates.phone = typeof body.phone === 'string' ? body.phone.trim() || null : null;
  }

  if (body.username !== undefined) {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!USERNAME_RE.test(username)) {
      return c.json({ error: 'Usuario invalido: 3-32 caracteres, solo letras, numeros, punto, guion o guion bajo' }, 400);
    }
    updates.username = username;
  }

  if (body.role !== undefined) {
    if (!ASSIGNABLE_ROLES.includes(body.role)) return c.json({ error: 'Rol invalido' }, 400);
    if (id === currentUser.id && body.role !== 'SUPERADMIN') {
      return c.json({ error: 'No puedes quitarte a ti mismo el rol de Super admin' }, 400);
    }
    updates.role = body.role;
  }

  if (body.active !== undefined) {
    if (id === currentUser.id && body.active === false) {
      return c.json({ error: 'No puedes desactivar tu propia cuenta' }, 400);
    }
    updates.active = !!body.active;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id);
    if (error) {
      const message = /duplicate key|unique/i.test(error.message) ? 'Ese nombre de usuario ya esta en uso' : error.message;
      return c.json({ error: message }, 400);
    }
    // Sin esto, un rol cambiado o una cuenta recien desactivada seguiria
    // actuando con los permisos viejos hasta 60s (ver PROFILE_TTL_MS en
    // middleware/auth.ts) en vez de quedar sin efecto al instante.
    if (body.role !== undefined || body.active !== undefined) invalidateProfileCache(id);
  }

  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) return c.json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password: body.password });
    if (pwErr) return c.json({ error: pwErr.message }, 400);
  }

  const { data, error: readErr } = await supabaseAdmin.from('profiles').select(PROFILE_FIELDS).eq('id', id).single();
  if (readErr) return c.json({ error: readErr.message }, 400);
  return c.json(data);
});

// Resetea la clave a un valor por defecto conocido (cuando un usuario olvido
// la suya) y lo obliga a cambiarla en su proximo ingreso — a diferencia del
// campo "password" del PATCH de arriba (clave elegida por el admin, sin
// forzar cambio), esta accion es explicitamente el flujo de "se me olvido".
usersRoutes.post('/:id/reset-password', requireRole(...MANAGE), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Falta el id' }, 400);

  const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(id, { password: DEFAULT_RESET_PASSWORD });
  if (pwErr) return c.json({ error: pwErr.message }, 400);

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', id)
    .select(PROFILE_FIELDS)
    .single();
  if (error) return c.json({ error: error.message }, 400);

  return c.json(data);
});

usersRoutes.delete('/:id', requireRole(...MANAGE), async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Falta el id' }, 400);
  const currentUser = c.get('user');
  if (id === currentUser.id) return c.json({ error: 'No puedes eliminar tu propia cuenta' }, 400);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (error) {
    // Los tickets/instalaciones/movimientos de inventario etc. referencian
    // profiles sin ON DELETE CASCADE (por diseno, para no perder historial)
    // — si el usuario tiene actividad registrada, Postgres rechaza el
    // delete con una violacion de FK. Se explica en vez de mostrar el error
    // crudo. Supabase Auth no siempre deja pasar el texto real de Postgres:
    // cuando el DELETE de auth.users cascadea a profiles y ahi choca con la
    // FK, GoTrue lo envuelve en el mensaje generico "Database error deleting
    // user" — en este esquema esa es, en la practica, siempre la misma causa
    // (historial asociado), asi que tambien se traduce.
    const message = /foreign key|violat|database error/i.test(error.message)
      ? 'No se puede eliminar: este usuario tiene historial asociado (tickets, instalaciones, movimientos de inventario, etc.). Desactívalo en su lugar.'
      : error.message;
    return c.json({ error: message }, 400);
  }
  return c.json({ ok: true });
});
