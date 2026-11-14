-- ============================================================================
-- Migración 5: nueva dinámica de incidencias
--  · Roles: ADMIN (todo), RESPONSABLE (resuelve y analiza), STORE (su tienda).
--  · Se eliminan las trabajadoras.
--  · Ticket con: tienda, referencia, tipo de defecto, motivo, fotos, cliente
--    (correo o teléfono), fechas, confirmación de ticket de compra y RGPD.
--  · Respuesta: cambio / no cubre / reparación / compensación + texto libre.
--  · Estados: ABIERTO → EN_REVISION → RESUELTO.
--  · Catálogo con importación masiva e histórico de cambios.
--  · Importación de incidencias antiguas y estadísticas.
-- Las tablas de incidencias anteriores estaban vacías: se recrean.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Limpieza del modelo anterior
-- ----------------------------------------------------------------------------
drop policy if exists stores_select on public.stores;
drop policy if exists stores_update on public.stores;
drop policy if exists profiles_select on public.profiles;
drop policy if exists products_select on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;

drop table if exists public.notifications, public.incident_events, public.resolutions,
  public.attachments, public.incidents, public.store_workers cascade;
drop function if exists public.tg_worker_store_immutable();
drop type if exists public.incident_status, public.attachment_kind, public.resolution_type;

-- Rol como texto con lista cerrada (los enum no admiten valores nuevos usados
-- en la misma transacción).
alter table public.profiles drop constraint if exists profiles_role_store;
alter table public.profiles alter column role type text
  using (case role::text when 'MASTER' then 'ADMIN' else role::text end);
drop type if exists public.user_role;
alter table public.profiles add constraint profiles_role_valido
  check (role in ('ADMIN', 'RESPONSABLE', 'STORE'));
alter table public.profiles add constraint profiles_role_store check (
  (role = 'STORE' and store_id is not null) or (role <> 'STORE' and store_id is null));

-- ----------------------------------------------------------------------------
-- 2. Identidad
-- ----------------------------------------------------------------------------
drop function if exists public.is_active_user();
drop function if exists public.is_master();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ADMIN' and active)
$$;

create or replace function public.is_central() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role in ('ADMIN', 'RESPONSABLE') and active)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_central() or public.current_store_id() is not null
$$;

-- Siempre debe quedar al menos un administrador activo.
create or replace function public.tg_keep_one_master() returns trigger
language plpgsql as $$
begin
  if old.role = 'ADMIN' and old.active and (new.role <> 'ADMIN' or not new.active)
     and not exists (select 1 from public.profiles where role = 'ADMIN' and active and id <> old.id) then
    raise exception 'Debe quedar al menos un administrador activo.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.tg_arranque_central() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'central@tiendas.local'
     and not exists (select 1 from public.profiles where role = 'ADMIN') then
    insert into public.profiles (id, username, role, store_id, must_change_password)
    values (new.id, 'central', 'ADMIN', null, false);
  end if;
  return new;
end $$;

create policy stores_select on public.stores for select to authenticated
  using (public.is_central() or id = public.current_store_id());
create policy stores_update on public.stores for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_central());

-- ----------------------------------------------------------------------------
-- 3. Tipos de defecto (editables por el administrador)
-- ----------------------------------------------------------------------------
create table public.defect_types (
  id      serial primary key,
  name    varchar(80) unique not null check (length(trim(name)) > 0),
  active  boolean not null default true,
  sort    int not null default 0
);
insert into public.defect_types (name, sort) values
  ('Rotura', 1), ('Defecto de fabricación', 2), ('Falta pieza', 3),
  ('Fallo eléctrico', 4), ('Desgaste antiadherente', 5), ('Otro', 99);
alter table public.defect_types enable row level security;
create policy defect_types_select on public.defect_types for select to authenticated
  using (public.is_active_user());
create policy defect_types_insert on public.defect_types for insert to authenticated
  with check (public.is_admin());
