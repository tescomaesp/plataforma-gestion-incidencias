import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { mensajeError, supabase } from '../lib/supabase';
import { colorEstado, ESTADOS, fecha, RESULTADOS } from '../lib/formato';
import type { Estado, Incidencia, Resultado, Tienda } from '../lib/tipos';
import { useSesion } from '../auth/Sesion';
import { Aviso, Boton, Pastilla } from '../components/ui';

type Fila = Incidencia & { stores: { code: string; name: string } | null };
const POR_PAGINA = 50;

export default function Tickets() {
  const { esCentral } = useSesion();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [estado, setEstado] = useState<'PENDIENTES' | Estado | 'TODOS'>('PENDIENTES');
  const [tienda, setTienda] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (esCentral) supabase.from('stores').select('*').order('code').then(({ data }) => setTiendas((data ?? []) as Tienda[]));
  }, [esCentral]);

  const cargar = useCallback(async (desde: number) => {
    setCargando(true); setError(null);
    let c = supabase.from('incidents').select('*, stores(code, name)')
      .order('created_at', { ascending: false }).range(desde, desde + POR_PAGINA);
    if (estado === 'PENDIENTES') c = c.in('status', ['ABIERTO', 'EN_REVISION']);
    else if (estado !== 'TODOS') c = c.eq('status', estado);
    if (tienda) c = c.eq('store_id', Number(tienda));
    const t = texto.trim().replace(/[,()%]/g, ' ');
    if (t) c = c.or(`number.ilike.%${t}%,customer_full_name.ilike.%${t}%,sku.ilike.%${t}%,product_description.ilike.%${t}%,customer_email.ilike.%${t}%,customer_phone.ilike.%${t}%`);
    const { data, error } = await c;
    setCargando(false);
    if (error) { setError(mensajeError(error)); return; }
    const lista = (data ?? []) as Fila[];
    setHayMas(lista.length > POR_PAGINA);
    setFilas((prev) => (desde === 0 ? [] : prev).concat(lista.slice(0, POR_PAGINA)));
  }, [estado, tienda, texto]);

  useEffect(() => { const t = setTimeout(() => cargar(0), 250); return () => clearTimeout(t); }, [cargar]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">Tickets de incidencia</h1>
        <Link to="/nuevo" className="inline-flex min-h-11 items-center rounded-md bg-esmalte px-5 font-bold text-white hover:bg-esmalte-oscuro">
          + Nuevo ticket
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}
          className="min-h-11 rounded-md border border-linea bg-white px-3">
          <option value="PENDIENTES">Pendientes (abiertos y en revisión)</option>
          <option value="ABIERTO">Abiertos</option>
          <option value="EN_REVISION">En revisión</option>
          <option value="RESUELTO">Resueltos</option>
          <option value="TODOS">Todos</option>
        </select>
        {esCentral && (
          <select aria-label="Tienda" value={tienda} onChange={(e) => setTienda(e.target.value)}
            className="min-h-11 rounded-md border border-linea bg-white px-3">
            <option value="">Todas las tiendas</option>
            {tiendas.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </select>
        )}
        <input type="search" aria-label="Buscar" placeholder="Buscar nº, cliente, referencia…" value={texto}
          onChange={(e) => setTexto(e.target.value)} className="min-h-11 min-w-64 flex-1 rounded-md border border-linea bg-white px-3" />
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="overflow-x-auto rounded-lg border border-linea bg-white">
        <table className="w-full min-w-[56rem] text-left">
          <thead className="border-b border-linea text-sm text-acero">
            <tr>
              <th className="p-3">Nº</th>{esCentral && <th className="p-3">Tienda</th>}
              <th className="p-3">Producto</th><th className="p-3">Cliente</th>
              <th className="p-3">Incidencia</th><th className="p-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-b border-linea last:border-0 hover:bg-porcelana">
                <td className="p-3 font-bold">
                  <Link to={`/ticket/${f.id}`} className="text-esmalte underline-offset-4 hover:underline">{f.number}</Link>
                </td>
                {esCentral && <td className="p-3 whitespace-nowrap">{f.stores?.code} · {f.stores?.name}</td>}
                <td className="p-3"><span className="font-bold">{f.sku}</span> <span className="text-acero">{f.product_description}</span></td>
                <td className="p-3">{f.customer_full_name}</td>
                <td className="p-3 whitespace-nowrap">{fecha(f.incident_date)}</td>
                <td className="p-3">
                  <Pastilla className={colorEstado[f.status]}>{ESTADOS[f.status]}</Pastilla>
                  {f.resolution_type && <span className="ml-2 text-sm text-acero">{RESULTADOS[f.resolution_type as Resultado]}</span>}
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-acero">No hay tickets con estos filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {cargando && <p className="text-acero" role="status">Cargando…</p>}
      {hayMas && !cargando && <Boton variante="secundario" className="self-center" onClick={() => cargar(filas.length)}>Cargar más</Boton>}
    </section>
  );
}
