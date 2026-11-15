import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { mensajeError, supabase } from '../lib/supabase';
import { descargarExcel } from '../lib/excel';
import { ESTADOS, fecha, hoyISO, RESULTADOS } from '../lib/formato';
import type { Estado, Resultado, Tienda } from '../lib/tipos';
import { useSesion } from '../auth/Sesion';
import { Aviso, Boton } from '../components/ui';

interface Stats {
  resumen: { total: number; abiertos: number; en_revision: number; resueltos: number };
  productos: { sku: string; descripcion: string; incidencias: number }[];
  tiendas: { codigo: string; tienda: string; incidencias: number }[];
  clientes: { cliente: string; correo: string | null; telefono: string | null; incidencias: number }[];
  resultados: Record<string, number>;
  defectos: Record<string, number>;
}

function Tarjeta({ titulo, valor, color = 'text-tinta' }: { titulo: string; valor: number; color?: string }) {
  return (
    <div className="rounded-lg border border-linea bg-white p-4">
      <p className="text-sm text-acero">{titulo}</p>
      <p className={`text-3xl font-bold ${color}`}>{valor.toLocaleString('es-ES')}</p>
    </div>
  );
}

function Ranking<T>({ titulo, filas, columnas }: { titulo: string; filas: T[]; columnas: { t: string; v: (f: T) => string | number; ancho?: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => Number(columnas[columnas.length - 1].v(f))));
  return (
    <div className="rounded-lg border border-linea bg-white p-4">
      <h2 className="mb-3 text-lg font-bold">{titulo}</h2>
      {filas.length === 0 ? <p className="text-acero">Sin datos en este periodo.</p> : (
        <ol className="flex flex-col gap-2">
          {filas.slice(0, 10).map((f, i) => {
            const n = Number(columnas[columnas.length - 1].v(f));
            return (
              <li key={i} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <span className="w-6 shrink-0 text-acero">{i + 1}.</span>
                  <span className="flex-1 truncate">{columnas.slice(0, -1).map((c) => c.v(f)).filter(Boolean).join(' · ')}</span>
                  <span className="font-bold">{n}</span>
                </div>
                <div className="ml-8 h-1.5 rounded bg-porcelana"><div className="h-1.5 rounded bg-esmalte" style={{ width: `${(n / max) * 100}%` }} /></div>
              </li>
            );
          })}
        </ol>
      )}
      {filas.length > 10 && <p className="mt-3 text-sm text-acero">Y {filas.length - 10} más en el Excel.</p>}
    </div>
  );
}