create policy defect_types_update on public.defect_types for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Catálogo con histórico de cambios
-- ----------------------------------------------------------------------------
create table public.product_imports (
  id            bigserial primary key,
  file_name     text not null,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  total         int not null default 0,
  nuevos        int not null default 0,
  actualizados  int not null default 0,
  sin_cambios   int not null default 0,
  desactivados  int not null default 0,
  errores       int not null default 0
);

create table public.product_changes (
  id               bigserial primary key,
  sku              varchar(30) not null,
  change_type      text not null,   -- ALTA, MODIFICACION
  old_description  varchar(255),
  new_description  varchar(255),
  old_status       public.product_status,
  new_status       public.product_status,
  old_active       boolean,
  new_active       boolean,
  changed_by       uuid,
  changed_at       timestamptz not null default now(),
  import_id        bigint references public.product_imports(id)
);
create index on public.product_changes (sku, changed_at desc);
create index on public.product_changes (changed_at desc);

-- Cada alta o cambio de un producto queda registrado, venga de donde venga.
create or replace function public.tg_product_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_import bigint := nullif(current_setting('app.import_id', true), '')::bigint;
begin
  if tg_op = 'INSERT' then
    insert into public.product_changes (sku, change_type, new_description, new_status, new_active, changed_by, import_id)
    values (new.sku, 'ALTA', new.description, new.status, new.active, auth.uid(), v_import);
  elsif (old.description, old.status, old.active) is distinct from (new.description, new.status, new.active) then
    insert into public.product_changes (sku, change_type, old_description, new_description, old_status, new_status,
                                        old_active, new_active, changed_by, import_id)
    values (new.sku, 'MODIFICACION', old.description, new.description, old.status, new.status,
            old.active, new.active, auth.uid(), v_import);
  end if;
  return new;
end $$;
create trigger product_history after insert or update on public.products
  for each row execute function public.tg_product_history();

