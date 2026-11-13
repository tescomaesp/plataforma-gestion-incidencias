-- ============================================================================
-- Plataforma de incidencias de garantía · Migración 1: esquema y seguridad
-- Se crea el esquema completo desde el principio (todas las fases) para no
-- tener que modificar tablas más adelante. La seguridad vive en la base de
-- datos (Row Level Security): el frontend habla directamente con Supabase y
-- cada consulta se filtra según el usuario del token.
-- ============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ----------------------------------------------------------------------------
-- Tipos
-- ----------------------------------------------------------------------------
create type public.user_role       as enum ('MASTER', 'STORE');
create type public.product_status  as enum ('ACTIVO', 'DESCATALOGADO_CON_STOCK', 'DESCATALOGADO_SIN_STOCK');
create type public.incident_status as enum ('PENDIENTE', 'EN_REVISION', 'INFO_SOLICITADA', 'RESUELTA');
create type public.attachment_kind as enum ('RECEIPT', 'PRODUCT_PHOTO');
create type public.resolution_type as enum ('CAMBIO_PRODUCTO', 'VALE', 'REEMBOLSO', 'DENEGADA_MAL_USO');

-- ----------------------------------------------------------------------------
-- Tiendas
-- ----------------------------------------------------------------------------
create table public.stores (
  id       serial primary key,
  code     varchar(10)  unique not null,          -- 'T01'...'T09'
  name     varchar(100) not null,
  address  varchar(255),
  active   boolean not null default true
);

-- ----------------------------------------------------------------------------
-- Perfiles: amplían auth.users (Supabase Auth guarda email y contraseña)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  username              varchar(50) unique not null,
  role                  public.user_role not null,
  store_id              int references public.stores(id),
  must_change_password  boolean not null default true,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  constraint profiles_role_store check (
    (role = 'STORE'  and store_id is not null) or
    (role = 'MASTER' and store_id is null)
  ),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,50}$')
);

-- ----------------------------------------------------------------------------
-- Trabajadoras de tienda (sin credenciales propias)
-- ----------------------------------------------------------------------------
create table public.store_workers (
  id          serial primary key,
  store_id    int not null references public.stores(id),
  full_name   varchar(100) not null check (length(trim(full_name)) > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, store_id)                           -- permite FK compuesta desde incidents
);
create index on public.store_workers (store_id, active);