export default function Panel() {
  const { esCentral, tienda } = useSesion();
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [storeId, setStoreId] = useState('');
  const [historicas, setHistoricas] = useState(true);
  const [cliente, setCliente] = useState('');
  const [s, setS] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    if (esCentral) supabase.from('stores').select('*').order('code').then(({ data }) => setTiendas((data ?? []) as Tienda[]));
  }, [esCentral]);

  const cargar = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase.rpc('estadisticas', {
      p_desde: desde || null, p_hasta: hasta || null, p_tienda: storeId ? Number(storeId) : null, p_historicas: historicas,
      p_cliente: cliente.trim() || null,
    });
    if (error) setError(mensajeError(error)); else setS(data as Stats);
  }, [desde, hasta, storeId, historicas, cliente]);
  useEffect(() => { const t = setTimeout(cargar, 300); return () => clearTimeout(t); }, [cargar]);

  async function exportar() {
    if (!s) return;
    setExportando(true); setError(null);
    try {
      // Detalle de todas las incidencias del filtro, por bloques de 1000.
      const detalle: (string | number | null)[][] = [];
      for (let desdeFila = 0; ; desdeFila += 1000) {
        let c = supabase.from('incidents').select('*, stores(code, name), defect_types(name)')
          .order('incident_date', { ascending: false }).range(desdeFila, desdeFila + 999);
        if (desde) c = c.gte('incident_date', desde);
        if (hasta) c = c.lte('incident_date', hasta);
        if (storeId) c = c.eq('store_id', Number(storeId));
        if (!historicas) c = c.eq('is_historical', false);
        const q = cliente.trim().replace(/[,()%]/g, ' ');
        if (q) c = c.or(`customer_full_name.ilike.%${q}%,customer_email.ilike.%${q}%,customer_phone.ilike.%${q}%`);
        const { data, error } = await c;
        if (error) throw error;
        for (const i of data ?? []) detalle.push([
          i.number, i.stores?.code, i.stores?.name, i.incident_date, i.purchase_date, i.sku, i.product_description,
          i.defect_types?.name, i.reason, i.customer_full_name, i.customer_email, i.customer_phone,
          ESTADOS[i.status as Estado], i.resolution_type ? RESULTADOS[i.resolution_type as Resultado] : '', i.resolution_text,
          i.resolved_at ? fecha(i.resolved_at) : '', i.is_historical ? 'Sí' : 'No',
        ]);
        if ((data ?? []).length < 1000) break;
      }
      const filtro = [desde && `desde ${fecha(desde)}`, hasta && `hasta ${fecha(hasta)}`, cliente.trim() && `cliente "${cliente.trim()}"`].filter(Boolean).join(' ') || 'todo el periodo';
      await descargarExcel(`incidencias_${hoyISO()}.xlsx`, [
        { nombre: 'Resumen', columnas: [{ titulo: 'Indicador', ancho: 30 }, { titulo: 'Valor', ancho: 16 }], filas: [
          ['Periodo', filtro], ['Total de incidencias', s.resumen.total], ['Abiertas', s.resumen.abiertos],
          ['En revisión', s.resumen.en_revision], ['Resueltas', s.resumen.resueltos],
          ...Object.entries(s.resultados).map(([k, v]) => [`Resultado: ${RESULTADOS[k as Resultado] ?? 'Pendiente'}`, v]),
          ...Object.entries(s.defectos).map(([k, v]) => [`Defecto: ${k}`, v]),
        ] },
        { nombre: 'Productos', columnas: [{ titulo: 'Referencia', texto: true }, { titulo: 'Descripción', ancho: 50 }, { titulo: 'Incidencias' }],
          filas: s.productos.map((p) => [p.sku, p.descripcion, p.incidencias]) },
        ...(esCentral ? [{ nombre: 'Tiendas', columnas: [{ titulo: 'Código' }, { titulo: 'Tienda', ancho: 30 }, { titulo: 'Incidencias' }],
          filas: s.tiendas.map((t) => [t.codigo, t.tienda, t.incidencias]) }] : []),
        { nombre: 'Clientes', columnas: [{ titulo: 'Cliente', ancho: 30 }, { titulo: 'Correo', ancho: 30 }, { titulo: 'Teléfono', texto: true }, { titulo: 'Incidencias' }],
          filas: s.clientes.map((c) => [c.cliente, c.correo, c.telefono, c.incidencias]) },
        { nombre: 'Incidencias', columnas: [
          { titulo: 'Nº' }, { titulo: 'Código tienda' }, { titulo: 'Tienda', ancho: 25 }, { titulo: 'Fecha incidencia' }, { titulo: 'Fecha compra' },
          { titulo: 'Referencia', texto: true }, { titulo: 'Producto', ancho: 40 }, { titulo: 'Tipo de defecto', ancho: 22 }, { titulo: 'Motivo', ancho: 50 },
          { titulo: 'Cliente', ancho: 25 }, { titulo: 'Correo', ancho: 28 }, { titulo: 'Teléfono', texto: true }, { titulo: 'Estado' },
          { titulo: 'Resultado' }, { titulo: 'Respuesta', ancho: 50 }, { titulo: 'Fecha resolución' }, { titulo: 'Importada' },
        ], filas: detalle },
      ]);
    } catch (e) { setError(mensajeError(e)); } finally { setExportando(false); }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{esCentral ? 'Panel de control' : 'Estadísticas de la tienda'}</h1>
          {!esCentral && tienda && <p className="text-acero">{tienda.code} · {tienda.name}</p>}
        </div>
        <Boton onClick={exportar} disabled={!s || exportando}>{exportando ? 'Preparando Excel…' : 'Descargar Excel'}</Boton>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-linea bg-white p-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm font-bold">Buscar cliente
          <input type="search" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre, correo o teléfono"
            className="min-h-10 rounded-md border border-linea px-2 font-normal" /></label>
        <label className="flex flex-col gap-1 text-sm font-bold">Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="min-h-10 rounded-md border border-linea px-2 font-normal" /></label>
        <label className="flex flex-col gap-1 text-sm font-bold">Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="min-h-10 rounded-md border border-linea px-2 font-normal" /></label>
        {esCentral && (
          <label className="flex flex-col gap-1 text-sm font-bold">Tienda
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="min-h-10 rounded-md border border-linea bg-white px-2 font-normal">
              <option value="">Todas</option>
              {tiendas.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
            </select></label>
        )}
        <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" className="size-5 accent-esmalte" checked={historicas} onChange={(e) => setHistoricas(e.target.checked)} />
          Incluir incidencias importadas
        </label>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}
      {s && <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta titulo="Total" valor={s.resumen.total} />
          <Tarjeta titulo="Abiertos" valor={s.resumen.abiertos} color="text-ambar" />
          <Tarjeta titulo="En revisión" valor={s.resumen.en_revision} color="text-esmalte" />
          <Tarjeta titulo="Resueltos" valor={s.resumen.resueltos} color="text-salvia" />
        </div>
        {esCentral && s.resumen.abiertos + s.resumen.en_revision > 0 && (
          <Link to="/" className="self-start font-bold text-esmalte hover:underline">
            Ver los {s.resumen.abiertos + s.resumen.en_revision} tickets pendientes de resolver →
          </Link>
        )}
        <div className={`grid gap-4 ${esCentral ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <Ranking titulo="Productos con más incidencias" filas={s.productos}
            columnas={[{ t: 'Ref', v: (p) => p.sku }, { t: 'Desc', v: (p) => p.descripcion }, { t: 'N', v: (p) => p.incidencias }]} />
          {esCentral && <Ranking titulo="Tiendas con más incidencias" filas={s.tiendas}
            columnas={[{ t: 'Cod', v: (t) => t.codigo }, { t: 'Tienda', v: (t) => t.tienda }, { t: 'N', v: (t) => t.incidencias }]} />}
          <Ranking titulo="Clientes con más incidencias" filas={s.clientes}
            columnas={[{ t: 'Cliente', v: (c) => c.cliente }, { t: 'Contacto', v: (c) => c.correo || c.telefono || '' }, { t: 'N', v: (c) => c.incidencias }]} />
        </div>
      </>}
    </section>
  );
}
