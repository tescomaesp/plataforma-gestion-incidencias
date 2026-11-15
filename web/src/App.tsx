import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProveedorSesion, useSesion } from './auth/Sesion';
import Estructura from './components/Estructura';
import Login from './pages/Login';
import CambiarPassword from './pages/CambiarPassword';
import Tickets from './pages/Tickets';
import NuevoTicket from './pages/NuevoTicket';
import DetalleTicket from './pages/DetalleTicket';
import Panel from './pages/Panel';
import Catalogo from './pages/Catalogo';
import ImportarHistoricas from './pages/ImportarHistoricas';
import Usuarios from './pages/central/Usuarios';
import Tiendas from './pages/central/Tiendas';

/** Deja pasar solo a usuarios con sesión, perfil activo y contraseña ya cambiada. */
function Protegida({ children, permiso }: { children: ReactNode; permiso?: 'central' | 'admin' }) {
  const { cargando, sesion, perfil, esAdmin, esCentral } = useSesion();
  const { pathname } = useLocation();
  if (cargando) return <p className="p-8 text-acero" role="status">Cargando…</p>;
  if (!sesion || !perfil || !perfil.active) return <Navigate to="/login" replace />;
  if (perfil.must_change_password && pathname !== '/cambiar-password') return <Navigate to="/cambiar-password" replace />;
  if (permiso === 'admin' && !esAdmin) return <Navigate to="/" replace />;
  if (permiso === 'central' && !esCentral) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ProveedorSesion>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cambiar-password" element={<Protegida><CambiarPassword /></Protegida>} />
          <Route element={<Protegida><Estructura /></Protegida>}>
            <Route index element={<Tickets />} />
            <Route path="/nuevo" element={<NuevoTicket />} />
            <Route path="/ticket/:id" element={<DetalleTicket />} />
            <Route path="/panel" element={<Panel />} />
            <Route path="/importar-historicas" element={<Protegida permiso="central"><ImportarHistoricas /></Protegida>} />
            <Route path="/catalogo" element={<Protegida permiso="admin"><Catalogo /></Protegida>} />
            <Route path="/usuarios" element={<Protegida permiso="admin"><Usuarios /></Protegida>} />
            <Route path="/tiendas" element={<Protegida permiso="admin"><Tiendas /></Protegida>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
