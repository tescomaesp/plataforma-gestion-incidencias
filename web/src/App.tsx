import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ProveedorSesion, useSesion } from './auth/Sesion';
import Estructura from './components/Estructura';
import Login from './pages/Login';
import CambiarPassword from './pages/CambiarPassword';
import Inicio from './pages/Inicio';
import Usuarios from './pages/central/Usuarios';
import Trabajadoras from './pages/central/Trabajadoras';
import Tiendas from './pages/central/Tiendas';

/** Deja pasar solo a usuarios con sesión, perfil activo y contraseña ya cambiada. */
function Protegida({ children, soloCentral = false }: { children: ReactNode; soloCentral?: boolean }) {
  const { cargando, sesion, perfil } = useSesion();
  const { pathname } = useLocation();
  if (cargando) return <p className="p-8 text-acero" role="status">Cargando…</p>;
  if (!sesion || !perfil || !perfil.active) return <Navigate to="/login" replace />;
  if (perfil.must_change_password && pathname !== '/cambiar-password') return <Navigate to="/cambiar-password" replace />;
  if (soloCentral && perfil.role !== 'MASTER') return <Navigate to="/" replace />;
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
            <Route index element={<Inicio />} />
            <Route path="/central/usuarios" element={<Protegida soloCentral><Usuarios /></Protegida>} />
            <Route path="/central/trabajadoras" element={<Protegida soloCentral><Trabajadoras /></Protegida>} />
            <Route path="/central/tiendas" element={<Protegida soloCentral><Tiendas /></Protegida>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ProveedorSesion>
  );
}
