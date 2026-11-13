// Lógica de la Edge Function "usuarios", independiente de Supabase para poder
// probarla con dependencias simuladas (ver logica.test.ts).

export type Rol = "MASTER" | "STORE";
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

async function exigirCentral(deps: Deps, token: string | null): Promise<Perfil> {
  const p = await exigirPerfilActivo(deps, token);
  if (p.role !== "MASTER") throw new ErrorHttp(403, "Solo la central puede gestionar usuarios.");
  return p;
}

// deno-lint-ignore no-explicit-any
export async function ejecutar(deps: Deps, token: string | null, body: any): Promise<unknown> {
  switch (body?.accion) {
    case "crear": {
      await exigirCentral(deps, token);
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
        throw new ErrorHttp(400, "El usuario debe tener 3-50 caracteres: letras, números, punto, guion o guion bajo.");
      }
      const role: Rol = body.role === "MASTER" ? "MASTER" : "STORE";
      const store_id = role === "STORE" ? Number(body.store_id) : null;
      if (role === "STORE" && (!Number.isInteger(store_id) || !(await deps.tiendaActiva(store_id!)))) {
        throw new ErrorHttp(400, "Elige una tienda activa para este usuario.");
      }
      if (await deps.existeUsername(username)) throw new ErrorHttp(409, `El usuario "${username}" ya existe.`);

      const password = passwordTemporal();
      const id = await deps.crearUsuarioAuth(`${username}@${deps.dominioLogin}`, password);
      try {
        await deps.insertarPerfil({ id, username, role, store_id, must_change_password: true });
      } catch (e) {
        await deps.borrarUsuarioAuth(id); // no dejar usuarios de Auth huérfanos
        throw e;
      }
      return { id, username, password_temporal: password };
    }

    case "restablecer": {
      await exigirCentral(deps, token);
      const objetivo = await deps.obtenerPerfil(String(body.user_id));
      if (!objetivo) throw new ErrorHttp(404, "No existe ese usuario.");
      const password = passwordTemporal();
      await deps.cambiarPasswordAuth(objetivo.id, password);
      await deps.actualizarPerfil(objetivo.id, { must_change_password: true });
      return { username: objetivo.username, password_temporal: password };
    }

    case "activar": {
      const yo = await exigirCentral(deps, token);
      const objetivo = await deps.obtenerPerfil(String(body.user_id));
      if (!objetivo) throw new ErrorHttp(404, "No existe ese usuario.");
      const activo = body.activo === true;
      if (!activo && objetivo.id === yo.id) throw new ErrorHttp(400, "No puedes desactivar tu propio usuario.");
      // Primero el perfil: el trigger de la base de datos impide dejar la central sin usuarios.
      await deps.actualizarPerfil(objetivo.id, { active: activo });
      await deps.bloquearAuth(objetivo.id, !activo);
      return { username: objetivo.username, activo };
    }

    case "cambiar_mi_password": {
      const yo = await exigirPerfilActivo(deps, token);
      const pw = validarPasswordNueva(body.password);
      await deps.cambiarPasswordAuth(yo.id, pw);
      await deps.actualizarPerfil(yo.id, { must_change_password: false });
      return { ok: true };
    }

    default:
      throw new ErrorHttp(400, "Acción no reconocida.");
  }
}
