# Plataforma de incidencias de garantía · Fase 1

Gestión de incidencias de garantía entre 9 tiendas y la central, construida
sobre **Supabase** (base de datos, usuarios y seguridad) y una **app web
instalable** (PWA) para los ordenadores de tienda.

Esta fase incluye: usuarios y roles, tiendas, trabajadoras, catálogo de
productos y toda la seguridad de la base de datos. Las incidencias llegan en
las fases siguientes (el esquema ya está creado).

## Contenido

```
supabase/
  migrations/                  esquema + seguridad, tiendas y trabajadoras
  functions/usuarios/          Edge Function: altas, contraseñas y activación de usuarios
  config.toml
scripts/crear-usuarios.mjs     crea "central" y "tienda01"…"tienda09"
tests/                         pruebas de seguridad (21) y utilidades
web/                           app React + Vite + Tailwind, instalable como PWA
.github/workflows/             publicación automática en GitHub Pages
```

## Puesta en marcha

Necesitas Node.js 20 o superior y la CLI de Supabase (`npm install -g supabase`).

### 1. Crear el proyecto en Supabase

1. En supabase.com crea un proyecto. Elige una región de la UE (Frankfurt o
   París) por el RGPD. Guarda la contraseña de la base de datos.
2. En **Authentication > Sign In / Providers**:
   - desactiva **Allow new users to sign up** (solo la central crea usuarios);
   - deja activado el proveedor **Email**. No hace falta confirmar correos:
     los usuarios se crean ya confirmados.

### 2. Aplicar las migraciones

```bash
supabase login
supabase link --project-ref TU_REFERENCIA      # está en la URL del panel
supabase db push                               # aplica las migraciones
```

El catálogo de productos **no está en este repositorio** (es público). Se
importa directamente en Supabase: **Table Editor > products > Insert > Import
data from CSV**, con un CSV de columnas `sku,description,status`.

### 3. Desplegar la función de usuarios

```bash
supabase secrets set LOGIN_DOMAIN=tiendas.local APP_ORIGIN=https://tu-app.vercel.app
supabase functions deploy usuarios
```

`APP_ORIGIN` es la dirección donde publicarás la web (paso 5). Mientras no la
tengas, puedes omitirlo.

### 4. Crear los usuarios iniciales

Las claves están en **Project Settings > API**.

```bash
npm install
SUPABASE_URL=https://TU_REFERENCIA.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=tu-clave-service-role \
npm run crear-usuarios
```

El script muestra **una sola vez** la contraseña temporal de cada usuario.
Apúntalas y entrega cada una a su tienda: al entrar por primera vez, la
plataforma obliga a cambiarla.

> La clave `service_role` salta toda la seguridad. Úsala solo en este script,
> nunca en la web ni en un archivo compartido.

### 5. Publicar la web

**GitHub Pages (configuración actual):** cada cambio en `main` se publica solo
mediante `.github/workflows/publicar-web.yml`. Requisitos:

1. **Settings > Pages > Source:** GitHub Actions.
2. **Settings > Secrets and variables > Actions > Variables:** crea
   `SUPABASE_URL` y `SUPABASE_ANON_KEY` (la clave `anon` es pública por diseño).

**Alternativa, Vercel:** importa el repositorio, pon `web` como *Root Directory* y añade
estas variables de entorno:

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://TU_REFERENCIA.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | la clave `anon` (es pública, puede ir en la web) |
| `VITE_LOGIN_DOMAIN` | `tiendas.local` (el mismo que en el paso 3) |

**Netlify:** igual, con *Base directory* `web`, comando `npm run build` y
carpeta `web/dist`. Las redirecciones ya están incluidas (`_redirects` y
`vercel.json`).

### 6. Instalar la app en cada ordenador de tienda

Abre la dirección de la web en Chrome o Edge, entra con el usuario de la
tienda y pulsa el icono **Instalar** de la barra de direcciones. Queda como un
programa más, con icono en el escritorio. Las actualizaciones llegan solas.

## Primeros pasos en la plataforma

1. Entra como `central` y cambia la contraseña temporal.
2. En **Tiendas**, pon los nombres y direcciones reales.
3. En **Trabajadoras**, cambia los nombres provisionales por los reales.
4. Entrega a cada tienda su usuario y contraseña temporal.

## Pruebas

### Repetir las pruebas de seguridad en tu proyecto

Hazlo preferiblemente en un **proyecto de pruebas** de Supabase con las
migraciones aplicadas. Las pruebas crean usuarios e incidencias con el prefijo
`prueba-` y los borran al terminar.

Copia la cadena de conexión de **Project Settings > Database > Connection
string** (modo *Session*) y ejecuta:

```bash
DATABASE_URL="postgresql://postgres.TU_REFERENCIA:CONTRASEÑA@...:5432/postgres" npm run test:db
```

Deben pasar las 21.

### Pruebas locales (sin Supabase)

Con PostgreSQL 15 o superior instalado:

```bash
PGPASSWORD=tu-clave ./tests/preparar-bd-local.sh        # base limpia + shim de Supabase + migraciones
DATABASE_URL=postgres://postgres:tu-clave@localhost/incid_test npm run test:db
deno test --node-modules-dir=none supabase/functions/usuarios/   # 9 pruebas de la función
```

`tests/supabase_shim.sql` reproduce lo que Supabase trae de serie (roles,
`auth.uid()`, privilegios). **No** se aplica en Supabase.

## Seguridad: cómo funciona

- Cada tabla tiene Row Level Security. Una tienda solo puede leer los datos de
  su tienda, aunque manipule la API: lo impide la propia base de datos.
- Altas, contraseñas y desactivaciones pasan por la función `usuarios`, que
  comprueba que quien llama es la central.
- Un usuario desactivado queda bloqueado en Supabase Auth y, además, la base de
  datos deja de devolverle datos al instante.
- Siempre debe quedar al menos un usuario de central activo.
- Las resoluciones incompletas (vale sin importe, rechazo sin justificación…)
  se rechazan en la base de datos.

## Limitaciones conocidas

- **Bloqueo tras 5 intentos fallidos:** en el plan gratuito de Supabase no se
  puede personalizar. Supabase aplica su propio límite de intentos de inicio de
  sesión, que protege contra ataques de fuerza bruta.
- **Plan gratuito de Supabase:** 1 GB para archivos (unas 500 incidencias con
  fotos comprimidas) y el proyecto se pausa tras una semana sin uso. Comprueba
  los límites actuales en supabase.com/pricing.
