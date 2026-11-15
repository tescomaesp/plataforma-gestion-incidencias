// Edge Function "usuarios": altas, restablecimientos, activación y cambio de
// contraseña. Usa la clave service_role, que nunca llega al navegador.
// Desplegar con:  supabase functions deploy usuarios
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Deps, ejecutar, ErrorHttp, type Perfil } from "./logica.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// CORS: solo se aceptan llamadas desde la web de la plataforma. Se puede cambiar con
// el secreto APP_ORIGIN (p. ej. para pruebas en local). Además, siempre se exige el
// token de sesión de un administrador.
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "https://tescomaesp.github.io",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function comprobar(r: { error: { message: string } | null }): void {
  if (r.error) throw new Error(r.error.message);
}

const deps: Deps = {
  dominioLogin: Deno.env.get("LOGIN_DOMAIN") ?? "tiendas.local",
  async usuarioDelToken(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  },
  async obtenerPerfil(id) {
    const { data } = await admin.from("profiles")
      .select("id, username, role, store_id, active, must_change_password").eq("id", id).maybeSingle();
    return data as Perfil | null;
  },
  async existeUsername(username) {
    // Sin distinguir mayúsculas; se escapan los comodines de ILIKE.
    const patron = username.replace(/[\\%_]/g, (c) => "\\" + c);
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).ilike("username", patron);
    return (count ?? 0) > 0;
  },
  async tiendaActiva(storeId) {
    const { data } = await admin.from("stores").select("id").eq("id", storeId).eq("active", true).maybeSingle();
    return !!data;
  },
  async crearUsuarioAuth(email, password) {
    const r = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    comprobar(r);
    return r.data.user!.id;
  },
  async borrarUsuarioAuth(id) {
    await admin.auth.admin.deleteUser(id);
  },
  async cambiarPasswordAuth(id, password) {
    comprobar(await admin.auth.admin.updateUserById(id, { password }));
  },
  async bloquearAuth(id, bloqueado) {
    // Un usuario bloqueado no puede iniciar sesión ni renovar su token.
    comprobar(await admin.auth.admin.updateUserById(id, { ban_duration: bloqueado ? "876000h" : "none" }));
  },
  async insertarPerfil(p) {
    comprobar(await admin.from("profiles").insert(p));
  },
  async actualizarPerfil(id, cambios) {
    comprobar(await admin.from("profiles").update(cambios).eq("id", id));
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    return json(await ejecutar(deps, token, await req.json()));
  } catch (e) {
    if (e instanceof ErrorHttp) return json({ error: e.message }, e.status);
    const msg = e instanceof Error ? e.message : String(e);
    // El trigger de la base de datos devuelve mensajes ya pensados para el usuario.
    if (msg.includes("al menos un administrador")) return json({ error: msg }, 400);
    console.error(e);
    return json({ error: "No se ha podido completar la operación. Inténtalo de nuevo." }, 500);
  }
});
