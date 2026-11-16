import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { emailDeUsuario, mensajeLogin, supabase } from '../lib/supabase';
import { useSesion } from '../auth/Sesion';
import { Aviso, Boton, Campo } from '../components/ui';

export default function Login() {
  const { sesion, perfil, cargando, motivoSalida, errorPerfil, salir } = useSesion();
  const [parametros] = useSearchParams();
  const [usuario, setUsuario] = useState(parametros.get('usuario') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (sesion && perfil?.active) return <Navigate to="/" replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError(null); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: await emailDeUsuario(usuario), password });
    setEnviando(false);
    if (error) setError(mensajeLogin(error.message));
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-esmalte px-4 py-10">
      <img src={`${import.meta.env.BASE_URL}logo-tescoma.png`} alt="Tescoma" className="h-16 w-auto" />
      <form onSubmit={entrar} className="flex w-full max-w-sm flex-col gap-5 rounded-lg bg-white p-8">
        <div>
          <h1 className="text-2xl font-bold">Incidencias de garantía</h1>
          <p className="text-acero">Entra con el usuario de tu tienda.</p>
        </div>
        {!sesion && motivoSalida && !error && <Aviso tipo="error">{motivoSalida}</Aviso>}
        {sesion && !cargando && !perfil?.active && (
          <>
            <Aviso tipo="error">
              {errorPerfil
                ? `Has entrado, pero no se ha podido cargar tu perfil: ${errorPerfil}. Avisa a la central.`
                : 'Este usuario no tiene acceso a la plataforma. Contacta con la central.'}
            </Aviso>
            <Boton type="button" variante="secundario" onClick={salir}>Cerrar sesión</Boton>
          </>
        )}
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo id="usuario" etiqueta="Usuario o email" autoComplete="username" autoCapitalize="none" required
          placeholder="tienda01" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        <Campo id="password" etiqueta="Contraseña" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <Boton type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</Boton>
        <p className="text-sm text-acero">¿Has olvidado la contraseña? Pide a la central que la restablezca.</p>
      </form>
    </div>
  );
}
