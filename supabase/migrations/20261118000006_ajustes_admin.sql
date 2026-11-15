-- ============================================================================
-- Migración 6: ajustes pedidos por el administrador
--  · El administrador crea, desactiva y borra tiendas.
--  · Nombres de usuario libres (solo se reserva la "@" para entrar con email).
--  · Copia cifrada de las contraseñas, visible solo para el administrador.
--  · Ticket: correo obligatorio, teléfono opcional y pregunta obligatoria
--    "¿entrega ticket de compra?" (sí o no).
--  · Estadísticas filtrables por cliente (nombre, correo o teléfono).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Tiendas: alta, edición y borrado por el administrador
-- ----------------------------------------------------------------------------
drop policy if exists stores_insert on public.stores;
create policy stores_insert on public.stores for insert to authenticated with check (public.is_admin());

create or replace function public.borrar_tienda(p_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede borrar tiendas.'; end if;
  if exists (select 1 from public.incidents where store_id = p_id) then
    raise exception 'Esta tienda tiene incidencias registradas y no se puede borrar. Desactívala para que deje de usarse.';
  end if;
  if exists (select 1 from public.profiles where store_id = p_id) then
    raise exception 'Esta tienda tiene usuarios. Bórralos o desactívalos antes de borrar la tienda.';
  end if;
  delete from public.stores where id = p_id;
  if not found then raise exception 'No existe esa tienda.'; end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Nombres de usuario libres
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_valido
  check (length(trim(username)) between 1 and 100 and position('@' in username) = 0);
create unique index if not exists profiles_username_unico on public.profiles (lower(trim(username)));

-- ----------------------------------------------------------------------------
-- 3. Contraseñas visibles para el administrador
-- La clave de cifrado se genera aquí y vive en un esquema que la API no expone.
-- ----------------------------------------------------------------------------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.clave (id int primary key default 1 check (id = 1), valor text not null);
insert into privado.clave (valor) values (encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

create table if not exists privado.contrasenas (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  cifrada     bytea not null,
  updated_at  timestamptz not null default now()
);

-- La llama solo la función "usuarios" (service role) al crear, restablecer o cambiar.
create or replace function public.guardar_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into privado.contrasenas (user_id, cifrada, updated_at)
  values (p_user, pgp_sym_encrypt(p_password, (select valor from privado.clave)), now())
  on conflict (user_id) do update set cifrada = excluded.cifrada, updated_at = now();
end $$;
revoke execute on function public.guardar_password(uuid, text) from public, anon, authenticated;
grant execute on function public.guardar_password(uuid, text) to service_role;

create or replace function public.ver_passwords()
returns table (user_id uuid, password text, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede ver las contraseñas.'; end if;
  return query
    select c.user_id, pgp_sym_decrypt(c.cifrada, (select valor from privado.clave)), c.updated_at
    from privado.contrasenas c;
end $$;
revoke execute on function public.ver_passwords() from public, anon;
grant execute on function public.ver_passwords() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Ticket: correo obligatorio y "¿entrega ticket de compra?" sí/no
-- ----------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.incidents'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%receipt_confirmed%' loop
    execute format('alter table public.incidents drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.incidents add constraint incidents_ticket_completo check (
  is_historical or (gdpr_consent and purchase_date is not null and defect_type_id is not null
                    and created_by is not null and customer_email is not null));

create or replace function public.crear_incidencia(d jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_store int; v_prod public.products%rowtype; v_desc text; v_in_cat boolean := true;
  v_email text := nullif(lower(trim(coalesce(d->>'customer_email', ''))), '');
  v_phone text := nullif(trim(coalesce(d->>'customer_phone', '')), '');
  v_nombre text := trim(coalesce(d->>'customer_full_name', ''));
  v_motivo text := trim(coalesce(d->>'reason', ''));
  v_sku text := upper(trim(coalesce(d->>'sku', '')));
  v_ticket text := lower(coalesce(d->>'receipt_confirmed', ''));
  v_compra date; v_incid date; v_fotos text[]; v_path text; v_n int; v_num text; v_id int;
  v_year int := extract(year from current_date);
begin
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
  if v_email is null then raise exception 'Indica el correo electrónico del cliente.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El correo del cliente no es válido.'; end if;
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
  if v_ticket not in ('true', 'false') then
    raise exception 'Indica si el cliente entrega el ticket de compra.';
  end if;
  if coalesce((d->>'gdpr_consent')::boolean, false) is not true then
    raise exception 'Falta el consentimiento del cliente para el tratamiento de sus datos (RGPD).';
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
    v_compra, v_incid, v_ticket = 'true', true, now())
  returning id into v_id;

  insert into public.incident_photos (incident_id, storage_path, mime_type, size_bytes, uploaded_by)
  select v_id, o.name, o.metadata->>'mimetype', (o.metadata->>'size')::int, auth.uid()
  from storage.objects o where o.bucket_id = 'incidencias' and o.name = any(v_fotos);

  insert into public.incident_events (incident_id, user_id, event_type) values (v_id, auth.uid(), 'CREADO');
  return jsonb_build_object('id', v_id, 'number', v_num);
end $$;

-- ----------------------------------------------------------------------------
-- 5. Estadísticas con filtro de cliente (nombre, correo o teléfono)
-- ----------------------------------------------------------------------------
drop function if exists public.estadisticas(date, date, int, boolean);
create or replace function public.estadisticas(p_desde date, p_hasta date, p_tienda int, p_historicas boolean, p_cliente text default null)
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
      and (coalesce(trim(p_cliente), '') = ''
           or i.customer_full_name ilike '%' || trim(p_cliente) || '%'
           or i.customer_email ilike '%' || trim(p_cliente) || '%'
           or (regexp_replace(p_cliente, '\D', '', 'g') <> ''
               and regexp_replace(coalesce(i.customer_phone, ''), '\D', '', 'g')
                   like '%' || regexp_replace(p_cliente, '\D', '', 'g') || '%'))
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

revoke execute on function public.estadisticas(date, date, int, boolean, text), public.borrar_tienda(int),
  public.crear_incidencia(jsonb) from public, anon;
grant execute on function public.estadisticas(date, date, int, boolean, text), public.borrar_tienda(int),
  public.crear_incidencia(jsonb) to authenticated;
