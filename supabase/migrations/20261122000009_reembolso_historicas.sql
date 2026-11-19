-- ============================================================================
-- Migración 9: resultado "Reembolso" e incidencias antiguas sin contacto
--  · Nuevo resultado REEMBOLSO al resolver y al importar.
--  · Al importar incidencias antiguas, el correo y el teléfono son opcionales.
--    Los tickets nuevos siguen exigiendo el correo (crear_incidencia y la
--    restricción incidents_ticket_completo no cambian).
--  · En las estadísticas, un cliente sin correo ni teléfono se agrupa por nombre.
-- ============================================================================

alter type public.resolution_type add value if not exists 'REEMBOLSO';

-- El contacto solo es obligatorio en los tickets nuevos, no en los importados.
alter table public.incidents drop constraint if exists incidents_customer_key_check;
alter table public.incidents drop constraint if exists incidents_contacto_cliente;
alter table public.incidents add constraint incidents_contacto_cliente
  check (is_historical or customer_key is not null);

create or replace function public.resolver_incidencia(p_id int, p_resultado text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status;
begin
  if not public.is_central() then raise exception 'Solo la central puede resolver incidencias.'; end if;
  select status into v_actual from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
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
               when 'REPARACION' then 'REPARACION' when 'COMPENSACION' then 'COMPENSACION'
               when 'VALE TIENDA' then 'VALE_TIENDA' when 'VALE_TIENDA' then 'VALE_TIENDA' when 'VALE' then 'VALE_TIENDA'
               when 'REEMBOLSO' then 'REEMBOLSO' else '?' end;
    select id into v_def from public.defect_types where lower(name) = lower(trim(coalesce(f->>'tipo_defecto', '')));

    if v_err is not null then null;
    elsif v_store is null then v_err := 'Tienda no encontrada: ' || coalesce(f->>'tienda', '(vacía)');
    elsif v_incid is null then v_err := 'Falta la fecha de la incidencia.';
    elsif v_sku = '' then v_err := 'Falta la referencia (SKU).';
    elsif length(trim(coalesce(f->>'cliente', ''))) = 0 then v_err := 'Falta el nombre del cliente.';
    elsif v_res = '?' then v_err := 'Resultado no válido: ' || (f->>'resultado') || ' (cambio, no cubre, reparación, compensación, vale tienda o reembolso).';
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
        from base group by coalesce(customer_key, 'nombre:' || lower(trim(customer_full_name)))) x), '[]'),
    'resultados', coalesce((select jsonb_object_agg(coalesce(resolution_type::text, 'PENDIENTE'), n) from (
        select resolution_type, count(*) n from base group by resolution_type) x), '{}'),
    'defectos', coalesce((select jsonb_object_agg(coalesce(defect_name, 'Sin tipo'), n) from (
        select defect_name, count(*) n from base group by defect_name) x), '{}')
  )
$$;