alter table public.product_imports enable row level security;
alter table public.product_changes enable row level security;
create policy product_imports_select on public.product_imports for select to authenticated using (public.is_central());
create policy product_changes_select on public.product_changes for select to authenticated using (public.is_central());
create policy products_select on public.products for select to authenticated using (public.is_active_user());
-- Las escrituras del catálogo pasan por catalogo_importar() o por estas políticas (solo admin).
create policy products_insert on public.products for insert to authenticated with check (public.is_admin());
create policy products_update on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Importación masiva. Con p_aplicar = false solo devuelve el resumen (vista previa).
-- Cada fila: {sku, descripcion, estado}. Si falta el estado, se deduce del
-- prefijo de la descripción del sistema de la empresa ('*' sin stock, '#' con stock).
create or replace function public.catalogo_importar(
  p_filas jsonb, p_nombre text, p_desactivar_ausentes boolean, p_aplicar boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb; i int := 0; v_sku text; v_desc text; v_est text; v_err text;
  v_prev public.products%rowtype;
  n_nuevos int := 0; n_act int := 0; n_igual int := 0; n_err int := 0; n_desact int := 0;
  errores jsonb := '[]'::jsonb; cambios jsonb := '[]'::jsonb;
  vistos text[] := '{}'; v_import bigint;
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede importar el catálogo.'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no contiene filas.';
  end if;
  if p_aplicar then
    insert into public.product_imports (file_name, created_by) values (coalesce(p_nombre, 'importación'), auth.uid())
    returning id into v_import;
    perform set_config('app.import_id', v_import::text, true);
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1; v_err := null;
    v_sku  := upper(trim(coalesce(f->>'sku', '')));
    v_desc := trim(coalesce(f->>'descripcion', ''));
    v_est  := upper(trim(coalesce(f->>'estado', '')));
    if v_est = '' then
      v_est := case when v_desc like '*%' then 'DESCATALOGADO_SIN_STOCK'
                    when v_desc like '#%' then 'DESCATALOGADO_CON_STOCK' else 'ACTIVO' end;
    end if;
    v_desc := trim(regexp_replace(v_desc, '^[*#]\s*', ''));
    v_est := case v_est when 'DESCATALOGADO CON STOCK' then 'DESCATALOGADO_CON_STOCK'
                        when 'DESCATALOGADO SIN STOCK' then 'DESCATALOGADO_SIN_STOCK' else v_est end;

    if v_sku = '' then v_err := 'Falta la referencia (SKU).';
    elsif v_sku !~ '^[A-Z0-9./-]{1,30}$' then v_err := 'Referencia con caracteres no válidos: ' || v_sku;
    elsif v_desc = '' then v_err := 'Falta la descripción.';
    elsif length(v_desc) > 255 then v_err := 'Descripción de más de 255 caracteres.';
    elsif v_est not in ('ACTIVO', 'DESCATALOGADO_CON_STOCK', 'DESCATALOGADO_SIN_STOCK') then
      v_err := 'Estado no válido: ' || v_est || ' (ACTIVO, DESCATALOGADO_CON_STOCK o DESCATALOGADO_SIN_STOCK).';
    elsif v_sku = any(vistos) then v_err := 'Referencia repetida en el archivo: ' || v_sku;
    end if;

    if v_err is not null then
      n_err := n_err + 1;
      if jsonb_array_length(errores) < 200 then
        errores := errores || jsonb_build_object('fila', i + 1, 'sku', v_sku, 'error', v_err);
      end if;
      continue;
    end if;
    vistos := vistos || v_sku;

    select * into v_prev from public.products where sku = v_sku;
    if not found then
      n_nuevos := n_nuevos + 1;
      if jsonb_array_length(cambios) < 200 then
        cambios := cambios || jsonb_build_object('tipo', 'NUEVO', 'sku', v_sku, 'descripcion', v_desc, 'estado', v_est);
      end if;
      if p_aplicar then
        insert into public.products (sku, description, status) values (v_sku, v_desc, v_est::public.product_status);
      end if;
    elsif v_prev.description = v_desc and v_prev.status::text = v_est and v_prev.active then
      n_igual := n_igual + 1;
    else
      n_act := n_act + 1;
      if jsonb_array_length(cambios) < 200 then
        cambios := cambios || jsonb_build_object('tipo', 'CAMBIO', 'sku', v_sku,
          'antes', jsonb_build_object('descripcion', v_prev.description, 'estado', v_prev.status, 'activo', v_prev.active),
          'despues', jsonb_build_object('descripcion', v_desc, 'estado', v_est, 'activo', true));
      end if;
      if p_aplicar then
        update public.products set description = v_desc, status = v_est::public.product_status, active = true
        where sku = v_sku;
      end if;
    end if;
  end loop;

  if p_desactivar_ausentes then
    select count(*) into n_desact from public.products where active and not (sku = any(vistos));
    if p_aplicar then
      update public.products set active = false where active and not (sku = any(vistos));
    end if;
  end if;

  if p_aplicar then
    update public.product_imports set total = i, nuevos = n_nuevos, actualizados = n_act,
      sin_cambios = n_igual, desactivados = n_desact, errores = n_err where id = v_import;
  end if;

  return jsonb_build_object('total', i, 'nuevos', n_nuevos, 'actualizados', n_act, 'sin_cambios', n_igual,
    'desactivados', n_desact, 'errores', n_err, 'detalle_errores', errores, 'cambios', cambios,
    'importacion_id', v_import);
end $$;

-- Búsqueda de productos para el formulario (respeta la seguridad del usuario).
create or replace function public.buscar_productos(q text)
returns setof public.products language sql stable security invoker set search_path = public as $$
  select * from public.products
  where active and length(trim(coalesce(q, ''))) >= 2
    and lower(sku || ' ' || description) like '%' || lower(trim(q)) || '%'
  order by (upper(sku) = upper(trim(q))) desc, (upper(sku) like upper(trim(q)) || '%') desc, sku
  limit 20
$$;

-- ----------------------------------------------------------------------------
-- 5. Incidencias
-- ----------------------------------------------------------------------------
create type public.incident_status as enum ('ABIERTO', 'EN_REVISION', 'RESUELTO');
create type public.resolution_type as enum ('CAMBIO', 'NO_CUBRE', 'REPARACION', 'COMPENSACION');

create table public.incident_imports (
  id          bigserial primary key,
  file_name   text not null,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  total       int not null default 0,
  importadas  int not null default 0,
  errores     int not null default 0
);

create sequence public.historical_number_seq;

create table public.incidents (
  id                          serial primary key,
  number                      varchar(30) unique not null,          -- INC-2026-00001 / HIS-00001
  store_id                    int not null references public.stores(id),
  created_by                  uuid references public.profiles(id),  -- vacío en las históricas
  sku                         varchar(30) not null,
  product_description         varchar(255) not null,               -- copia en el momento del alta
  in_catalog                  boolean not null default true,
  product_status_at_creation  public.product_status,
  defect_type_id              int references public.defect_types(id),
  reason                      text not null,                       -- motivo
  customer_full_name          varchar(150) not null,
  customer_email              varchar(255),
  customer_phone              varchar(30),
  -- Identificador del cliente para las estadísticas: su correo o, si no hay, su teléfono.
  customer_key                varchar(255) generated always as (
    coalesce(nullif(lower(trim(customer_email)), ''),
             nullif(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), ''))) stored,
  purchase_date               date,
  incident_date               date not null,
  receipt_confirmed           boolean not null default false,
  gdpr_consent                boolean not null default false,
  gdpr_consent_at             timestamptz,
  status                      public.incident_status not null default 'ABIERTO',
  resolution_type             public.resolution_type,
  resolution_text             text,
  resolved_by                 uuid references public.profiles(id),
  resolved_at                 timestamptz,
  is_historical               boolean not null default false,
  import_id                   bigint references public.incident_imports(id),
  anonymized_at               timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (customer_key is not null),
  check (purchase_date is null or incident_date >= purchase_date),
  -- Los tickets nuevos exigen todos los datos; las incidencias importadas, no.
  check (is_historical or (receipt_confirmed and gdpr_consent and purchase_date is not null
                           and defect_type_id is not null and created_by is not null)),
  check ((status = 'RESUELTO') = (resolution_type is not null)),
  check (status <> 'RESUELTO' or is_historical or coalesce(length(trim(resolution_text)), 0) > 0)
);
create index on public.incidents (store_id, status);
create index on public.incidents (status, created_at);
create index on public.incidents (sku);
create index on public.incidents (customer_key);
create index on public.incidents (incident_date);
create trigger incidents_touch before update on public.incidents
  for each row execute function public.tg_touch_updated_at();

