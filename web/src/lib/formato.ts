import type { Estado, EstadoProducto, Resultado, Rol } from './tipos';

export const ESTADOS: Record<Estado, string> = {
  ABIERTO: 'Abierto', EN_REVISION: 'En revisión', RESUELTO: 'Resuelto',
};
export const RESULTADOS: Record<Resultado, string> = {
  CAMBIO: 'Cambio', NO_CUBRE: 'No cubre', REPARACION: 'Reparación', COMPENSACION: 'Compensación',
  VALE_TIENDA: 'Vale tienda',
};
export const ROLES: Record<Rol, string> = {
  ADMIN: 'Administrador', RESPONSABLE: 'Responsable de incidencias', STORE: 'Tienda',
};
export const ESTADOS_PRODUCTO: Record<EstadoProducto, string> = {
  ACTIVO: 'Activo', DESCATALOGADO_CON_STOCK: 'Descatalogado · con stock', DESCATALOGADO_SIN_STOCK: 'Descatalogado · sin stock',
};
export const colorEstado: Record<Estado, string> = {
  ABIERTO: 'bg-ambar-claro text-ambar', EN_REVISION: 'bg-pizarra-claro text-pizarra', RESUELTO: 'bg-salvia-claro text-salvia',
};

/** 2026-11-16 → 16/11/2026 */
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-ES') : '—';
export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
