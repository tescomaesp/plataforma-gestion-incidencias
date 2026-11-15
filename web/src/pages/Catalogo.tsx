import { useCallback, useEffect, useState } from 'react';
import { mensajeError, supabase } from '../lib/supabase';
import { descargarExcel, leerExcel, type Fila } from '../lib/excel';
import { ESTADOS_PRODUCTO, fechaHora, hoyISO } from '../lib/formato';
import type { EstadoProducto, TipoDefecto } from '../lib/tipos';
import { Aviso, Boton } from '../components/ui';

const ALIAS: Record<string, string> = {
  referencia: 'sku', sku: 'sku', producto: 'sku', codigo: 'sku', articulo: 'sku',
  descripcion: 'descripcion', nombre: 'descripcion', estado: 'estado',
};
interface Resumen {
  total: number; nuevos: number; actualizados: number; sin_cambios: number; desactivados: number; errores: number;
  detalle_errores: { fila: number; sku: string; error: string }[];
  cambios: { tipo: 'NUEVO' | 'CAMBIO'; sku: string; descripcion?: string; estado?: string;
    antes?: { descripcion: string; estado: string; activo: boolean }; despues?: { descripcion: string; estado: string } }[];
}
const estadoTxt = (e?: string) => ESTADOS_PRODUCTO[e as EstadoProducto] ?? e ?? '';