create table public.incident_photos (
  id            serial primary key,
  incident_id   int not null references public.incidents(id) on delete cascade,
  storage_path  text unique not null,
  mime_type     text,
  size_bytes    int,
  uploaded_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index on public.incident_photos (incident_id);

create table public.incident_events (
  id            serial primary key,
  incident_id   int not null references public.incidents(id) on delete cascade,
  user_id       uuid references public.profiles(id),
  event_type    varchar(30) not null,   -- CREADO, EN_REVISION, REABIERTO, RESUELTO, IMPORTADO
  message       text,
  created_at    timestamptz not null default now()
);
create index on public.incident_events (incident_id);

alter table public.incidents         enable row level security;
alter table public.incident_photos   enable row level security;
alter table public.incident_events   enable row level security;
alter table public.incident_imports  enable row level security;

-- Lectura: la central ve todo; cada tienda, lo suyo. Las escrituras solo por funciones.
create policy incidents_select on public.incidents for select to authenticated
  using (public.is_central() or store_id = public.current_store_id());
create policy photos_select on public.incident_photos for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_central() or i.store_id = public.current_store_id())));
create policy events_select on public.incident_events for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_central() or i.store_id = public.current_store_id())));
create policy incident_imports_select on public.incident_imports for select to authenticated
  using (public.is_central());

