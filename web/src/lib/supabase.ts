import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y rellénalo.');
}

// Supabase renueva el token solo y mantiene la sesión entre reinicios del
// ordenador, así la tienda no tiene que volver a entrar cada día.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const DOMINIO_LOGIN = (import.meta.env.VITE_LOGIN_DOMAIN as string) || 'tiendas.local';
// Las tiendas entran con su usuario (tienda01…); la central puede entrar con su email completo.
export const emailDeUsuario = (usuario: string) => {
  const u = usuario.trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${DOMINIO_LOGIN}`;
};

/** Llama a la Edge Function "usuarios" y devuelve un error legible si falla. */
export async function llamarUsuarios<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('usuarios', { body });
  if (error) {
    let mensaje = 'No se ha podido conectar con el servidor. Comprueba la conexión a internet.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { mensaje = (await ctx.json()).error ?? mensaje; } catch { /* respuesta sin JSON */ }
    }
    throw new Error(mensaje);
  }
  return data as T;
}

/** Traduce los mensajes de Supabase Auth que puede ver una tienda. */
export function mensajeLogin(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Usuario o contraseña incorrectos.';
  if (/banned/i.test(msg)) return 'Este usuario está desactivado. Contacta con la central.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera unos minutos antes de volver a probar.';
  if (/fetch|network/i.test(msg)) return 'Sin conexión con el servidor. Comprueba la conexión a internet.';
  return msg;
}

/** Mensaje legible para errores de consultas (RLS, restricciones, red). */
export function mensajeError(e: unknown): string {
  const msg = e instanceof Error ? e.message
    : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/row-level security|permission denied/i.test(msg)) return 'No tienes permiso para hacer esto.';
  if (/fetch|network/i.test(msg)) return 'Sin conexión con el servidor. Comprueba la conexión a internet.';
  return msg;
}