function TiposDefecto() {
  const [tipos, setTipos] = useState<TipoDefecto[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const { data } = await supabase.from('defect_types').select('*').order('sort').order('name');
    setTipos((data ?? []) as TipoDefecto[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const ejecutar = async (op: PromiseLike<{ error: unknown }>) => {
    setError(null); const { error } = await op; if (error) setError(mensajeError(error)); await cargar();
  };
  return (
    <div className="rounded-lg border border-linea bg-white p-5">
      <h2 className="text-xl font-bold">Tipos de defecto</h2>
      <p className="mb-3 text-acero">Aparecen en el formulario de las tiendas. Los desactivados dejan de ofrecerse, pero se conservan en los tickets antiguos.</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <ul className="divide-y divide-linea">
        {tipos.map((t) => (
          <li key={`${t.id}-${t.name}-${t.active}`} className={`flex items-center gap-2 py-2 ${t.active ? '' : 'text-acero'}`}>
            <input defaultValue={t.name} aria-label={`Nombre de ${t.name}`} disabled={!t.active}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name &&
                ejecutar(supabase.from('defect_types').update({ name: e.target.value.trim() }).eq('id', t.id))}
              className="min-h-10 min-w-0 flex-1 rounded-md border border-linea px-3 disabled:bg-porcelana" />
            <Boton variante={t.active ? 'peligroDiscreto' : 'secundario'} className="shrink-0"
              onClick={() => ejecutar(supabase.from('defect_types').update({ active: !t.active }).eq('id', t.id))}>
              {t.active ? 'Desactivar' : 'Reactivar'}</Boton>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        ejecutar(supabase.from('defect_types').insert({ name: nuevo.trim(), sort: 50 })).then(() => setNuevo(''));
      }}>
        <input required value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nuevo tipo de defecto" aria-label="Nuevo tipo de defecto"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-linea px-3" />
        <Boton type="submit" variante="secundario" className="shrink-0">Añadir</Boton>
      </form>
    </div>
  );
}

export default function Catalogo() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [desactivar, setDesactivar] = useState(false);
  const [previa, setPrevia] = useState<Resumen | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [importaciones, setImportaciones] = useState<Record<string, unknown>[]>([]);
  const [cambios, setCambios] = useState<Record<string, unknown>[]>([]);
  const [filtroSku, setFiltroSku] = useState('');
  const [totalActivos, setTotalActivos] = useState<number | null>(null);

  const cargarHistorial = useCallback(async () => {
    let c = supabase.from('product_changes').select('*').order('changed_at', { ascending: false }).limit(100);
    if (filtroSku.trim()) c = c.ilike('sku', `%${filtroSku.trim()}%`);
    const [{ data: imp }, { data: cam }, { count }] = await Promise.all([
      supabase.from('product_imports').select('*').order('created_at', { ascending: false }).limit(20),
      c,
      supabase.from('products').select('sku', { count: 'exact', head: true }).eq('active', true),
    ]);
    setImportaciones(imp ?? []); setCambios(cam ?? []); setTotalActivos(count ?? null);
  }, [filtroSku]);
  useEffect(() => { const t = setTimeout(cargarHistorial, 250); return () => clearTimeout(t); }, [cargarHistorial]);

  async function descargarPlantilla() {
    setOcupado('plantilla'); setError(null);
    try {
      const productos: (string | null)[][] = [];
      for (let d = 0; ; d += 1000) {
        const { data, error } = await supabase.from('products').select('sku, description, status')
          .eq('active', true).order('sku').range(d, d + 999);
        if (error) throw error;
        productos.push(...(data ?? []).map((p) => [p.sku, p.description, p.status]));
        if ((data ?? []).length < 1000) break;
      }
      await descargarExcel(`catalogo_${hoyISO()}.xlsx`, [
        { nombre: 'Catálogo', columnas: [{ titulo: 'Referencia', texto: true, ancho: 20 }, { titulo: 'Descripción', ancho: 60 }, { titulo: 'Estado', ancho: 28 }],
          filas: productos },
        { nombre: 'Instrucciones', columnas: [{ titulo: 'Cómo usar esta plantilla', ancho: 110 }], filas: [
          ['1. Cambia las descripciones o estados que quieras y añade las novedades en filas nuevas al final.'],
          ['2. La columna Referencia está en formato texto: no la cambies, así Excel no convierte 306048.30 en 306048,3.'],
          ['3. Estado: ACTIVO, DESCATALOGADO_CON_STOCK o DESCATALOGADO_SIN_STOCK. Si lo dejas vacío, se usa el prefijo de la descripción (* sin stock, # con stock).'],
          ['4. Súbela en Catálogo > Importar. Verás un resumen de los cambios antes de aplicarlos.'],
          ['5. Si marcas "Desactivar lo que no venga en el archivo", los productos que hayas borrado de la lista dejarán de ofrecerse (no se borran).'],
          ['También puedes importar directamente el Excel de vuestro sistema con las columnas Producto y Descripción.'],
        ] },
      ]);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); }
  }

  async function elegirArchivo(f: File | undefined) {
    if (!f) return;
    setError(null); setOk(null); setPrevia(null); setFilas(null); setOcupado('leer');
    try {
      const leidas = await leerExcel(f, ALIAS);
      if (!leidas.some((r) => r.sku)) throw new Error('No encuentro la columna de referencias (Referencia, SKU o Producto).');
      setFilas(leidas); setArchivo(f.name);
      await calcularPrevia(leidas, desactivar);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); }
  }
  async function calcularPrevia(lista: Fila[], desact: boolean) {
    setOcupado('previa');
    const { data, error } = await supabase.rpc('catalogo_importar', { p_filas: lista, p_nombre: archivo, p_desactivar_ausentes: desact, p_aplicar: false });
    setOcupado(null);
    if (error) setError(mensajeError(error)); else setPrevia(data as Resumen);
  }
  async function aplicar() {
    if (!filas) return;
    setOcupado('aplicar'); setError(null);
    const { data, error } = await supabase.rpc('catalogo_importar', { p_filas: filas, p_nombre: archivo, p_desactivar_ausentes: desactivar, p_aplicar: true });
    setOcupado(null);
    if (error) { setError(mensajeError(error)); return; }
    const r = data as Resumen;
    setOk(`Importación aplicada: ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.desactivados} desactivados, ${r.errores} filas con errores (no aplicadas).`);
    setPrevia(null); setFilas(null);
    await cargarHistorial();
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Catálogo de productos</h1>
        {totalActivos !== null && <p className="text-acero">{totalActivos.toLocaleString('es-ES')} productos activos.</p>}
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border border-linea bg-white p-5">
          <h2 className="text-xl font-bold">1. Descargar la plantilla</h2>
          <p className="text-acero">Excel con el catálogo actual. Edítalo y añade las novedades.</p>
          <Boton variante="secundario" className="self-start" onClick={descargarPlantilla} disabled={!!ocupado}>
            {ocupado === 'plantilla' ? 'Preparando…' : 'Descargar catálogo en Excel'}</Boton>
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-linea bg-white p-5">
          <h2 className="text-xl font-bold">2. Importar el Excel</h2>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-5 accent-esmalte" checked={desactivar}
              onChange={(e) => { setDesactivar(e.target.checked); if (filas) calcularPrevia(filas, e.target.checked); }} />
            Desactivar los productos que no vengan en el archivo
          </label>
          <input type="file" accept=".xlsx" disabled={!!ocupado} onChange={(e) => { elegirArchivo(e.target.files?.[0]); e.target.value = ''; }}
            className="file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-esmalte file:px-4 file:font-bold file:text-white" />
          {ocupado === 'leer' && <p className="text-acero">Leyendo el archivo…</p>}
          {ocupado === 'previa' && <p className="text-acero">Calculando cambios…</p>}
        </div>
      </div>

      {previa && (
        <div className="flex flex-col gap-4 rounded-lg border-2 border-esmalte bg-white p-5">
          <h2 className="text-xl font-bold">Vista previa · {archivo}</h2>
          <p>
            {previa.total} filas: <strong>{previa.nuevos}</strong> productos nuevos, <strong>{previa.actualizados}</strong> con cambios,{' '}
            {previa.sin_cambios} sin cambios{desactivar && <>, <strong>{previa.desactivados}</strong> se desactivarán</>}
            {previa.errores > 0 && <>, <strong className="text-tomate">{previa.errores} con errores</strong> (no se importarán)</>}.
          </p>
          {previa.detalle_errores.length > 0 && (
            <details open className="rounded-md bg-tomate-claro p-3">
              <summary className="cursor-pointer font-bold text-tomate">Filas con errores</summary>
              <ul className="mt-2 max-h-48 overflow-y-auto text-sm">
                {previa.detalle_errores.map((e, i) => <li key={i}>Fila {e.fila}{e.sku && ` (${e.sku})`}: {e.error}</li>)}
              </ul>
            </details>
          )}
          {previa.cambios.length > 0 && (
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="sticky top-0 bg-white text-acero"><tr><th className="p-2">Tipo</th><th className="p-2">Referencia</th><th className="p-2">Antes</th><th className="p-2">Después</th></tr></thead>
                <tbody>
                  {previa.cambios.map((c, i) => (
                    <tr key={i} className="border-t border-linea">
                      <td className="p-2 font-bold">{c.tipo === 'NUEVO' ? 'Nuevo' : 'Cambio'}</td>
                      <td className="p-2">{c.sku}</td>
                      <td className="p-2 text-acero">{c.antes && `${c.antes.descripcion} · ${estadoTxt(c.antes.estado)}${c.antes.activo ? '' : ' · inactivo'}`}</td>
                      <td className="p-2">{c.tipo === 'NUEVO' ? `${c.descripcion} · ${estadoTxt(c.estado)}` : `${c.despues?.descripcion} · ${estadoTxt(c.despues?.estado)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previa.nuevos + previa.actualizados > previa.cambios.length && <p className="mt-2 text-sm text-acero">Se muestran los primeros {previa.cambios.length}.</p>}
            </div>
          )}
          <div className="flex gap-3">
            <Boton onClick={aplicar} disabled={!!ocupado || previa.nuevos + previa.actualizados + (desactivar ? previa.desactivados : 0) === 0}>
              {ocupado === 'aplicar' ? 'Aplicando…' : 'Aplicar importación'}</Boton>
            <Boton variante="discreto" onClick={() => { setPrevia(null); setFilas(null); }}>Cancelar</Boton>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-linea bg-white p-5">
          <h2 className="mb-3 text-xl font-bold">Historial de importaciones</h2>
          {importaciones.length === 0 ? <p className="text-acero">Todavía no hay importaciones.</p> : (
            <ul className="divide-y divide-linea">
              {importaciones.map((i) => (
                <li key={String(i.id)} className="py-2">
                  <p className="font-bold">{String(i.file_name)}</p>
                  <p className="text-sm text-acero">{fechaHora(String(i.created_at))} · {String(i.nuevos)} nuevos · {String(i.actualizados)} cambiados · {String(i.desactivados)} desactivados · {String(i.errores)} errores</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <TiposDefecto />
      </div>

      <div className="rounded-lg border border-linea bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Registro de cambios de productos</h2>
          <input type="search" placeholder="Filtrar por referencia" aria-label="Filtrar por referencia" value={filtroSku}
            onChange={(e) => setFiltroSku(e.target.value)} className="min-h-10 rounded-md border border-linea px-3" />
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="sticky top-0 bg-white text-acero"><tr><th className="p-2">Fecha</th><th className="p-2">Referencia</th><th className="p-2">Cambio</th><th className="p-2">Antes</th><th className="p-2">Después</th></tr></thead>
            <tbody>
              {cambios.map((c) => (
                <tr key={String(c.id)} className="border-t border-linea">
                  <td className="p-2 whitespace-nowrap">{fechaHora(String(c.changed_at))}</td>
                  <td className="p-2 font-bold">{String(c.sku)}</td>
                  <td className="p-2">{c.change_type === 'ALTA' ? 'Alta' : c.new_active === false && c.old_active ? 'Desactivado' : 'Modificación'}{c.import_id ? ' (importación)' : ''}</td>
                  <td className="p-2 text-acero">{c.old_description ? `${String(c.old_description)} · ${estadoTxt(String(c.old_status))}` : '—'}</td>
                  <td className="p-2">{String(c.new_description)} · {estadoTxt(String(c.new_status))}</td>
                </tr>
              ))}
              {cambios.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-acero">Sin cambios registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
