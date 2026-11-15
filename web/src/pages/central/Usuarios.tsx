import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { enlaceAcceso, llamarUsuarios, mensajeError, supabase } from '../../lib/supabase';
import type { Perfil, Rol, Tienda } from '../../lib/tipos';
import { useSesion } from '../../auth/Sesion';
import { Aviso, Boton, Campo, Dialogo, PasswordTemporal } from '../../components/ui';
import { fechaHora, ROLES } from '../../lib/formato';

type Credencial = { usuario: string; password: string } | null;
type Clave = { password: string; updated_at: string };

/** Texto listo para enviar a la tienda por correo o WhatsApp. */
const mensajeAcceso = (usuario: string, password?: string) =>
  `Acceso a la plataforma de incidencias de garantía:\n${enlaceAcceso(usuario)}\n\nUsuario: ${usuario}` +
  (password ? `\nContraseña: ${password}` : '');

export default function Usuarios() {
  const { perfil: yo } = useSesion();
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [claves, setClaves] = useState<Record<string, Clave>>({});
  const [verClaves, setVerClaves] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [credencial, setCredencial] = useState<Credencial>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevoRol, setNuevoRol] = useState<Rol>('STORE');
  const [nuevaTienda, setNuevaTienda] = useState('');

  const cargar = useCallback(async () => {
    const [p, t, c] = await Promise.all([
      supabase.from('profiles').select('*').order('username'),
      supabase.from('stores').select('*').order('code'),
      supabase.rpc('ver_passwords'),
    ]);
    if (p.error || t.error) { setError(mensajeError(p.error ?? t.error)); return; }
    setPerfiles(p.data as Perfil[]); setTiendas(t.data as Tienda[]);
    setClaves(Object.fromEntries(((c.data ?? []) as (Clave & { user_id: string })[]).map((x) => [x.user_id, x])));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreTienda = (id: number | null) => {
    const t = tiendas.find((x) => x.id === id);
    return t ? `${t.code} · ${t.name}` : '—';
  };

  async function accion(clave: string, fn: () => Promise<void>) {
    setError(null); setOk(null); setOcupado(clave);
    try { await fn(); await cargar(); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(null); }
  }

  const crear = (e: FormEvent) => {
    e.preventDefault();
    accion('crear', async () => {
      const r = await llamarUsuarios<{ username: string; password_temporal: string }>({
        accion: 'crear', username: nuevoUsuario, role: nuevoRol,
        store_id: nuevoRol === 'STORE' ? Number(nuevaTienda) : null,
      });
      setCredencial({ usuario: r.username, password: r.password_temporal });
      setNuevoUsuario(''); setNuevaTienda('');
    });
  };

  const restablecer = (p: Perfil) => accion(`r-${p.id}`, async () => {
    if (!confirm(`¿Generar una contraseña nueva para ${p.username}? La actual dejará de funcionar.`)) return;
    const r = await llamarUsuarios<{ username: string; password_temporal: string }>({ accion: 'restablecer', user_id: p.id });
    setCredencial({ usuario: r.username, password: r.password_temporal });
  });

  const cambiarActivo = (p: Perfil) => accion(`a-${p.id}`, async () => {
    if (p.active && !confirm(`¿Desactivar ${p.username}? No podrá entrar hasta que lo actives de nuevo.`)) return;
    await llamarUsuarios({ accion: 'activar', user_id: p.id, activo: !p.active });
  });

  const copiar = async (texto: string, aviso: string) => {
    await navigator.clipboard.writeText(texto);
    setOk(aviso);
  };

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-3xl font-bold">Usuarios</h1>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      <div className="flex flex-col gap-2 rounded-lg border border-esmalte bg-esmalte-claro p-4">
        <p className="font-bold">Enlace de acceso a la plataforma</p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 break-all rounded bg-white px-3 py-2">{enlaceAcceso()}</code>
          <Boton variante="secundario" onClick={() => copiar(enlaceAcceso(), 'Enlace copiado.')}>Copiar enlace</Boton>
        </div>
        <p className="text-sm text-acero">Con "Copiar acceso" de cada usuario obtienes el enlace con su usuario ya escrito y su contraseña, listo para enviar.</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-linea bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-linea p-3">
          <span className="text-sm text-acero">Solo el administrador ve las contraseñas. Se registran las creadas o cambiadas desde esta plataforma.</span>
          <label className="flex shrink-0 items-center gap-2 font-bold">
            <input type="checkbox" className="size-5 accent-esmalte" checked={verClaves} onChange={(e) => setVerClaves(e.target.checked)} />
            Mostrar contraseñas
          </label>
        </div>
        <table className="w-full min-w-[60rem] text-left">
          <thead className="border-b border-linea text-acero">
            <tr><th className="p-3">Usuario</th><th className="p-3">Tipo</th><th className="p-3">Tienda</th>
              <th className="p-3">Contraseña</th><th className="p-3">Estado</th><th className="p-3"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {perfiles.map((p) => {
              const c = claves[p.id];
              return (
                <tr key={p.id} className={`border-b border-linea last:border-0 ${p.active ? '' : 'text-acero'}`}>
                  <td className="p-3 font-bold">{p.username}</td>
                  <td className="p-3">{ROLES[p.role]}</td>
                  <td className="p-3">{nombreTienda(p.store_id)}</td>
                  <td className="p-3">
                    {!c ? <span className="text-sm text-acero">No registrada</span>
                      : verClaves ? <span><span className="font-mono font-bold select-all">{c.password}</span>
                        <span className="block text-xs text-acero">{fechaHora(c.updated_at)}</span></span>
                      : <span className="tracking-widest text-acero">••••••••</span>}
                  </td>
                  <td className="p-3">
                    {!p.active ? 'Desactivado' : p.must_change_password ? 'Pendiente de primer acceso' : 'Activo'}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Boton variante="secundario" onClick={() => copiar(mensajeAcceso(p.username, c?.password), `Acceso de ${p.username} copiado: pégalo en un correo o WhatsApp.`)}>
                        Copiar acceso</Boton>
                      <Boton variante="secundario" disabled={!!ocupado} onClick={() => restablecer(p)}>Nueva contraseña</Boton>
                      {p.id !== yo?.id && (
                        <Boton variante={p.active ? 'peligroDiscreto' : 'secundario'} disabled={!!ocupado} onClick={() => cambiarActivo(p)}>
                          {p.active ? 'Desactivar' : 'Activar'}
                        </Boton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form onSubmit={crear} className="flex max-w-xl flex-col gap-4 rounded-lg border border-linea bg-white p-6">
        <h2 className="text-xl font-bold">Crear usuario</h2>
        <Campo id="nuevo-usuario" etiqueta="Nombre de usuario" required value={nuevoUsuario}
          onChange={(e) => setNuevoUsuario(e.target.value)} autoCapitalize="none"
          ayuda="El que quieras, por ejemplo: Tienda Alicante. Solo no puede llevar @." />
        <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
          <legend className="mb-1 font-bold">Tipo</legend>
          {(['STORE', 'RESPONSABLE', 'ADMIN'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name="rol" checked={nuevoRol === r} onChange={() => setNuevoRol(r)} className="size-5 accent-esmalte" />
              {ROLES[r]}
            </label>
          ))}
        </fieldset>
        {nuevoRol === 'STORE' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="nueva-tienda" className="font-bold">Tienda</label>
            <select id="nueva-tienda" required value={nuevaTienda} onChange={(e) => setNuevaTienda(e.target.value)}
              className="min-h-11 rounded-md border border-linea bg-white px-3 text-lg">
              <option value="">Elige la tienda</option>
              {tiendas.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select>
          </div>
        )}
        <Boton type="submit" disabled={ocupado === 'crear'} className="self-start">
          {ocupado === 'crear' ? 'Creando…' : 'Crear usuario'}
        </Boton>
      </form>

      <Dialogo abierto={!!credencial} titulo="Contraseña temporal" onCerrar={() => setCredencial(null)}>
        {credencial && <>
          <PasswordTemporal usuario={credencial.usuario} password={credencial.password} />
          <Boton variante="secundario" onClick={() => copiar(mensajeAcceso(credencial.usuario, credencial.password), 'Acceso copiado con el enlace, el usuario y la contraseña.')}>
            Copiar acceso completo con enlace</Boton>
        </>}
        <Boton onClick={() => setCredencial(null)}>Hecho</Boton>
      </Dialogo>
    </section>
  );
}
