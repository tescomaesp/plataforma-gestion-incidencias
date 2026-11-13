import { useSesion } from '../auth/Sesion';
import { Aviso } from '../components/ui';

export default function Inicio() {
  const { perfil, trabajadoraActiva, trabajadoras } = useSesion();
  const esCentral = perfil?.role === 'MASTER';

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-3xl font-bold">{esCentral ? 'Incidencias de todas las tiendas' : 'Incidencias de la tienda'}</h1>
      {!esCentral && trabajadoras.length === 0 && (
        <Aviso tipo="error">Esta tienda no tiene trabajadoras dadas de alta. Pide a la central que las añada.</Aviso>
      )}
      {!esCentral && trabajadoras.length > 0 && !trabajadoraActiva && (
        <Aviso tipo="info">Elige arriba quién atiende. Se usará al abrir y responder incidencias.</Aviso>
      )}
      <p className="text-acero">
        {esCentral
          ? 'Aquí aparecerá la bandeja con las incidencias de las 9 tiendas.'
          : 'Aquí aparecerán las incidencias de la tienda y el botón para abrir una nueva.'}
        {' '}Esta sección se activa en la siguiente fase del desarrollo.
      </p>
    </section>
  );
}
