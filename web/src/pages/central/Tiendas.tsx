import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensajeError, supabase } from '../../lib/supabase';
import type { Tienda } from '../../lib/tipos';
import { Aviso, Boton } from '../../components/ui';

function FilaTienda({ t, alGuardar, alBorrar }:
  { t: Tienda; alGuardar: (c: Partial<Tienda>) => Promise<void>; alBorrar: () => Promise<void> }) {
  const [codigo, setCodigo] = useState(t.code);
  const [nombre, setNombre] = useState(t.name);
  const [direccion, setDireccion] = useState(t.address ?? '');
  const cambiado = codigo.trim() !== t.code || nombre.trim() !== t.name || direccion.trim() !== (t.address ?? '');
  return (
    <tr className={`border-b border-linea last:border-0 ${t.active ? '' : 'bg-porcelana text-acero'}`}>
      <td className="p-3"><input aria-label="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)}
        className="min-h-10 w-24 rounded-md border border-linea px-3 font-bold" /></td>
      <td className="p-3"><input aria-label={`Nombre de ${t.code}`} value={nombre} onChange={(e) => setNombre(e.target.value)}
        className="min-h-10 w-full rounded-md border border-linea px-3" /></td>
      <td className="p-3"><input aria-label={`Dirección de ${t.code}`} value={direccion} placeholder="Dirección"
        onChange={(e) => setDireccion(e.target.value)} className="min-h-10 w-full rounded-md border border-linea px-3" /></td>
      <td className="p-3 whitespace-nowrap">{t.active ? 'Activa' : 'Desactivada'}</td>
      <td className="p-3">
        <div className="flex justify-end gap-2">
          <Boton disabled={!cambiado || !nombre.trim() || !codigo.trim()}
            onClick={() => alGuardar({ code: codigo.trim(), name: nombre.trim(), address: direccion.trim() || null })}>Guardar</Boton>
          <Boton variante="secundario" onClick={() => alGuardar({ active: !t.active })}>{t.active ? 'Desactivar' : 'Activar'}</Boton>
          <Boton variante="peligroDiscreto" onClick={alBorrar}>Borrar</Boton>
        </div>
      </td>
    </tr>
  );
}

export default function Tiendas() {
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState('');

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('stores').select('*').order('code');
    if (error) setError(mensajeError(error)); else setTiendas(data as Tienda[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const resultado = async (op: PromiseLike<{ error: unknown }>, mensaje: string) => {
    setError(null); setOk(null);
    const { error } = await op;
    if (error) {
      const m = mensajeError(error);
      setError(/duplicate|unique/i.test(m) ? 'Ya existe una tienda con ese código.' : m);
      return false;
    }
    setOk(mensaje); await cargar(); return true;
  };

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    const hecho = await resultado(supabase.from('stores').insert({ code: codigo.trim(), name: nombre.trim(), address: direccion.trim() || null }),
      `Tienda ${codigo.trim()} creada. Ya puedes crearle un usuario en Usuarios.`);
    if (hecho) { setCodigo(''); setNombre(''); setDireccion(''); }
  };
  const borrar = (t: Tienda) => {
    if (!confirm(`¿Borrar definitivamente la tienda ${t.code} · ${t.name}? Solo es posible si no tiene usuarios ni incidencias.`)) return Promise.resolve();
    return resultado(supabase.rpc('borrar_tienda', { p_id: t.id }), `Tienda ${t.code} borrada.`).then(() => undefined);
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Tiendas</h1>
        <p className="text-acero">Una tienda con incidencias no se puede borrar: desactívala y sus usuarios dejarán de poder entrar, conservando su historial.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      <div className="overflow-x-auto rounded-lg border border-linea bg-white">
        <table className="w-full min-w-[56rem] text-left">
          <thead className="border-b border-linea text-acero">
            <tr><th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3">Dirección</th><th className="p-3">Estado</th>
              <th className="p-3"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {tiendas.map((t) => <FilaTienda key={`${t.id}-${t.code}-${t.name}-${t.address}-${t.active}`} t={t}
              alGuardar={(c) => resultado(supabase.from('stores').update(c).eq('id', t.id), `${c.code ?? t.code} guardada.`).then(() => undefined)}
              alBorrar={() => borrar(t)} />)}
          </tbody>
        </table>
      </div>
      <form onSubmit={crear} className="flex flex-wrap items-end gap-3 rounded-lg border border-linea bg-white p-5">
        <h2 className="w-full text-xl font-bold">Nueva tienda</h2>
        <label className="flex flex-col gap-1 font-bold">Código
          <input required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="T10" className="min-h-11 w-28 rounded-md border border-linea px-3 font-normal" /></label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-bold">Nombre
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tienda Valencia" className="min-h-11 rounded-md border border-linea px-3 font-normal" /></label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-bold">Dirección
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="min-h-11 rounded-md border border-linea px-3 font-normal" /></label>
        <Boton type="submit">Crear tienda</Boton>
      </form>
    </section>
  );
}
