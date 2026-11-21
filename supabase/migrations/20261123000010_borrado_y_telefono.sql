-- ============================================================================
-- Migración 10: borrado de incidencias por el administrador y teléfono obligatorio
--  · El administrador puede borrar una incidencia indicando el motivo. Es un
--    borrado "blando": se marca como borrada, sale del listado y de las
--    estadísticas, y la central la sigue viendo aparte. Se puede restaurar.
--    Las tiendas dejan de verla.
--  · En los tickets nuevos el teléfono pasa a ser obligatorio y el correo opcional.
--  · El cliente se identifica en las estadísticas primero por su teléfono y, si
--    no tiene, por su correo (antes era al revés).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Datos del borrado
-- ----------------------------------------------------------------------------
alter table public.incidents add column if not exists deleted_at timestamptz;
alter table public.incidents add column if not exists deleted_by uuid references public.profiles(id);
alter table public.incidents add column if not exists delete_reason text;
create index if not exists incidents_borradas on public.incidents (deleted_at) where deleted_at is not null;

-- La central ve todo (también lo borrado, para mostrarlo aparte); cada tienda,
-- solo lo suyo que no esté borrado.
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents for select to authenticated
  using (public.is_central() or (store_id = public.current_store_id() and deleted_at is null));
drop policy if exists photos_select on public.incident_photos;
create policy photos_select on public.incident_photos for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_central() or (i.store_id = public.current_store_id() and i.deleted_at is null))));
drop policy if exists events_select on public.incident_events;
create policy events_select on public.incident_events for select to authenticated
  using (exists (select 1 from public.incidents i where i.id = incident_id
                 and (public.is_central() or (i.store_id = public.current_store_id() and i.deleted_at is null))));

create or replace function public.borrar_incidencia(p_id int, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede borrar incidencias.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indica el motivo del borrado.'; end if;
  update public.incidents set deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_motivo)
  where id = p_id and deleted_at is null;
  if not found then raise exception 'No existe la incidencia o ya está borrada.'; end if;
  insert into public.incident_events (incident_id, user_id, event_type, message)
  values (p_id, auth.uid(), 'BORRADO', trim(p_motivo));
end $$;

create or replace function public.restaurar_incidencia(p_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador puede restaurar incidencias.'; end if;
  update public.incidents set deleted_at = null, deleted_by = null, delete_reason = null
  where id = p_id and deleted_at is not null;
  if not found then raise exception 'No existe la incidencia o no está borrada.'; end if;
  insert into public.incident_events (incident_id, user_id, event_type) values (p_id, auth.uid(), 'RESTAURADO');
end $$;

-- Una incidencia borrada no se puede cambiar de estado ni resolver.
create or replace function public.cambiar_estado_incidencia(p_id int, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status; v_borrada timestamptz;
begin
  if not public.is_central() then raise exception 'Solo la central puede cambiar el estado.'; end if;
  select status, deleted_at into v_actual, v_borrada from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
  if v_borrada is not null then raise exception 'La incidencia está borrada. Restáurala para poder gestionarla.'; end if;
  if v_actual = 'RESUELTO' then raise exception 'La incidencia ya está resuelta.'; end if;
  if p_estado not in ('ABIERTO', 'EN_REVISION') then raise exception 'Estado no válido.'; end if;
  if v_actual::text = p_estado then return; end if;
  update public.incidents set status = p_estado::public.incident_status where id = p_id;
  insert into public.incident_events (incident_id, user_id, event_type)
  values (p_id, auth.uid(), case p_estado when 'EN_REVISION' then 'EN_REVISION' else 'REABIERTO' end);
end $$;

create or replace function public.resolver_incidencia(p_id int, p_resultado text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status; v_borrada timestamptz;
begin
  if not public.is_central() then raise exception 'Solo la central puede resolver incidencias.'; end if;
  select status, deleted_at into v_actual, v_borrada from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
  if v_borrada is not null then raise exception 'La incidencia está borrada. Restáurala para poder gestionarla.'; end if;
  if v_actual = 'RESUELTO' then raise exception 'La incidencia ya está resuelta.'; end if;
  if p_resultado not in ('CAMBIO', 'NO_CUBRE', 'REPARACION', 'COMPENSACION', 'VALE_TIENDA', 'REEMBOLSO') then
    raise exception 'Elige el resultado: cambio, no cubre, reparación, compensación, vale tienda o reembolso.';
  end if;
  if length(trim(coalesce(p_texto, ''))) < 5 then raise exception 'Escribe la respuesta para la tienda.'; end if;
  update public.incidents set status = 'RESUELTO', resolution_type = p_resultado::public.resolution_type,
    resolution_text = trim(p_texto), resolved_by = auth.uid(), resolved_at = now()
  where id = p_id;
  insert into public.incident_events (incident_id, user_id, event_type, message)
  values (p_id, auth.uid(), 'RESUELTO', p_resultado);
end $$;

-- ----------------------------------------------------------------------------
-- 2. Teléfono obligatorio y correo opcional en los tickets nuevos
-- ----------------------------------------------------------------------------
-- La comprobación de contacto pasa a la función de alta (la única vía para crear
-- tickets); la tabla sigue exigiendo al menos un dato de contacto.
alter table public.incidents drop constraint if exists incidents_ticket_completo;
alter table public.incidents add constraint incidents_ticket_completo check (
  is_historical or (gdpr_consent and purchase_date is not null and defect_type_id is not null
                    and created_by is not null));

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
  if v_phone is null then raise exception 'Indica el teléfono del cliente.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 9 then
    raise exception 'El teléfono del cliente debe tener al menos 9 dígitos.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El correo del cliente no es válido.'; end if;

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

-- Identificador del cliente: teléfono primero y, si no hay, correo.
alter table public.incidents drop constraint if exists incidents_contacto_cliente;
alter table public.incidents drop column customer_key;
alter table public.incidents add column customer_key varchar(255) generated always as (
  coalesce(nullif(regexp_replace(coalesce(customer_phone, ''), '\D', '', 'g'), ''),
           nullif(lower(trim(customer_email)), ''))) stored;
create index if not exists incidents_customer_key_idx on public.incidents (customer_key);
alter table public.incidents add constraint incidents_contacto_cliente
  check (is_historical or customer_key is not null);

-- ----------------------------------------------------------------------------
-- 3. Las estadísticas no cuentan lo borrado
-- ----------------------------------------------------------------------------
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
      and i.deleted_at is null
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
        from base group by coalesce(customer_key, 'nombre:' || lower(trim(customer_full_name)))) x), '[]'),
    'resultados', coalesce((select jsonb_object_agg(coalesce(resolution_type::text, 'PENDIENTE'), n) from (
        select resolution_type, count(*) n from base group by resolution_type) x), '{}'),
    'defectos', coalesce((select jsonb_object_agg(coalesce(defect_name, 'Sin tipo'), n) from (
        select defect_name, count(*) n from base group by defect_name) x), '{}')
  )
$$;

revoke execute on function public.borrar_incidencia(int, text), public.restaurar_incidencia(int) from public, anon;
grant execute on function public.borrar_incidencia(int, text), public.restaurar_incidencia(int) to authenticated;
