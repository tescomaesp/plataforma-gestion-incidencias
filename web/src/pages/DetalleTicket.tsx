import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { mensajeError, supabase } from '../lib/supabase';
import { colorEstado, ESTADOS, ESTADOS_PRODUCTO, fecha, fechaHora, RESULTADOS } from '../lib/formato';
import type { Incidencia, Resultado } from '../lib/tipos';
import { useSesion } from '../auth/Sesion';
import { AreaTexto, Aviso, Boton, EntregaTicket, Pastilla, Selector } from '../components/ui';

type Ficha = Incidencia & { stores: { code: string; name: string } | null; defect_types: { name: string } | null };
type Evento = { id: number; event_type: string; message: string | null; created_at: string; user_id: string | null };
const TEXTO_EVENTO: Record<string, string> = {
  CREADO: 'Ticket abierto', EN_REVISION: 'Pasa a revisión', REABIERTO: 'Vuelve a abierto',
  RESUELTO: 'Resuelto', IMPORTADO: 'Importado de incidencias antiguas',
};

function Dato({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <div><dt className="text-sm text-acero">{titulo}</dt><dd className="font-bold">{children}</dd></div>;
}

export default function DetalleTicket() {
  const { id } = useParams();
  const { state } = useLocation() as { state: { creado?: string } | null };
  const { esCentral } = useSesion();
  const [t, setT] = useState<Ficha | null>(null);
  const [fotos, setFotos] = useState<string[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(state?.creado ? `Ticket ${state.creado} abierto correctamente.` : null);
  const [resultado, setResultado] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('incidents').select('*, stores(code, name), defect_types(name)').eq('id', Number(id)).maybeSingle();
    if (error || !data) { setError(error ? mensajeError(error) : 'No existe este ticket o no tienes acceso.'); return; }
    setT(data as Ficha);
    const [{ data: fs }, { data: ev }] = await Promise.all([
      supabase.from('incident_photos').select('storage_path').eq('incident_id', Number(id)).order('id'),
      supabase.from('incident_events').select('*').eq('incident_id', Number(id)).order('id'),
    ]);
    const rutas = (fs ?? []).map((f) => f.storage_path as string);
    if (rutas.length) {
      const { data: urls } = await supabase.storage.from('incidencias').createSignedUrls(rutas, 3600);
      setFotos((urls ?? []).map((u) => u.signedUrl).filter(Boolean) as string[]);
    } else setFotos([]);
    setEventos((ev ?? []) as Evento[]);
    if (esCentral) {
      const ids = [...new Set((ev ?? []).map((e) => e.user_id).filter(Boolean))] as string[];
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, username').in('id', ids);
        setUsuarios(Object.fromEntries((ps ?? []).map((p) => [p.id, p.username])));
      }
    }
  }, [id, esCentral]);
  useEffect(() => { cargar(); }, [cargar]);

  async function accion(fn: () => PromiseLike<{ error: unknown }>, mensaje: string) {
    setError(null); setOk(null); setOcupado(true);
    const { error } = await fn();
    setOcupado(false);
    if (error) setError(mensajeError(error)); else { setOk(mensaje); await cargar(); }
  }
  const resolver = (e: FormEvent) => {
    e.preventDefault();
    accion(() => supabase.rpc('resolver_incidencia', { p_id: t!.id, p_resultado: resultado, p_texto: respuesta }), 'Ticket resuelto. La tienda ya puede ver la respuesta.');
  };

  if (error && !t) return <Aviso tipo="error">{error}</Aviso>;
  if (!t) return <p className="text-acero" role="status">Cargando…</p>;

  return (
    <section className="flex flex-col gap-6">
      <Link to="/" className="self-start font-bold text-esmalte hover:underline">← Volver a los tickets</Link>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-bold">{t.number}</h1>
        <Pastilla className={colorEstado[t.status]}>{ESTADOS[t.status]}</Pastilla>
        {t.is_historical && <Pastilla className="bg-porcelana text-acero">Incidencia importada</Pastilla>}
        {!t.is_historical && <EntregaTicket entregado={t.receipt_confirmed} grande />}
      </div>
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          <div className="rounded-lg border border-linea bg-white p-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato titulo="Tienda">{t.stores?.code} · {t.stores?.name}</Dato>
              <Dato titulo="Producto">
                {t.sku} · {t.product_description}
                {!t.in_catalog && <span className="ml-2 text-sm font-normal text-ambar">(fuera de catálogo)</span>}
                {t.product_status_at_creation && t.product_status_at_creation !== 'ACTIVO' &&
                  <span className="block text-sm font-normal text-acero">{ESTADOS_PRODUCTO[t.product_status_at_creation]}</span>}
              </Dato>
              <Dato titulo="Tipo de defecto">{t.defect_types?.name ?? '—'}</Dato>
              <Dato titulo="Fechas">Compra {fecha(t.purchase_date)} · Incidencia {fecha(t.incident_date)}</Dato>
              <Dato titulo="Cliente">{t.customer_full_name}</Dato>
              <Dato titulo="Contacto">{[t.customer_email, t.customer_phone].filter(Boolean).join(' · ') || '—'}</Dato>
              <Dato titulo="Ticket de compra">{t.is_historical ? '—' : <EntregaTicket entregado={t.receipt_confirmed} />}</Dato>
              <Dato titulo="Abierto">{fechaHora(t.created_at)}</Dato>
            </dl>
            <div className="mt-4">
              <dt className="text-sm text-acero">Motivo</dt>
              <dd className="whitespace-pre-wrap">{t.reason}</dd>
            </div>
          </div>

          {fotos.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {fotos.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt={`Foto ${i + 1} del producto`} className="size-40 rounded-md border border-linea object-cover hover:opacity-90" />
                </a>
              ))}
            </div>
          )}

          {t.status === 'RESUELTO' && (
            <div className="rounded-lg border-l-4 border-salvia bg-salvia-claro p-5">
              <h2 className="text-xl font-bold text-salvia">Respuesta: {t.resolution_type ? RESULTADOS[t.resolution_type as Resultado] : '—'}</h2>
              {t.resolution_text && <p className="mt-2 whitespace-pre-wrap">{t.resolution_text}</p>}
              <p className="mt-2 text-sm text-acero">Resuelto el {fechaHora(t.resolved_at)}</p>
            </div>
          )}

          {esCentral && t.status !== 'RESUELTO' && (
            <form onSubmit={resolver} className="flex flex-col gap-4 rounded-lg border border-esmalte bg-white p-5">
              <h2 className="text-xl font-bold">Responder al ticket</h2>
              <Selector id="resultado" etiqueta="Resultado" required value={resultado} onChange={(e) => setResultado(e.target.value)}>
                <option value="">Elige el resultado</option>
                {Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Selector>
              <AreaTexto id="respuesta" etiqueta="Respuesta para la tienda" required minLength={5} value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)} ayuda="Qué tiene que hacer la tienda con el cliente." />
              <div className="flex flex-wrap gap-3">
                <Boton type="submit" disabled={ocupado}>Resolver ticket</Boton>
                {t.status === 'ABIERTO' && <Boton type="button" variante="secundario" disabled={ocupado}
                  onClick={() => accion(() => supabase.rpc('cambiar_estado_incidencia', { p_id: t.id, p_estado: 'EN_REVISION' }), 'Ticket en revisión.')}>
                  Pasar a revisión</Boton>}
                {t.status === 'EN_REVISION' && <Boton type="button" variante="discreto" disabled={ocupado}
                  onClick={() => accion(() => supabase.rpc('cambiar_estado_incidencia', { p_id: t.id, p_estado: 'ABIERTO' }), 'Ticket abierto de nuevo.')}>
                  Volver a abierto</Boton>}
              </div>
            </form>
          )}
        </div>

        <aside className="rounded-lg border border-linea bg-white p-5">
          <h2 className="mb-3 text-lg font-bold">Historial</h2>
          <ol className="flex flex-col gap-3">
            {eventos.map((e) => (
              <li key={e.id} className="border-l-2 border-esmalte pl-3">
                <p className="font-bold">{TEXTO_EVENTO[e.event_type] ?? e.event_type}
                  {e.event_type === 'RESUELTO' && e.message && ` · ${RESULTADOS[e.message as Resultado] ?? e.message}`}</p>
                <p className="text-sm text-acero">{fechaHora(e.created_at)}{e.user_id && usuarios[e.user_id] ? ` · ${usuarios[e.user_id]}` : ''}</p>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}
