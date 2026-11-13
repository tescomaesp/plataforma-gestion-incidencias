import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Perfil, Tienda, Trabajadora } from '../lib/tipos';

interface EstadoSesion {
  cargando: boolean;
  sesion: Session | null;
  perfil: Perfil | null;
  tienda: Tienda | null;              // solo para usuarios de tienda
  trabajadoras: Trabajadora[];        // activas de la tienda
  trabajadoraActiva: Trabajadora | null;
  elegirTrabajadora: (id: number | null) => void;
  recargarPerfil: () => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<EstadoSesion | null>(null);
const claveTrabajadora = (storeId: number) => `trabajadora-activa:${storeId}`;

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [tienda, setTienda] = useState<Tienda | null>(null);
  const [trabajadoras, setTrabajadoras] = useState<Trabajadora[]>([]);
  const [trabajadoraId, setTrabajadoraId] = useState<number | null>(null);

  const cargarDatos = useCallback(async (s: Session | null) => {
    if (!s) { setPerfil(null); setTienda(null); setTrabajadoras([]); return; }
    const { data: p } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle<Perfil>();
    setPerfil(p ?? null);
    if (p?.role === 'STORE' && p.store_id) {
      const [{ data: t }, { data: ws }] = await Promise.all([
        supabase.from('stores').select('*').eq('id', p.store_id).maybeSingle<Tienda>(),
        supabase.from('store_workers').select('*').eq('active', true).order('full_name'),
      ]);
      setTienda(t ?? null);
      const lista = (ws ?? []) as Trabajadora[];
      setTrabajadoras(lista);
      let guardada: number | null = null;
      try { guardada = Number(localStorage.getItem(claveTrabajadora(p.store_id))); } catch { /* sin almacenamiento */ }
      setTrabajadoraId(lista.some((w) => w.id === guardada) ? guardada : null);
    } else {
      setTienda(null); setTrabajadoras([]); setTrabajadoraId(null);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSesion(data.session);
      await cargarDatos(data.session);
      setCargando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      // Al renovar el token no hace falta recargar; al entrar o salir, sí.
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setCargando(true);
        // Diferido: Supabase no permite otras llamadas dentro de este callback.
        setTimeout(() => cargarDatos(s).finally(() => setCargando(false)), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarDatos]);

  const elegirTrabajadora = (id: number | null) => {
    setTrabajadoraId(id);
    if (!perfil?.store_id) return;
    try {
      if (id) localStorage.setItem(claveTrabajadora(perfil.store_id), String(id));
      else localStorage.removeItem(claveTrabajadora(perfil.store_id));
    } catch { /* sin almacenamiento: se recuerda solo mientras la app esté abierta */ }
  };

  const valor: EstadoSesion = {
    cargando, sesion, perfil, tienda, trabajadoras,
    trabajadoraActiva: trabajadoras.find((w) => w.id === trabajadoraId) ?? null,
    elegirTrabajadora,
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
