export type Rol = 'ADMIN' | 'RESPONSABLE' | 'STORE';
export type Estado = 'ABIERTO' | 'EN_REVISION' | 'RESUELTO';
export type Resultado = 'CAMBIO' | 'NO_CUBRE' | 'REPARACION' | 'COMPENSACION' | 'VALE_TIENDA' | 'REEMBOLSO';
export type EstadoProducto = 'ACTIVO' | 'DESCATALOGADO_CON_STOCK' | 'DESCATALOGADO_SIN_STOCK';

export interface Tienda { id: number; code: string; name: string; address: string | null; active: boolean }
export interface Perfil {
  id: string; username: string; role: Rol; store_id: number | null;
  must_change_password: boolean; active: boolean; created_at: string;
}
export interface TipoDefecto { id: number; name: string; active: boolean; sort: number }
export interface Producto { sku: string; description: string; status: EstadoProducto; active: boolean }
export interface Incidencia {
  id: number; number: string; store_id: number; created_by: string | null;
  sku: string; product_description: string; in_catalog: boolean; product_status_at_creation: EstadoProducto | null;
  defect_type_id: number | null; reason: string;
  customer_full_name: string; customer_email: string | null; customer_phone: string | null;
  purchase_date: string | null; incident_date: string; receipt_confirmed: boolean; gdpr_consent: boolean;
  status: Estado; resolution_type: Resultado | null; resolution_text: string | null;
  resolved_by: string | null; resolved_at: string | null; is_historical: boolean; created_at: string;
}
