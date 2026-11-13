import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { llamarUsuarios, mensajeError, supabase } from '../../lib/supabase';
import type { Perfil, Rol, Tienda } from '../../lib/tipos';
import { useSesion } from '../../auth/Sesion';
import { Aviso, Boton, Campo, Dialogo, PasswordTemporal } from '../../components/ui';

type Credencial = { usuario: string; password: string } | null;

export default function Usuarios() {
  const { perfil: yo } = useSesion();
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [credencial, setCredencial] = useState<Credencial>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [nuevoRol, setNuevoRol] = useState<Rol>('STORE');
  const [nuevaTienda, setNuevaTienda] = useState('');

  const cargar = useCallback(async () => {
    const [p, t] = await Promise.all([
      supabase.from('profiles').select('*').order('username'),
      supabase.from('stores').select('*').order('code'),
    ]);
    if (p.error || t.error) { setError(mensajeError(p.error ?? t.error)); return; }
    setPerfiles(p.data as Perfil[]); setTiendas(t.data as Tienda[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombreTienda = (id: number | null) => {
    const t = tiendas.find((x) => x.id === id);
    return t ? `${t.code} · ${t.name}` : '—';
  };

  async function accion(clave: string, fn: () => Promise<void>) {
    setError(null); setOcupado(clave);
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

  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-3xl font-bold">Usuarios</h1>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="overflow-x-auto rounded-lg border border-linea bg-white">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="border-b border-linea text-acero">
            <tr><th className="p-3">Usuario</th><th className="p-3">Tipo</th><th className="p-3">Tienda</th>
              <th className="p-3">Estado</th><th className="p-3"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {perfiles.map((p) => (
              <tr key={p.id} className={`border-b border-linea last:border-0 ${p.active ? '' : 'text-acero'}`}>
                <td className="p-3 font-bold">{p.username}</td>
                <td className="p-3">{p.role === 'MASTER' ? 'Central' : 'Tienda'}</td>
                <td className="p-3">{nombreTienda(p.store_id)}</td>
                <td className="p-3">
                  {!p.active ? 'Desactivado' : p.must_change_password ? 'Pendiente de primer acceso' : 'Activo'}
                </td>
                <td className="flex justify-end gap-2 p-3">
                  <Boton variante="secundario" disabled={!!ocupado} onClick={() => restablecer(p)}>Nueva contraseña</Boton>
                  {p.id !== yo?.id && (
                    <Boton variante={p.active ? 'peligroDiscreto' : 'secundario'} disabled={!!ocupado} onClick={() => cambiarActivo(p)}>
                      {p.active ? 'Desactivar' : 'Activar'}
                    </Boton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={crear} className="flex max-w-xl flex-col gap-4 rounded-lg border border-linea bg-white p-6">
        <h2 className="text-xl font-bold">Crear usuario</h2>
        <Campo id="nuevo-usuario" etiqueta="Nombre de usuario" required value={nuevoUsuario}
          onChange={(e) => setNuevoUsuario(e.target.value)} autoCapitalize="none"
          ayuda="En minúsculas, sin espacios. Por ejemplo: tienda10" />
        <fieldset className="flex gap-6">
          <legend className="mb-1 font-bold">Tipo</legend>
          {(['STORE', 'MASTER'] as const).map((r) => (
            <label key={r} className="flex items-center gap-2">
              <input type="radio" name="rol" checked={nuevoRol === r} onChange={() => setNuevoRol(r)} className="size-5 accent-esmalte" />
              {r === 'STORE' ? 'Tienda' : 'Central'}
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
        {credencial && <PasswordTemporal usuario={credencial.usuario} password={credencial.password} />}
        <Boton onClick={() => setCredencial(null)}>Hecho</Boton>
      </Dialogo>
    </section>
  );
}
