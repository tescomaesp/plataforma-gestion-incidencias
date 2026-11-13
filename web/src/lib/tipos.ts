export type Rol = 'MASTER' | 'STORE';
export interface Tienda { id: number; code: string; name: string; address: string | null; active: boolean }
export interface Perfil {
  id: string; username: string; role: Rol; store_id: number | null;
  must_change_password: boolean; active: boolean; created_at: string;
}
export interface Trabajadora { id: number; store_id: number; full_name: string; active: boolean }
