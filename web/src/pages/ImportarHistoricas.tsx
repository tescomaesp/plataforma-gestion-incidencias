import { useCallback, useEffect, useState } from 'react';
import { mensajeError, supabase } from '../lib/supabase';
import { descargarExcel, leerExcel, type Fila } from '../lib/excel';
import { fechaHora } from '../lib/formato';
import type { Tienda, TipoDefecto } from '../lib/tipos';
import { Aviso, Boton } from '../components/ui';

const COLUMNAS = [
  ['Tienda', 'tienda', 'Código (T01…) o nombre exacto de la tienda. Obligatorio.'],
  ['Fecha incidencia', 'fecha_incidencia', 'Obligatoria. DD/MM/AAAA o fecha de Excel.'],
  ['Fecha compra', 'fecha_compra', 'Opcional.'],
  ['Referencia', 'sku', 'Obligatoria.'],
  ['Producto', 'producto', 'Opcional: se usa si la referencia ya no está en el catálogo.'],
  ['Tipo defecto', 'tipo_defecto', 'Opcional. Uno de los tipos de defecto de la plataforma.'],
  ['Motivo', 'motivo', 'Opcional.'],
  ['Cliente', 'cliente', 'Obligatorio: nombre del cliente.'],
  ['Correo', 'correo', 'Opcional.'],
  ['Teléfono', 'telefono', 'Opcional.'],
  ['Resultado', 'resultado', 'Cambio, No cubre, Reparación, Compensación, Vale tienda o Reembolso. Vacío = sigue abierta.'],
  ['Respuesta', 'respuesta', 'Opcional.'],
] as const;
const ALIAS: Record<string, string> = {
  tienda: 'tienda', codigo_tienda: 'tienda', fecha_incidencia: 'fecha_incidencia', fecha_de_incidencia: 'fecha_incidencia',
  fecha: 'fecha_incidencia', fecha_compra: 'fecha_compra', fecha_de_compra: 'fecha_compra', referencia: 'sku', sku: 'sku',
  producto: 'producto', descripcion: 'producto', tipo_defecto: 'tipo_defecto', tipo_de_defecto: 'tipo_defecto', defecto: 'tipo_defecto',
  motivo: 'motivo', cliente: 'cliente', nombre: 'cliente', nombre_cliente: 'cliente', correo: 'correo', email: 'correo',
  telefono: 'telefono', resultado: 'resultado', respuesta: 'respuesta',
};
interface Resumen { total: number; validas: number; errores: number; detalle_errores: { fila: number; error: string }[] }

export default function ImportarHistoricas() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [archivo, setArchivo] = useState('');
  const [previa, setPrevia] = useState<Resumen | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [anteriores, setAnteriores] = useState<Record<string, unknown>[]>([]);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('incident_imports').select('*').order('created_at', { ascending: false }).limit(20);
    setAnteriores(data ?? []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function plantilla() {
    const [{ data: ts }, { data: ds }] = await Promise.all([
      supabase.from('stores').select('*').order('code'),
      supabase.from('defect_types').select('*').eq('active', true).order('sort'),
    ]);
    await descargarExcel('plantilla_incidencias_antiguas.xlsx', [
      { nombre: 'Incidencias', columnas: COLUMNAS.map(([t, k]) => ({ titulo: t, ancho: k === 'motivo' || k === 'respuesta' ? 40 : 18, texto: k === 'sku' || k === 'telefono' })),
        filas: [['T01', '15/03/2025', '02/01/2025', '12307', '', 'Rotura', 'Asa rota al sacarla de la caja', 'Nombre Apellido', 'cliente@ejemplo.es', '', 'Cambio', 'Se cambia por una nueva']] },
      { nombre: 'Instrucciones', columnas: [{ titulo: 'Columna', ancho: 20 }, { titulo: 'Qué poner', ancho: 90 }],
        filas: [
          ...COLUMNAS.map(([t, , d]) => [t, d]),
          ['', ''], ['Tiendas', ((ts ?? []) as Tienda[]).map((t) => `${t.code} = ${t.name}`).join(' · ')],
          ['Tipos de defecto', ((ds ?? []) as TipoDefecto[]).map((d) => d.name).join(' · ')],
          ['', 'Borra la fila de ejemplo antes de importar.'],
        ] },
    ]);
  }

  async function elegir(f: File | undefined) {
    if (!f) return;
    setError(null); setOk(null); setPrevia(null); setOcupado('leer');
    try {
      const leidas = await leerExcel(f, ALIAS);
      setFilas(leidas); setArchivo(f.name);
      const { data, error } = await supabase.rpc('importar_incidencias', { p_filas: leidas, p_nombre: f.name, p_aplicar: false });
      if (error) throw error;
      setPrevia(data as Resumen);
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(null); }
  }
  async function aplicar() {
    setOcupado('aplicar'); setError(null);
    const { data, error } = await supabase.rpc('importar_incidencias', { p_filas: filas, p_nombre: archivo, p_aplicar: true });
    setOcupado(null);
    if (error) { setError(mensajeError(error)); return; }
    const r = data as Resumen;
    setOk(`Importadas ${r.validas} incidencias. ${r.errores ? `${r.errores} filas con errores no se han importado.` : ''} Ya cuentan en el panel de estadísticas.`);
    setPrevia(null); setFilas(null); await cargar();
  }

  return (
    <section className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Importar incidencias antiguas</h1>
        <p className="text-acero">Para incluir en las estadísticas las incidencias que gestionabais antes de la plataforma. Se marcan como importadas y no necesitan fotos.</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-linea bg-white p-5">
        <Boton variante="secundario" onClick={plantilla}>Descargar plantilla</Boton>
        <input type="file" accept=".xlsx" disabled={!!ocupado} onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }}
          className="file:mr-3 file:min-h-10 file:rounded-md file:border-0 file:bg-esmalte file:px-4 file:font-bold file:text-white" />
        {ocupado === 'leer' && <span className="text-acero">Comprobando el archivo…</span>}
      </div>

      {previa && (
        <div className="flex flex-col gap-4 rounded-lg border-2 border-esmalte bg-white p-5">
          <h2 className="text-xl font-bold">Vista previa · {archivo}</h2>
          <p>{previa.total} filas: <strong>{previa.validas}</strong> correctas
            {previa.errores > 0 && <>, <strong className="text-tomate">{previa.errores} con errores</strong> (no se importarán)</>}.</p>
          {previa.detalle_errores.length > 0 && (
            <ul className="max-h-60 overflow-y-auto rounded-md bg-tomate-claro p-3 text-sm">
              {previa.detalle_errores.map((e, i) => <li key={i}>Fila {e.fila}: {e.error}</li>)}
            </ul>
          )}
          <div className="flex gap-3">
            <Boton onClick={aplicar} disabled={!!ocupado || previa.validas === 0}>{ocupado === 'aplicar' ? 'Importando…' : `Importar ${previa.validas} incidencias`}</Boton>
            <Boton variante="discreto" onClick={() => { setPrevia(null); setFilas(null); }}>Cancelar</Boton>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-linea bg-white p-5">
        <h2 className="mb-3 text-xl font-bold">Importaciones anteriores</h2>
        {anteriores.length === 0 ? <p className="text-acero">Todavía no hay importaciones.</p> : (
          <ul className="divide-y divide-linea">
            {anteriores.map((a) => (
              <li key={String(a.id)} className="py-2">
                <span className="font-bold">{String(a.file_name)}</span>
                <span className="text-sm text-acero"> · {fechaHora(String(a.created_at))} · {String(a.importadas)} importadas · {String(a.errores)} errores</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
