import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Perfil, Tienda } from '../lib/tipos';

interface EstadoSesion {
  cargando: boolean;
  sesion: Session | null;
  perfil: Perfil | null;
  tienda: Tienda | null;   // solo para usuarios de tienda
  esAdmin: boolean;
  esCentral: boolean;      // administrador o responsable de incidencias
  recargarPerfil: () => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<EstadoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [tienda, setTienda] = useState<Tienda | null>(null);

  const cargarDatos = useCallback(async (s: Session | null) => {
    if (!s) { setPerfil(null); setTienda(null); return; }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle<Perfil>();
    setPerfil(p ?? null);
    if (p?.role === 'STORE' && p.store_id) {
      const { data: t } = await supabase.from('stores').select('*').eq('id', p.store_id).maybeSingle<Tienda>();
      setTienda(t ?? null);
    } else setTienda(null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSesion(data.session);
      await cargarDatos(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setCargando(true);
        // Diferido: Supabase no permite otras llamadas dentro de este callback.
        setTimeout(() => cargarDatos(s).finally(() => setCargando(false)), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarDatos]);

  const activo = !!perfil?.active;
  const valor: EstadoSesion = {
    cargando, sesion, perfil, tienda,
    esAdmin: activo && perfil?.role === 'ADMIN',
    esCentral: activo && (perfil?.role === 'ADMIN' || perfil?.role === 'RESPONSABLE'),
    recargarPerfil: () => cargarDatos(sesion),
    salir: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return v;
}