-- ----------------------------------------------------------------------------
-- 6. Fotos en Supabase Storage (privadas). Ruta: <id_tienda>/<archivo>
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incidencias', 'incidencias', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists incidencias_subir on storage.objects;
drop policy if exists incidencias_ver on storage.objects;
create policy incidencias_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'incidencias' and (
    public.is_central() or (storage.foldername(name))[1] = public.current_store_id()::text));
create policy incidencias_ver on storage.objects for select to authenticated
  using (bucket_id = 'incidencias' and (
    public.is_central() or (storage.foldername(name))[1] = public.current_store_id()::text));

-- ----------------------------------------------------------------------------
-- 7. Funciones de las incidencias
-- ----------------------------------------------------------------------------
create or replace function public.crear_incidencia(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_store int; v_prod public.products%rowtype; v_desc text; v_in_cat boolean := true;
  v_email text := nullif(lower(trim(coalesce(d->>'customer_email', ''))), '');
  v_phone text := nullif(trim(coalesce(d->>'customer_phone', '')), '');
  v_nombre text := trim(coalesce(d->>'customer_full_name', ''));
  v_motivo text := trim(coalesce(d->>'reason', ''));
  v_sku text := upper(trim(coalesce(d->>'sku', '')));
  v_compra date; v_incid date; v_fotos text[]; v_path text; v_n int; v_num text; v_id int;
  v_year int := extract(year from current_date);
begin
  -- Tienda: la de su usuario; la central la elige.
  if public.is_central() then
    select id into v_store from public.stores where id = (d->>'store_id')::int and active;
    if v_store is null then raise exception 'Elige la tienda de la incidencia.'; end if;
  else
    v_store := public.current_store_id();
    if v_store is null then raise exception 'No tienes permiso para abrir incidencias.'; end if;
  end if;

  if v_sku = '' then raise exception 'Indica la referencia del producto.'; end if;
  select * into v_prod from public.products where sku = v_sku;
  if found then
    v_desc := v_prod.description;
  else
    v_in_cat := false;
    v_desc := trim(coalesce(d->>'product_description', ''));
    if v_desc = '' then raise exception 'La referencia % no está en el catálogo: indica la descripción del producto.', v_sku; end if;
  end if;

  if not exists (select 1 from public.defect_types where id = (d->>'defect_type_id')::int and active) then
    raise exception 'Elige el tipo de defecto.';
  end if;
  if length(v_motivo) < 10 then raise exception 'Explica el motivo de la incidencia (mínimo 10 caracteres).'; end if;
  if v_nombre !~ '\S+\s+\S+' then raise exception 'Indica el nombre y al menos un apellido del cliente.'; end if;
  if v_email is null and v_phone is null then raise exception 'Indica el correo o el teléfono del cliente.'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El correo del cliente no es válido.'; end if;
  if v_phone is not null and length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    raise exception 'El teléfono del cliente debe tener al menos 9 dígitos.';
  end if;

  begin
    v_compra := (d->>'purchase_date')::date; v_incid := (d->>'incident_date')::date;
  exception when others then raise exception 'Las fechas no son válidas.';
  end;
  if v_compra is null or v_incid is null then raise exception 'Indica la fecha de compra y la de la incidencia.'; end if;
  if v_incid > current_date or v_compra > current_date then raise exception 'Las fechas no pueden ser futuras.'; end if;
  if v_incid < v_compra then raise exception 'La fecha de la incidencia no puede ser anterior a la de compra.'; end if;
  if coalesce((d->>'receipt_confirmed')::boolean, false) is not true then
    raise exception 'Confirma que el cliente ha entregado el ticket de compra.';
  end if;
  if coalesce((d->>'gdpr_consent')::boolean, false) is not true then
    raise exception 'Falta el consentimiento del cliente para el tratamiento de sus datos.';
  end if;

  select array_agg(x) into v_fotos from jsonb_array_elements_text(coalesce(d->'fotos', '[]'::jsonb)) x;
  if coalesce(array_length(v_fotos, 1), 0) = 0 then raise exception 'Añade al menos una foto del producto.'; end if;
  if array_length(v_fotos, 1) > 6 then raise exception 'Como máximo 6 fotos por incidencia.'; end if;
  foreach v_path in array v_fotos loop
    if (storage.foldername(v_path))[1] is distinct from v_store::text
       or not exists (select 1 from storage.objects where bucket_id = 'incidencias' and name = v_path)
       or exists (select 1 from public.incident_photos where storage_path = v_path) then
      raise exception 'Una de las fotos no es válida. Vuelve a adjuntarla.';
    end if;
  end loop;

  insert into public.incident_counters (year, last_value) values (v_year, 1)
  on conflict (year) do update set last_value = public.incident_counters.last_value + 1
  returning last_value into v_n;
  v_num := 'INC-' || v_year || '-' || lpad(v_n::text, 5, '0');

  insert into public.incidents (number, store_id, created_by, sku, product_description, in_catalog,
    product_status_at_creation, defect_type_id, reason, customer_full_name, customer_email, customer_phone,
    purchase_date, incident_date, receipt_confirmed, gdpr_consent, gdpr_consent_at)
  values (v_num, v_store, auth.uid(), v_sku, v_desc, v_in_cat, case when v_in_cat then v_prod.status end,
    (d->>'defect_type_id')::int, v_motivo, v_nombre, v_email, v_phone,
    v_compra, v_incid, true, true, now())
  returning id into v_id;

  insert into public.incident_photos (incident_id, storage_path, mime_type, size_bytes, uploaded_by)
  select v_id, o.name, o.metadata->>'mimetype', (o.metadata->>'size')::int, auth.uid()
  from storage.objects o where o.bucket_id = 'incidencias' and o.name = any(v_fotos);

  insert into public.incident_events (incident_id, user_id, event_type) values (v_id, auth.uid(), 'CREADO');
  return jsonb_build_object('id', v_id, 'number', v_num);
end $$;

create or replace function public.cambiar_estado_incidencia(p_id int, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status;
begin
  if not public.is_central() then raise exception 'Solo la central puede cambiar el estado.'; end if;
  select status into v_actual from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
  if v_actual = 'RESUELTO' then raise exception 'La incidencia ya está resuelta.'; end if;
  if p_estado not in ('ABIERTO', 'EN_REVISION') then raise exception 'Estado no válido.'; end if;
  if v_actual::text = p_estado then return; end if;
  update public.incidents set status = p_estado::public.incident_status where id = p_id;
  insert into public.incident_events (incident_id, user_id, event_type)
  values (p_id, auth.uid(), case p_estado when 'EN_REVISION' then 'EN_REVISION' else 'REABIERTO' end);
end $$;

create or replace function public.resolver_incidencia(p_id int, p_resultado text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status;
begin
  if not public.is_central() then raise exception 'Solo la central puede resolver incidencias.'; end if;
  select status into v_actual from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
  if v_actual = 'RESUELTO' then raise exception 'La incidencia ya está resuelta.'; end if;
  if p_resultado not in ('CAMBIO', 'NO_CUBRE', 'REPARACION', 'COMPENSACION') then
    raise exception 'Elige el resultado: cambio, no cubre, reparación o compensación.';
  end if;
  if length(trim(coalesce(p_texto, ''))) < 5 then raise exception 'Escribe la respuesta para la tienda.'; end if;
  update public.incidents set status = 'RESUELTO', resolution_type = p_resultado::public.resolution_type,
    resolution_text = trim(p_texto), resolved_by = auth.uid(), resolved_at = now()
  where id = p_id;
  insert into public.incident_events (incident_id, user_id, event_type, message)
  values (p_id, auth.uid(), 'RESUELTO', p_resultado);
end $$;

-- Importación de incidencias antiguas (central). Con p_aplicar = false, vista previa.
-- Cada fila: {tienda, fecha_incidencia, fecha_compra, sku, producto, tipo_defecto,
--             motivo, cliente, correo, telefono, resultado, respuesta}
create or replace function public.importar_incidencias(p_filas jsonb, p_nombre text, p_aplicar boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f jsonb; i int := 0; v_err text; v_store int; v_compra date; v_incid date; v_res text; v_def int;
  v_sku text; v_desc text; v_prod public.products%rowtype; v_email text; v_phone text; v_import bigint;
  n_ok int := 0; n_err int := 0; errores jsonb := '[]'::jsonb; v_id int;
begin
  if not public.is_central() then raise exception 'Solo la central puede importar incidencias.'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no contiene filas.'; end if;
  if p_aplicar then
    insert into public.incident_imports (file_name, created_by) values (coalesce(p_nombre, 'importación'), auth.uid())
    returning id into v_import;
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1; v_err := null; v_store := null; v_def := null; v_res := null;
    select id into v_store from public.stores
      where upper(code) = upper(trim(coalesce(f->>'tienda', ''))) or lower(name) = lower(trim(coalesce(f->>'tienda', '')));
    begin
      v_incid := nullif(trim(coalesce(f->>'fecha_incidencia', '')), '')::date;
      v_compra := nullif(trim(coalesce(f->>'fecha_compra', '')), '')::date;
    exception when others then v_err := 'Fecha no válida (usa AAAA-MM-DD o DD/MM/AAAA).';
    end;
    v_sku := upper(trim(coalesce(f->>'sku', '')));
    v_email := nullif(lower(trim(coalesce(f->>'correo', ''))), '');
    v_phone := nullif(trim(coalesce(f->>'telefono', '')), '');
    v_res := case upper(translate(trim(coalesce(f->>'resultado', '')), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
               when '' then null when 'CAMBIO' then 'CAMBIO' when 'NO CUBRE' then 'NO_CUBRE' when 'NO_CUBRE' then 'NO_CUBRE'
               when 'REPARACION' then 'REPARACION' when 'COMPENSACION' then 'COMPENSACION' else '?' end;
    select id into v_def from public.defect_types where lower(name) = lower(trim(coalesce(f->>'tipo_defecto', '')));

    if v_err is not null then null;
    elsif v_store is null then v_err := 'Tienda no encontrada: ' || coalesce(f->>'tienda', '(vacía)');
    elsif v_incid is null then v_err := 'Falta la fecha de la incidencia.';
    elsif v_sku = '' then v_err := 'Falta la referencia (SKU).';
    elsif length(trim(coalesce(f->>'cliente', ''))) = 0 then v_err := 'Falta el nombre del cliente.';
    elsif v_email is null and v_phone is null then v_err := 'Falta el correo o el teléfono del cliente.';
    elsif v_res = '?' then v_err := 'Resultado no válido: ' || (f->>'resultado') || ' (cambio, no cubre, reparación o compensación).';
    elsif v_compra is not null and v_incid < v_compra then v_err := 'La fecha de la incidencia es anterior a la de compra.';
    end if;

    if v_err is not null then
      n_err := n_err + 1;
      if jsonb_array_length(errores) < 200 then errores := errores || jsonb_build_object('fila', i + 1, 'error', v_err); end if;
      continue;
    end if;
    n_ok := n_ok + 1;

    if p_aplicar then
      select * into v_prod from public.products where sku = v_sku;
      v_desc := coalesce(v_prod.description, nullif(trim(coalesce(f->>'producto', '')), ''), '(sin descripción)');
      insert into public.incidents (number, store_id, sku, product_description, in_catalog, product_status_at_creation,
        defect_type_id, reason, customer_full_name, customer_email, customer_phone, purchase_date, incident_date,
        status, resolution_type, resolution_text, resolved_at, is_historical, import_id)
      values ('HIS-' || lpad(nextval('public.historical_number_seq')::text, 5, '0'), v_store, v_sku, left(v_desc, 255),
        v_prod.sku is not null, v_prod.status, v_def, coalesce(nullif(trim(f->>'motivo'), ''), '(importada sin motivo)'),
        left(trim(f->>'cliente'), 150), v_email, v_phone, v_compra, v_incid,
        case when v_res is null then 'ABIERTO' else 'RESUELTO' end::public.incident_status,
        v_res::public.resolution_type, nullif(trim(coalesce(f->>'respuesta', '')), ''),
        case when v_res is not null then v_incid::timestamptz end, true, v_import)
      returning id into v_id;
      insert into public.incident_events (incident_id, user_id, event_type) values (v_id, auth.uid(), 'IMPORTADO');
    end if;
  end loop;

  if p_aplicar then
    update public.incident_imports set total = i, importadas = n_ok, errores = n_err where id = v_import;
  end if;
  return jsonb_build_object('total', i, 'validas', n_ok, 'errores', n_err, 'detalle_errores', errores);
end $$;

-- Estadísticas. Se ejecutan con la seguridad del usuario: una tienda solo
-- cuenta sus propias incidencias.
create or replace function public.estadisticas(p_desde date, p_hasta date, p_tienda int, p_historicas boolean)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as (
    select i.*, s.code as store_code, s.name as store_name, dt.name as defect_name
    from public.incidents i
    join public.stores s on s.id = i.store_id
    left join public.defect_types dt on dt.id = i.defect_type_id
    where (p_desde is null or i.incident_date >= p_desde)
      and (p_hasta is null or i.incident_date <= p_hasta)
      and (p_tienda is null or i.store_id = p_tienda)
      and (p_historicas or not i.is_historical)
  )
  select jsonb_build_object(
    'resumen', (select jsonb_build_object(
        'total', count(*),
        'abiertos', count(*) filter (where status = 'ABIERTO'),
        'en_revision', count(*) filter (where status = 'EN_REVISION'),
        'resueltos', count(*) filter (where status = 'RESUELTO')) from base),
    'productos', coalesce((select jsonb_agg(x order by x.incidencias desc, x.sku) from (
        select sku, max(product_description) as descripcion, count(*) as incidencias
        from base group by sku) x), '[]'),
    'tiendas', coalesce((select jsonb_agg(x order by x.incidencias desc, x.codigo) from (
        select store_code as codigo, store_name as tienda, count(*) as incidencias
        from base group by store_code, store_name) x), '[]'),
    'clientes', coalesce((select jsonb_agg(x order by x.incidencias desc, x.cliente) from (
        select (array_agg(customer_full_name order by incident_date desc))[1] as cliente,
               max(customer_email) as correo, max(customer_phone) as telefono, count(*) as incidencias
        from base group by customer_key) x), '[]'),
    'resultados', coalesce((select jsonb_object_agg(coalesce(resolution_type::text, 'PENDIENTE'), n) from (
        select resolution_type, count(*) n from base group by resolution_type) x), '{}'),
    'defectos', coalesce((select jsonb_object_agg(coalesce(defect_name, 'Sin tipo'), n) from (
        select defect_name, count(*) n from base group by defect_name) x), '{}')
  )
$$;

-- Permisos de ejecución: nadie sin sesión.
revoke execute on function public.crear_incidencia(jsonb), public.cambiar_estado_incidencia(int, text),
  public.resolver_incidencia(int, text, text), public.importar_incidencias(jsonb, text, boolean),
  public.catalogo_importar(jsonb, text, boolean, boolean), public.estadisticas(date, date, int, boolean),
  public.buscar_productos(text), public.is_admin(), public.is_central(), public.is_active_user()
  from anon, public;
grant execute on function public.crear_incidencia(jsonb), public.cambiar_estado_incidencia(int, text),
  public.resolver_incidencia(int, text, text), public.importar_incidencias(jsonb, text, boolean),
  public.catalogo_importar(jsonb, text, boolean, boolean), public.estadisticas(date, date, int, boolean),
  public.buscar_productos(text), public.is_admin(), public.is_central(), public.is_active_user()
  to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
