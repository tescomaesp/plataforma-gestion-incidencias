import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { emailDeUsuario, mensajeLogin, supabase } from '../lib/supabase';
import { useSesion } from '../auth/Sesion';
import { Aviso, Boton, Campo } from '../components/ui';

export default function Login() {
  const { sesion, perfil, cargando } = useSesion();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion && perfil?.active) return <Navigate to="/" replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError(null); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: emailDeUsuario(usuario), password });
    setEnviando(false);
    if (error) setError(mensajeLogin(error.message));
  }

  return (
    <div className="grid min-h-full place-items-center bg-esmalte px-4 py-10">
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-5 rounded-lg bg-white p-8">
        <div>
          <h1 className="text-2xl font-bold">Incidencias de garantía</h1>
          <p className="text-acero">Entra con el usuario de tu tienda.</p>
        </div>
        {sesion && !cargando && !perfil?.active && (
          <Aviso tipo="error">Este usuario no tiene acceso a la plataforma. Contacta con la central.</Aviso>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo id="usuario" etiqueta="Usuario" autoComplete="username" autoCapitalize="none" required
          placeholder="tienda01" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        <Campo id="password" etiqueta="Contraseña" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <Boton type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</Boton>
        <p className="text-sm text-acero">¿Has olvidado la contraseña? Pide a la central que la restablezca.</p>
      </form>
    </div>
  );
}
