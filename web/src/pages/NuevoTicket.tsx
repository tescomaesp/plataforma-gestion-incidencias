import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { mensajeError, supabase } from '../lib/supabase';
import { comprimirFoto } from '../lib/fotos';
import { ESTADOS_PRODUCTO, hoyISO } from '../lib/formato';
import type { Producto, Tienda, TipoDefecto } from '../lib/tipos';
import { useSesion } from '../auth/Sesion';
import { AreaTexto, Aviso, Boton, Campo, Selector } from '../components/ui';

const MAX_FOTOS = 6;

function BuscadorProducto({ elegido, alElegir }: { elegido: Producto | null; alElegir: (p: Producto | null) => void }) {
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (texto.trim().length < 2) { setResultados([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('buscar_productos', { q: texto });
      setResultados((data ?? []) as Producto[]);
      setBuscando(false);
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);

  if (elegido) {
    const descatalogado = elegido.status !== 'ACTIVO';
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-esmalte bg-esmalte-claro px-3 py-2">
        <span className="font-bold">{elegido.sku}</span>
        <span className="flex-1">{elegido.description}</span>
        {descatalogado && <span className={`text-sm font-bold ${elegido.status === 'DESCATALOGADO_SIN_STOCK' ? 'text-tomate' : 'text-ambar'}`}>
          {ESTADOS_PRODUCTO[elegido.status]}</span>}
        <Boton type="button" variante="discreto" onClick={() => { alElegir(null); setTexto(''); }}>Cambiar</Boton>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <input id="buscar-producto" value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off"
        placeholder="Escribe la referencia o parte del nombre"
        className="min-h-11 rounded-md border border-linea bg-white px-3 text-lg focus:border-esmalte focus:outline-none focus:ring-2 focus:ring-esmalte/30" />
      {buscando && <p className="text-sm text-acero">Buscando…</p>}
      {resultados.length > 0 && (
        <ul className="max-h-72 overflow-y-auto rounded-md border border-linea bg-white">
          {resultados.map((p) => (
            <li key={p.sku}>
              <button type="button" onClick={() => alElegir(p)}
                className="flex w-full gap-3 border-b border-linea px-3 py-2 text-left last:border-0 hover:bg-esmalte-claro">
                <span className="w-32 shrink-0 font-bold">{p.sku}</span>
                <span className="flex-1">{p.description}</span>
                {p.status !== 'ACTIVO' && <span className="text-sm text-acero">{ESTADOS_PRODUCTO[p.status]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
        <p className="text-sm text-acero">No hay productos que coincidan.</p>
      )}
    </div>
  );
}

export default function NuevoTicket() {
  const { perfil, esCentral, tienda } = useSesion();
  const navegar = useNavigate();
  const [tiendas, setTiendas] = useState<Tienda[]>([]);
  const [tipos, setTipos] = useState<TipoDefecto[]>([]);
  const [storeId, setStoreId] = useState('');
  const [producto, setProducto] = useState<Producto | null>(null);
  const [fueraCatalogo, setFueraCatalogo] = useState(false);
  const [skuManual, setSkuManual] = useState('');
  const [descManual, setDescManual] = useState('');
  const [tipo, setTipo] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fotos, setFotos] = useState<{ archivo: File; url: string }[]>([]);
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('');
  const [compra, setCompra] = useState('');
  const [incidencia, setIncidencia] = useState(hoyISO());
  const [ticketCompra, setTicketCompra] = useState<'' | 'si' | 'no'>('');
  const [rgpd, setRgpd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('defect_types').select('*').eq('active', true).order('sort').then(({ data }) => setTipos((data ?? []) as TipoDefecto[]));
    if (esCentral) supabase.from('stores').select('*').eq('active', true).order('code').then(({ data }) => setTiendas((data ?? []) as Tienda[]));
  }, [esCentral]);
  useEffect(() => () => fotos.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const añadirFotos = (lista: FileList | null) => {
    if (!lista) return;
    const nuevas = Array.from(lista).slice(0, MAX_FOTOS - fotos.length).map((archivo) => ({ archivo, url: URL.createObjectURL(archivo) }));
    setFotos((f) => [...f, ...nuevas]);
  };
  const quitarFoto = (i: number) => setFotos((f) => { URL.revokeObjectURL(f[i].url); return f.filter((_, j) => j !== i); });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const tiendaId = esCentral ? Number(storeId) : perfil?.store_id;
    if (!tiendaId) { setError('Elige la tienda de la incidencia.'); return; }
    if (!fueraCatalogo && !producto) { setError('Busca y elige el producto, o marca que no está en el catálogo.'); return; }
    if (fotos.length === 0) { setError('Añade al menos una foto del producto.'); return; }
    if (!telefono.trim()) { setError('Indica el teléfono del cliente.'); return; }
    if (!ticketCompra) { setError('Indica si el cliente entrega el ticket de compra.'); return; }
    if (!rgpd) { setError('Marca la casilla de consentimiento RGPD.'); return; }

    try {
      const rutas: string[] = [];
      for (const [i, f] of fotos.entries()) {
        setEnviando(`Subiendo foto ${i + 1} de ${fotos.length}…`);
        const blob = await comprimirFoto(f.archivo);
        const ruta = `${tiendaId}/${crypto.randomUUID()}.jpg`;
        const { error: e2 } = await supabase.storage.from('incidencias').upload(ruta, blob, { contentType: 'image/jpeg' });
        if (e2) throw e2;
        rutas.push(ruta);
      }
      setEnviando('Registrando el ticket…');
      const { data, error: e3 } = await supabase.rpc('crear_incidencia', {
        d: {
          store_id: tiendaId,
          sku: fueraCatalogo ? skuManual : producto!.sku,
          product_description: fueraCatalogo ? descManual : undefined,
          defect_type_id: Number(tipo) || null,
          reason: motivo,
          customer_full_name: nombre, customer_email: correo, customer_phone: telefono,
          purchase_date: compra, incident_date: incidencia,
          receipt_confirmed: ticketCompra === 'si', gdpr_consent: rgpd,
          fotos: rutas,
        },
      });
      if (e3) throw e3;
      const r = data as { id: number; number: string };
      navegar(`/ticket/${r.id}`, { state: { creado: r.number } });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(null);
    }
  }

  return (
    <form onSubmit={enviar} className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Nuevo ticket de incidencia</h1>
        <p className="text-acero">Todos los campos son obligatorios, salvo el correo del cliente (aunque es recomendable).</p>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <fieldset className="flex flex-col gap-4 rounded-lg border border-linea bg-white p-5">
        <legend className="px-1 text-lg font-bold">Producto</legend>
        {esCentral ? (
          <Selector id="tienda" etiqueta="Tienda" required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Elige la tienda</option>
            {tiendas.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
          </Selector>
        ) : (
          <p><span className="font-bold">Tienda:</span> {tienda?.code} · {tienda?.name}</p>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="buscar-producto" className="font-bold">Número de referencia</label>
          {!fueraCatalogo && <BuscadorProducto elegido={producto} alElegir={setProducto} />}
          <label className="mt-1 flex items-center gap-2 text-acero">
            <input type="checkbox" className="size-5 accent-esmalte" checked={fueraCatalogo}
              onChange={(e) => { setFueraCatalogo(e.target.checked); setProducto(null); }} />
            El producto no está en el catálogo
          </label>
        </div>
        {fueraCatalogo && (
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Campo id="sku-manual" etiqueta="Referencia" required value={skuManual} onChange={(e) => setSkuManual(e.target.value)} />
            <Campo id="desc-manual" etiqueta="Descripción del producto" required value={descManual} onChange={(e) => setDescManual(e.target.value)} />
          </div>
        )}
        <Selector id="tipo" etiqueta="Tipo de defecto" required value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Elige el tipo de defecto</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Selector>
        <AreaTexto id="motivo" etiqueta="Motivo" required minLength={10} value={motivo} onChange={(e) => setMotivo(e.target.value)}
          ayuda="Qué le pasa al producto y cuándo empezó a fallar, según el cliente." />
        <div className="flex flex-col gap-2">
          <span className="font-bold">Fotos del producto ({fotos.length} de {MAX_FOTOS})</span>
          <div className="flex flex-wrap gap-3">
            {fotos.map((f, i) => (
              <div key={f.url} className="relative">
                <img src={f.url} alt={`Foto ${i + 1}`} className="size-28 rounded-md border border-linea object-cover" />
                <button type="button" onClick={() => quitarFoto(i)} aria-label={`Quitar foto ${i + 1}`}
                  className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-tomate font-bold text-white">×</button>
              </div>
            ))}
            {fotos.length < MAX_FOTOS && (
              <label className="grid size-28 cursor-pointer place-items-center rounded-md border-2 border-dashed border-esmalte text-center text-sm font-bold text-esmalte hover:bg-esmalte-claro">
                + Añadir<br />fotos
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
                  onChange={(e) => { añadirFotos(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-linea bg-white p-5">
        <legend className="px-1 text-lg font-bold">Cliente y compra</legend>
        <Campo id="nombre" etiqueta="Nombre completo del cliente" required value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="telefono" etiqueta="Teléfono" type="tel" required value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          <Campo id="correo" etiqueta="Correo electrónico (recomendable)" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="compra" etiqueta="Fecha de compra" type="date" required max={incidencia || hoyISO()} value={compra} onChange={(e) => setCompra(e.target.value)} />
          <Campo id="incidencia" etiqueta="Fecha de la incidencia" type="date" required min={compra || undefined} max={hoyISO()} value={incidencia} onChange={(e) => setIncidencia(e.target.value)} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-bold">¿El cliente entrega el ticket de compra?</legend>
          <div className="flex flex-wrap gap-3">
            {([['si', 'Sí, entrega ticket', 'border-salvia bg-salvia-claro text-salvia'], ['no', 'No entrega ticket', 'border-tomate bg-tomate-claro text-tomate']] as const).map(([v, txt, activo]) => (
              <label key={v} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 px-4 font-bold ${ticketCompra === v ? activo : 'border-linea bg-white'}`}>
                <input type="radio" name="ticket-compra" value={v} required checked={ticketCompra === v}
                  onChange={() => setTicketCompra(v)} className="size-5 accent-esmalte" />
                {txt}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3">
          <input type="checkbox" required className="mt-1 size-5 shrink-0 accent-esmalte" checked={rgpd} onChange={(e) => setRgpd(e.target.checked)} />
          <span><strong>Obligatorio:</strong> el cliente acepta que sus datos se usen para gestionar esta garantía (RGPD).</span>
        </label>
      </fieldset>

      <Boton type="submit" disabled={!!enviando} className="self-start px-8">{enviando ?? 'Abrir ticket'}</Boton>
    </form>
  );
}
