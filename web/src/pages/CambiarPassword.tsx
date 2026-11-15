import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { llamarUsuarios } from '../lib/supabase';
import { useSesion } from '../auth/Sesion';
import { Aviso, Boton, Campo } from '../components/ui';

export default function CambiarPassword() {
  const { perfil, recargarPerfil, salir } = useSesion();
  const navegar = useNavigate();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const obligatoria = perfil?.must_change_password;
  // Las tiendas solo eligen contraseña en su primer acceso.
  if (perfil?.role === 'STORE' && !obligatoria) return <Navigate to="/" replace />;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (nueva !== repetida) { setError('Las dos contraseñas no coinciden.'); return; }
    if (nueva.length < 10 || !/[A-Za-z]/.test(nueva) || !/[0-9]/.test(nueva)) {
      setError('Usa al menos 10 caracteres, combinando letras y números.'); return;
    }
    setEnviando(true);
    try {
      // La Edge Function cambia la contraseña y quita la obligación a la vez:
      // no hay forma de saltarse el cambio desde el navegador.
      await llamarUsuarios({ accion: 'cambiar_mi_password', password: nueva });
      await recargarPerfil();
      navegar('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <form onSubmit={guardar} className="flex w-full max-w-sm flex-col gap-5 rounded-lg border border-linea bg-white p-8">
        <div>
          <h1 className="text-2xl font-bold">{obligatoria ? 'Elige tu contraseña' : 'Cambiar contraseña'}</h1>
          {obligatoria && <p className="text-acero">Es tu primer acceso con una contraseña temporal. Elige una nueva para continuar.</p>}
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo id="nueva" etiqueta="Nueva contraseña" type="password" autoComplete="new-password" required
          ayuda="Mínimo 10 caracteres, con letras y números." value={nueva} onChange={(e) => setNueva(e.target.value)} />
        <Campo id="repetida" etiqueta="Repite la contraseña" type="password" autoComplete="new-password" required
          value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        <Boton type="submit" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar contraseña'}</Boton>
        {obligatoria
          ? <Boton type="button" variante="discreto" onClick={salir}>Cerrar sesión</Boton>
          : <Boton type="button" variante="discreto" onClick={() => navegar(-1)}>Cancelar</Boton>}
      </form>
    </div>
  );
}
