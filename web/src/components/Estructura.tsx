import { NavLink, Outlet } from 'react-router-dom';
import { useSesion } from '../auth/Sesion';

function Placa({ codigo, nombre }: { codigo: string; nombre: string }) {
  // La placa identifica de un vistazo desde qué tienda se está trabajando.
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="grid h-12 min-w-14 place-items-center rounded-md border-2 border-white/70
        bg-esmalte-oscuro px-2 text-2xl font-bold tracking-wide text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)]">
        {codigo}
      </span>
      <span className="text-lg font-bold leading-tight text-white">{nombre}</span>
    </div>
  );
}

const enlace = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 font-bold ${isActive ? 'bg-white text-esmalte' : 'text-white hover:bg-white/15'}`;

export default function Estructura() {
  const { perfil, tienda, trabajadoras, trabajadoraActiva, elegirTrabajadora, salir } = useSesion();
  const esCentral = perfil?.role === 'MASTER';

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 bg-esmalte">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          {esCentral ? <Placa codigo="C" nombre="Central" /> : tienda && <Placa codigo={tienda.code} nombre={tienda.name} />}

          <nav aria-label="Secciones" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={enlace}>Incidencias</NavLink>
            {esCentral && <>
              <NavLink to="/central/usuarios" className={enlace}>Usuarios</NavLink>
              <NavLink to="/central/trabajadoras" className={enlace}>Trabajadoras</NavLink>
              <NavLink to="/central/tiendas" className={enlace}>Tiendas</NavLink>
            </>}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {!esCentral && (
              <label className="flex items-center gap-2 text-white">
                <span className="text-sm">Atiende</span>
                <select
                  value={trabajadoraActiva?.id ?? ''}
                  onChange={(e) => elegirTrabajadora(e.target.value ? Number(e.target.value) : null)}
                  className={`min-h-10 rounded-md px-2 font-bold text-tinta ${trabajadoraActiva ? 'bg-white' : 'bg-ambar-claro'}`}
                >
                  <option value="">Elige quién atiende</option>
                  {trabajadoras.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                </select>
              </label>
            )}
            <button onClick={salir} className="rounded-md px-3 py-2 font-bold text-white hover:bg-white/15">
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
