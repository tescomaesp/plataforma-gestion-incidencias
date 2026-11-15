// Lógica de la Edge Function "usuarios", independiente de Supabase para poder
// probarla con dependencias simuladas (ver logica.test.ts).

export type Rol = "ADMIN" | "RESPONSABLE" | "STORE";
export interface Perfil {
  id: string;
  username: string;
  role: Rol;
  store_id: number | null;
  active: boolean;
  must_change_password: boolean;
}

/** Operaciones que la función necesita. index.ts las implementa con Supabase. */
export interface Deps {
  usuarioDelToken(token: string): Promise<string | null>;
  obtenerPerfil(id: string): Promise<Perfil | null>;
  existeUsername(username: string): Promise<boolean>;
  tiendaActiva(storeId: number): Promise<boolean>;
  crearUsuarioAuth(email: string, password: string): Promise<string>;
  borrarUsuarioAuth(id: string): Promise<void>;
  cambiarPasswordAuth(id: string, password: string): Promise<void>;
  bloquearAuth(id: string, bloqueado: boolean): Promise<void>;
  insertarPerfil(p: Omit<Perfil, "active">): Promise<void>;
  actualizarPerfil(id: string, cambios: Partial<Perfil>): Promise<void>;
  dominioLogin: string;
}

/**
 * Email interno de Supabase Auth para un nombre de usuario. Debe coincidir con
 * emailDeUsuario() de la web. Los nombres sencillos (tienda01) se usan tal cual;
 * los que llevan espacios, tildes o mayúsculas usan un identificador derivado.
 */
const NOMBRE_SENCILLO = /^[a-z0-9._-]{3,50}$/;
export async function emailDeUsuario(usuario: string, dominio: string): Promise<string> {
  const u = usuario.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  if (u.includes("@")) return u;
  if (NOMBRE_SENCILLO.test(u)) return `${u}@${dominio}`;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(u)));
  return `u-${Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}@${dominio}`;
}

export class ErrorHttp extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // sin 0/O, 1/l/I
export function passwordTemporal(longitud = 12): string {
  const bytes = new Uint32Array(longitud);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
}

export function validarPasswordNueva(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < 10) {
    throw new ErrorHttp(400, "La contraseña debe tener al menos 10 caracteres.");
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw new ErrorHttp(400, "La contraseña debe combinar letras y números.");
  }
  return pw;
}

async function exigirPerfilActivo(deps: Deps, token: string | null): Promise<Perfil> {
  if (!token) throw new ErrorHttp(401, "Falta la sesión. Vuelve a entrar.");
  const uid = await deps.usuarioDelToken(token);
  if (!uid) throw new ErrorHttp(401, "La sesión ha caducado. Vuelve a entrar.");
  const perfil = await deps.obtenerPerfil(uid);
  if (!perfil || !perfil.active) throw new ErrorHttp(403, "Este usuario está desactivado.");
  return perfil;
}

async function exigirAdmin(deps: Deps, token: string | null): Promise<Perfil> {
  const p = await exigirPerfilActivo(deps, token);
  if (p.role !== "ADMIN") throw new ErrorHttp(403, "Solo el administrador puede gestionar usuarios.");
  return p;
}

// deno-lint-ignore no-explicit-any
export async function ejecutar(deps: Deps, token: string | null, body: any): Promise<unknown> {
  switch (body?.accion) {
    case "crear": {
      await exigirAdmin(deps, token);
      const username = String(body.username ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
      if (!username) throw new ErrorHttp(400, "Escribe el nombre de usuario.");
      if (username.length > 100) throw new ErrorHttp(400, "El nombre de usuario es demasiado largo (máximo 100 caracteres).");
      if (username.includes("@")) throw new ErrorHttp(400, "El nombre de usuario no puede llevar @.");
      const role: Rol = body.role === "ADMIN" || body.role === "RESPONSABLE" ? body.role : "STORE";
      const store_id = role === "STORE" ? Number(body.store_id) : null;
      if (role === "STORE" && (!Number.isInteger(store_id) || !(await deps.tiendaActiva(store_id!)))) {
        throw new ErrorHttp(400, "Elige una tienda activa para este usuario.");
      }
      if (await deps.existeUsername(username)) throw new ErrorHttp(409, `El usuario "${username}" ya existe.`);

      const password = passwordTemporal();
      const id = await deps.crearUsuarioAuth(await emailDeUsuario(username, deps.dominioLogin), password);
      try {
        await deps.insertarPerfil({ id, username, role, store_id, must_change_password: true });
      } catch (e) {
        await deps.borrarUsuarioAuth(id); // no dejar usuarios de Auth huérfanos
        throw e;
      }
      return { id, username, password_temporal: password };
    }

    case "restablecer": {
      await exigirAdmin(deps, token);
      const objetivo = await deps.obtenerPerfil(String(body.user_id));
      if (!objetivo) throw new ErrorHttp(404, "No existe ese usuario.");
      const password = passwordTemporal();
      await deps.cambiarPasswordAuth(objetivo.id, password);
      await deps.actualizarPerfil(objetivo.id, { must_change_password: true });
      return { username: objetivo.username, password_temporal: password };
    }

    case "activar": {
      const yo = await exigirAdmin(deps, token);
      const objetivo = await deps.obtenerPerfil(String(body.user_id));
      if (!objetivo) throw new ErrorHttp(404, "No existe ese usuario.");
      const activo = body.activo === true;
      if (!activo && objetivo.id === yo.id) throw new ErrorHttp(400, "No puedes desactivar tu propio usuario.");
      // Primero el perfil: el trigger de la base de datos impide quedarse sin administradores.
      await deps.actualizarPerfil(objetivo.id, { active: activo });
      await deps.bloquearAuth(objetivo.id, !activo);
      return { username: objetivo.username, activo };
    }

    case "cambiar_mi_password": {
      const yo = await exigirPerfilActivo(deps, token);
      // Las tiendas solo eligen contraseña en su primer acceso; después la gestiona el administrador.
      if (yo.role === "STORE" && !yo.must_change_password) {
        throw new ErrorHttp(403, "La contraseña de la tienda solo la puede cambiar el administrador.");
      }
      const pw = validarPasswordNueva(body.password);
      await deps.cambiarPasswordAuth(yo.id, pw);
      await deps.actualizarPerfil(yo.id, { must_change_password: false });
      return { ok: true };
    }

    default:
      throw new ErrorHttp(400, "Acción no reconocida.");
  }
}
