import { NavLink, Outlet } from 'react-router-dom';
import { useSesion } from '../auth/Sesion';
import { ROLES } from '../lib/formato';

function Placa({ codigo, nombre, detalle }: { codigo: string; nombre: string; detalle?: string }) {
  // La placa identifica de un vistazo desde dónde se está trabajando.
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="grid h-12 min-w-14 place-items-center rounded-md border-2 border-white/70
        bg-esmalte-oscuro px-2 text-2xl font-bold tracking-wide text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)]">
        {codigo}
      </span>
      <span className="leading-tight text-white">
        <span className="block text-lg font-bold">{nombre}</span>
        {detalle && <span className="block text-sm text-white/80">{detalle}</span>}
      </span>
    </div>
  );
}

const enlace = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 font-bold ${isActive ? 'bg-white text-esmalte' : 'text-white hover:bg-white/15'}`;

export default function Estructura() {
  const { perfil, tienda, esAdmin, esCentral, salir } = useSesion();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 bg-esmalte print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <img src={`${import.meta.env.BASE_URL}logo-tescoma.png`} alt="Tescoma" className="h-9 w-auto" />
          {esCentral
            ? <Placa codigo="C" nombre="Central" detalle={perfil ? ROLES[perfil.role] : undefined} />
            : tienda && <Placa codigo={tienda.code} nombre={tienda.name} />}

          <nav aria-label="Secciones" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={enlace}>Tickets</NavLink>
            <NavLink to="/nuevo" className={enlace}>Nuevo ticket</NavLink>
            <NavLink to="/panel" className={enlace}>{esCentral ? 'Panel' : 'Estadísticas'}</NavLink>
            {esCentral && <NavLink to="/importar-historicas" className={enlace}>Históricas</NavLink>}
            {esAdmin && <>
              <NavLink to="/catalogo" className={enlace}>Catálogo</NavLink>
              <NavLink to="/usuarios" className={enlace}>Usuarios</NavLink>
              <NavLink to="/tiendas" className={enlace}>Tiendas</NavLink>
            </>}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {esCentral && (
              <NavLink to="/cambiar-password" className="rounded-md px-3 py-2 text-sm font-bold text-white hover:bg-white/15">
                Contraseña
              </NavLink>
            )}
            <button onClick={salir} className="rounded-md px-3 py-2 font-bold text-white hover:bg-white/15">
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
