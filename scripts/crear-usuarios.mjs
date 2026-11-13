// Crea el usuario de central y los 9 de tienda en tu proyecto Supabase.
// Uso (una sola vez, tras aplicar las migraciones):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run crear-usuarios
//
// Muestra las contraseñas temporales UNA sola vez. Apúntalas y entrégalas a
// cada tienda: en el primer acceso el sistema obliga a cambiarlas.
// Es seguro volver a ejecutarlo: los usuarios que ya existen se saltan.
import { createClient } from '@supabase/supabase-js';
import { randomInt } from 'node:crypto';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LOGIN_DOMAIN = 'tiendas.local' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API).');
  process.exit(1);
}
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const passwordTemporal = () => Array.from({ length: 12 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');

const { data: tiendas, error: e1 } = await admin.from('stores').select('id, code').order('code');
if (e1) { console.error('No se pueden leer las tiendas. ¿Aplicaste las migraciones?', e1.message); process.exit(1); }
if (tiendas.length !== 9) console.warn(`Aviso: hay ${tiendas.length} tiendas (se esperaban 9).`);

const usuarios = [
  { username: 'central', role: 'MASTER', store_id: null },
  ...tiendas.map((t) => ({ username: 'tienda' + t.code.slice(1), role: 'STORE', store_id: t.id })),
];

const resultado = [];
for (const u of usuarios) {
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('username', u.username);
  if (count) { resultado.push({ usuario: u.username, contraseña: '(ya existía, sin cambios)' }); continue; }

  const password = passwordTemporal();
  const { data, error } = await admin.auth.admin.createUser({
    email: `${u.username}@${LOGIN_DOMAIN}`, password, email_confirm: true,
  });
  if (error) { console.error(`Error creando ${u.username}:`, error.message); process.exitCode = 1; continue; }

  const { error: e2 } = await admin.from('profiles').insert({ id: data.user.id, ...u, must_change_password: true });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id);
    console.error(`Error creando el perfil de ${u.username}:`, e2.message); process.exitCode = 1; continue;
  }
  resultado.push({ usuario: u.username, contraseña: password });
}

console.log('\nUsuarios creados. Guarda estas contraseñas: no se volverán a mostrar.\n');
console.table(resultado);
