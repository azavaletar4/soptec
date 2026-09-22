import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth';
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

const PROFILE_FIELDS = 'id, email, username, full_name, phone, role, active, created_at';
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

usersRoutes.use('*', requireAuth);

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
    // crudo de Postgres.
    const message = /foreign key|violat/i.test(error.message)
      ? 'No se puede eliminar: este usuario tiene historial asociado (tickets, instalaciones, movimientos de inventario, etc.). Desactívalo en su lugar.'
      : error.message;
    return c.json({ error: message }, 400);
  }
  return c.json({ ok: true });
});
