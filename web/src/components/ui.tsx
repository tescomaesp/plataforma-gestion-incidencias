import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

type Variante = 'principal' | 'secundario' | 'peligro' | 'discreto' | 'peligroDiscreto';
const estilos: Record<Variante, string> = {
  principal: 'bg-esmalte text-white hover:bg-esmalte-oscuro disabled:bg-acero',
  secundario: 'bg-white text-esmalte border border-esmalte hover:bg-esmalte-claro',
  peligro: 'bg-white text-tomate border border-tomate hover:bg-tomate-claro',
  discreto: 'text-esmalte hover:bg-esmalte-claro',
  peligroDiscreto: 'text-tomate hover:bg-tomate-claro',
};

export function Boton({ variante = 'principal', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...p}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 font-bold
        transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${estilos[variante]} ${className}`}
    />
  );
}

export function Campo({ etiqueta, ayuda, id, ...p }:
  InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string; id: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-bold">{etiqueta}</label>
      <input
        id={id}
        {...p}
        className="min-h-11 rounded-md border border-linea bg-white px-3 text-lg
          focus:border-esmalte focus:outline-none focus:ring-2 focus:ring-esmalte/30"
      />
      {ayuda && <p className="text-sm text-acero">{ayuda}</p>}
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const c = {
    error: 'border-tomate bg-tomate-claro text-tomate',
    ok: 'border-salvia bg-salvia-claro text-salvia',
    info: 'border-esmalte bg-esmalte-claro text-esmalte-oscuro',
  }[tipo];
  return <div role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-md border-l-4 px-4 py-3 ${c}`}>{children}</div>;
}

export function Dialogo({ abierto, titulo, children, onCerrar }:
  { abierto: boolean; titulo: string; children: ReactNode; onCerrar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} onClose={onCerrar}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-linea bg-white p-0 text-tinta backdrop:bg-tinta/40">
      <div className="flex flex-col gap-4 p-6">
        <h2 className="text-xl font-bold">{titulo}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** Contraseña temporal para entregar a la tienda, con botón de copiar. */
export function PasswordTemporal({ usuario, password }: { usuario: string; password: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p>Entrega estos datos a la tienda. La contraseña no se volverá a mostrar y tendrá que cambiarla al entrar.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-porcelana p-4">
        <dt className="text-acero">Usuario</dt><dd className="font-bold">{usuario}</dd>
        <dt className="text-acero">Contraseña</dt>
        <dd className="text-2xl font-bold tracking-wider select-all">{password}</dd>
      </dl>
      <Boton variante="secundario" onClick={() => navigator.clipboard.writeText(`Usuario: ${usuario}\nContraseña: ${password}`)}>
        Copiar usuario y contraseña
      </Boton>
    </div>
  );
}