-- ----------------------------------------------------------------------------
-- Catálogo de productos
-- ----------------------------------------------------------------------------
create table public.products (
  sku          varchar(30) primary key check (sku ~ '^[A-Za-z0-9./-]+$'),
  description  varchar(255) not null,              -- sin el prefijo '*' o '#'
  status       public.product_status not null default 'ACTIVO',
  active       boolean not null default true,       -- false = ya no aparece en el Excel importado
  updated_at   timestamptz not null default now()
);
create index products_search_idx on public.products
  using gin ((lower(sku || ' ' || description)) extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Incidencias
-- ----------------------------------------------------------------------------
create table public.incident_counters (
  year        int primary key,
  last_value  int not null default 0
);

create table public.incidents (
  id                          serial primary key,
  number                      varchar(20) unique not null,  -- INC-2026-00001
  store_id                    int not null references public.stores(id),
  created_by                  uuid not null references public.profiles(id),
  worker_id                   int not null,
  customer_full_name          varchar(150) not null,
  customer_email              varchar(255) not null,
  sku                         varchar(30) not null,
  product_description         varchar(255) not null,        -- copia en el momento del alta
  in_catalog                  boolean not null,             -- false = introducido manualmente
  product_status_at_creation  public.product_status,
  purchase_date               date not null,
  incident_date               date not null,
  amount_paid                 numeric(10,2) not null check (amount_paid > 0),
  defect_description          text not null,
  gdpr_consent                boolean not null check (gdpr_consent = true),
  gdpr_consent_at             timestamptz not null,
  status                      public.incident_status not null default 'PENDIENTE',
  anonymized_at               timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (incident_date >= purchase_date),
  foreign key (worker_id, store_id) references public.store_workers (id, store_id)
);
create index on public.incidents (store_id, status);
create index on public.incidents (sku);
create index on public.incidents (worker_id);
create index on public.incidents (created_at);

create table public.attachments (
  id             serial primary key,
  incident_id    int not null references public.incidents(id) on delete cascade,
  kind           public.attachment_kind not null,
  storage_path   varchar(255) not null,             -- ruta en Supabase Storage
  original_name  varchar(255) not null,
  mime_type      varchar(100) not null,
  size_bytes     int not null,
  uploaded_by    uuid not null references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index on public.attachments (incident_id);

create table public.resolutions (
  id              serial primary key,
  incident_id     int unique not null references public.incidents(id),
  type            public.resolution_type not null,
  amount          numeric(10,2),
  voucher_code    varchar(20) unique,
  justification   text,
  store_comment   text,
  resolved_by     uuid not null references public.profiles(id),
  resolved_at     timestamptz not null default now(),
  -- coalesce: en SQL un CHECK que evalúa a NULL se da por bueno, así que sin
  -- coalesce un vale sin importe o un rechazo sin justificación pasarían.
  check (type <> 'VALE'             or (coalesce(amount, 0) > 0 and voucher_code is not null)),
  check (type <> 'REEMBOLSO'        or coalesce(amount, 0) > 0),
  check (type <> 'DENEGADA_MAL_USO' or coalesce(length(trim(justification)), 0) > 0)
);

create table public.incident_events (
  id            serial primary key,
  incident_id   int not null references public.incidents(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  worker_id     int references public.store_workers(id),   -- trabajadora que actúa
  event_type    varchar(30) not null,  -- CREATED, STATUS_CHANGED, INFO_REQUESTED, INFO_PROVIDED, RESOLVED
  from_status   public.incident_status,
  to_status     public.incident_status,
  message       text,
  created_at    timestamptz not null default now()
);
create index on public.incident_events (incident_id);

create table public.notifications (
  id            serial primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  incident_id   int not null references public.incidents(id) on delete cascade,
  type          varchar(30) not null,  -- NEW_INCIDENT, INFO_REQUESTED, INFO_PROVIDED, RESOLVED
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.notifications (user_id, read_at);

-- ----------------------------------------------------------------------------
-- Funciones de identidad (security definer para que las políticas puedan
-- consultar profiles sin recursión). Un usuario desactivado no es nadie.
-- ----------------------------------------------------------------------------
create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'MASTER' and active
  )
$$;

create or replace function public.current_store_id() returns int
language sql stable security definer set search_path = public as $$
  select p.store_id from public.profiles p
  join public.stores s on s.id = p.store_id
  where p.id = auth.uid() and p.role = 'STORE' and p.active and s.active
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_master() or public.current_store_id() is not null
$$;

-- ----------------------------------------------------------------------------
-- Reglas de integridad
-- ----------------------------------------------------------------------------
-- Una trabajadora no cambia de tienda: si se traslada, se da de baja y se
-- crea en la nueva tienda (así su historial queda en la tienda correcta).
create or replace function public.tg_worker_store_immutable() returns trigger
language plpgsql as $$
begin
  if new.store_id <> old.store_id then
    raise exception 'Una trabajadora no puede cambiar de tienda. Dala de baja y créala en la nueva tienda.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger worker_store_immutable before update on public.store_workers
  for each row execute function public.tg_worker_store_immutable();

-- Siempre debe quedar al menos un usuario maestro activo.
create or replace function public.tg_keep_one_master() returns trigger
language plpgsql as $$
begin
  if old.role = 'MASTER' and old.active
     and (new.role <> 'MASTER' or not new.active)
     and not exists (select 1 from public.profiles
                     where role = 'MASTER' and active and id <> old.id) then
    raise exception 'Debe quedar al menos un usuario de central activo.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger keep_one_master before update on public.profiles
  for each row execute function public.tg_keep_one_master();

create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger incidents_touch before update on public.incidents
  for each row execute function public.tg_touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function public.tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- Sin política = acceso denegado. Las escrituras de incidencias, adjuntos y
-- resoluciones se harán en fases posteriores mediante funciones controladas.
-- ----------------------------------------------------------------------------
alter table public.stores             enable row level security;
alter table public.profiles           enable row level security;
alter table public.store_workers      enable row level security;
alter table public.products           enable row level security;
alter table public.incident_counters  enable row level security;
alter table public.incidents          enable row level security;
alter table public.attachments        enable row level security;
alter table public.resolutions        enable row level security;
alter table public.incident_events    enable row level security;
alter table public.notifications      enable row level security;

-- Tiendas: la central ve y edita todas; cada tienda ve solo la suya.
create policy stores_select on public.stores for select to authenticated
  using (public.is_master() or id = public.current_store_id());
create policy stores_update on public.stores for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- Perfiles: cada uno ve el suyo; la central ve todos. Altas, bajas y cambios
-- de contraseña pasan por la Edge Function "usuarios" (service role).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_master());

-- Trabajadoras: la tienda ve las suyas; solo la central las gestiona.
create policy workers_select on public.store_workers for select to authenticated
  using (public.is_master() or store_id = public.current_store_id());
create policy workers_insert on public.store_workers for insert to authenticated
  with check (public.is_master());
create policy workers_update on public.store_workers for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- Catálogo: lo lee cualquier usuario activo; solo la central lo modifica.
create policy products_select on public.products for select to authenticated
  using (public.is_active_user());
create policy products_insert on public.products for insert to authenticated
  with check (public.is_master());
create policy products_update on public.products for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- Incidencias y todo lo que cuelga de ellas: aislamiento por tienda.
create policy incidents_select on public.incidents for select to authenticated
  using (public.is_master() or store_id = public.current_store_id());

create policy attachments_select on public.attachments for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_master() or i.store_id = public.current_store_id())));

create policy resolutions_select on public.resolutions for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_master() or i.store_id = public.current_store_id())));

create policy events_select on public.incident_events for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_master() or i.store_id = public.current_store_id())));

-- Notificaciones: cada usuario ve y marca como leídas solo las suyas.
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_active_user());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- La única columna que un usuario puede tocar en sus notificaciones: read_at.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Refuerzo: el rol anónimo (sin sesión) no tiene acceso a ninguna tabla.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on function public.is_master(), public.current_store_id(), public.is_active_user() from anon;
