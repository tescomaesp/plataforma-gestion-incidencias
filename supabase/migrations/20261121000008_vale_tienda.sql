-- ============================================================================
-- Migración 8: nuevo resultado de incidencia "Vale tienda"
-- Se añade al tipo de resolución y se acepta al resolver un ticket y al importar
-- incidencias antiguas (escrito como "Vale tienda", "VALE_TIENDA" o "Vale").
-- Las funciones se reemplazan conservando sus permisos.
-- ============================================================================

alter type public.resolution_type add value if not exists 'VALE_TIENDA';

create or replace function public.resolver_incidencia(p_id int, p_resultado text, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actual public.incident_status;
begin
  if not public.is_central() then raise exception 'Solo la central puede resolver incidencias.'; end if;
  select status into v_actual from public.incidents where id = p_id for update;
  if v_actual is null then raise exception 'No existe la incidencia.'; end if;
  if v_actual = 'RESUELTO' then raise exception 'La incidencia ya está resuelta.'; end if;
  if p_resultado not in ('CAMBIO', 'NO_CUBRE', 'REPARACION', 'COMPENSACION', 'VALE_TIENDA') then
    raise exception 'Elige el resultado: cambio, no cubre, reparación, compensación o vale tienda.';
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
               when 'VALE TIENDA' then 'VALE_TIENDA' when 'VALE_TIENDA' then 'VALE_TIENDA' when 'VALE' then 'VALE_TIENDA' else '?' end;
    select id into v_def from public.defect_types where lower(name) = lower(trim(coalesce(f->>'tipo_defecto', '')));

    if v_err is not null then null;
    elsif v_store is null then v_err := 'Tienda no encontrada: ' || coalesce(f->>'tienda', '(vacía)');
    elsif v_incid is null then v_err := 'Falta la fecha de la incidencia.';
    elsif v_sku = '' then v_err := 'Falta la referencia (SKU).';
    elsif length(trim(coalesce(f->>'cliente', ''))) = 0 then v_err := 'Falta el nombre del cliente.';
    elsif v_email is null and v_phone is null then v_err := 'Falta el correo o el teléfono del cliente.';
    elsif v_res = '?' then v_err := 'Resultado no válido: ' || (f->>'resultado') || ' (cambio, no cubre, reparación, compensación o vale tienda).';
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
