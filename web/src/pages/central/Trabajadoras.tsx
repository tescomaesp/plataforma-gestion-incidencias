import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensajeError, supabase } from '../../lib/supabase';
import type { Tienda, Trabajadora } from '../../lib/tipos';
import { Aviso, Boton } from '../../components/ui';

function FilaTrabajadora({ w, alGuardar }: { w: Trabajadora; alGuardar: (cambios: Partial<Trabajadora>) => Promise<void> }) {
  const [nombre, setNombre] = useState(w.full_name);
  const cambiado = nombre.trim() !== w.full_name && nombre.trim().length > 0;
  return (
    <li className={`flex items-center gap-2 py-2 ${w.active ? '' : 'text-acero'}`}>
      <input aria-label={`Nombre de ${w.full_name}`} value={nombre} onChange={(e) => setNombre(e.target.value)}
        disabled={!w.active} className="min-h-10 min-w-0 flex-1 rounded-md border border-linea bg-white px-3 disabled:bg-porcelana" />
      {cambiado && <Boton className="shrink-0" onClick={() => alGuardar({ full_name: nombre.trim() })}>Guardar</Boton>}
      <Boton variante={w.active ? 'peligroDiscreto' : 'secundario'} className="shrink-0"
        onClick={() => alGuardar({ active: !w.active })}>
        {w.active ? 'Dar de baja' : 'Reactivar'}
      </Boton>
    </li>
  );
}

function NuevaTrabajadora({ alCrear }: { alCrear: (nombre: string) => Promise<void> }) {
  const [nombre, setNombre] = useState('');
  const enviar = async (e: FormEvent) => { e.preventDefault(); await alCrear(nombre.trim()); setNombre(''); };
  return (
    <form onSubmit={enviar} className="flex gap-2 pt-2">
      <input aria-label="Nombre de la nueva trabajadora" placeholder="Nombre y apellidos" required value={nombre}
        onChange={(e) => setNombre(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-md border border-linea bg-white px-3" />
      <Boton type="submit" variante="secundario" className="shrink-0">Añadir</Boton>
    </form>
  );
}

export default function Trabajadoras() {
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [trabajadoras, setTrabajadoras] = useState<Trabajadora[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [t, w] = await Promise.all([
      supabase.from('stores').select('*').order('code'),
      supabase.from('store_workers').select('*').order('active', { ascending: false }).order('full_name'),
    ]);
    if (t.error || w.error) { setError(mensajeError(t.error ?? w.error)); return; }
    setTiendas(t.data as Tienda[]); setTrabajadoras(w.data as Trabajadora[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const ejecutar = async (op: PromiseLike<{ error: unknown }>) => {
    setError(null);
    const { error } = await op;
    if (error) setError(mensajeError(error));
    await cargar();
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Trabajadoras</h1>
        <p className="text-acero">Las trabajadoras dadas de baja no aparecen en las tiendas, pero conservan su historial.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tiendas.map((t) => (
          <div key={t.id} className="rounded-lg border border-linea bg-white p-4">
            <h2 className="flex items-baseline gap-2 text-lg font-bold">
              <span className="rounded bg-esmalte px-2 text-white">{t.code}</span>{t.name}
            </h2>
            <ul className="divide-y divide-linea">
              {trabajadoras.filter((w) => w.store_id === t.id).map((w) => (
                <FilaTrabajadora key={`${w.id}-${w.full_name}-${w.active}`} w={w}
                  alGuardar={(c) => ejecutar(supabase.from('store_workers').update(c).eq('id', w.id))} />
              ))}
            </ul>
            <NuevaTrabajadora alCrear={(n) => ejecutar(supabase.from('store_workers').insert({ store_id: t.id, full_name: n }))} />
          </div>
        ))}
      </div>
    </section>
  );
}
