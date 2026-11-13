import { useCallback, useEffect, useState } from 'react';
import { mensajeError, supabase } from '../../lib/supabase';
import type { Tienda } from '../../lib/tipos';
import { Aviso, Boton } from '../../components/ui';

function FilaTienda({ t, alGuardar }: { t: Tienda; alGuardar: (c: Partial<Tienda>) => Promise<void> }) {
  const [nombre, setNombre] = useState(t.name);
  const [direccion, setDireccion] = useState(t.address ?? '');
  const cambiado = nombre.trim() !== t.name || direccion.trim() !== (t.address ?? '');
  return (
    <tr className="border-b border-linea last:border-0">
      <td className="p-3"><span className="rounded bg-esmalte px-2 py-1 font-bold text-white">{t.code}</span></td>
      <td className="p-3"><input aria-label={`Nombre de ${t.code}`} value={nombre} onChange={(e) => setNombre(e.target.value)}
        className="min-h-10 w-full rounded-md border border-linea px-3" /></td>
      <td className="p-3"><input aria-label={`Dirección de ${t.code}`} value={direccion} placeholder="Dirección"
        onChange={(e) => setDireccion(e.target.value)} className="min-h-10 w-full rounded-md border border-linea px-3" /></td>
      <td className="p-3 text-right">
        <Boton disabled={!cambiado || !nombre.trim()}
          onClick={() => alGuardar({ name: nombre.trim(), address: direccion.trim() || null })}>Guardar</Boton>
      </td>
    </tr>
  );
}

export default function Tiendas() {
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('stores').select('*').order('code');
    if (error) setError(mensajeError(error)); else setTiendas(data as Tienda[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (t: Tienda, c: Partial<Tienda>) => {
    setError(null); setOk(null);
    const { error } = await supabase.from('stores').update(c).eq('id', t.id);
    if (error) setError(mensajeError(error)); else setOk(`${t.code} guardada.`);
    await cargar();
  };

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Tiendas</h1>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      <div className="overflow-x-auto rounded-lg border border-linea bg-white">
        <table className="w-full min-w-[40rem] text-left">
          <thead className="border-b border-linea text-acero">
            <tr><th className="p-3">Código</th><th className="p-3">Nombre</th><th className="p-3">Dirección</th>
              <th className="p-3"><span className="sr-only">Acciones</span></th></tr>
          </thead>
          <tbody>
            {tiendas.map((t) => <FilaTienda key={`${t.id}-${t.name}-${t.address}`} t={t} alGuardar={(c) => guardar(t, c)} />)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
