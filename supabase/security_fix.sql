-- ============================================================================
-- security_fix.sql: auditoría de seguridad (es la misma migración 20261120000007_seguridad.sql)
--
--  1. Se elimina la copia recuperable de contraseñas. Las contraseñas no deben
--     poder leerse nunca, ni cifradas: quien accediera a la cuenta del
--     administrador o a la base de datos se llevaría todas, y suelen reutilizarse
--     en el correo y otras cuentas. El administrador sigue pudiendo RESTABLECER
--     una contraseña (genera una temporal que se muestra una sola vez).
--  2. Blindaje general: RLS en todas las tablas, ninguna política para usuarios
--     sin sesión, anon sin permisos (también sobre lo que se cree después),
--     funciones sin el permiso implícito de PUBLIC, search_path fijo y ningún
--     espacio de archivos público. No cambia lo que puede hacer cada rol.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fuera la copia recuperable de contraseñas
-- ----------------------------------------------------------------------------
drop function if exists public.ver_passwords();

-- Se mantiene vacía (no guarda nada) para que una versión antigua de la función
-- «usuarios» que aún la llame no falle durante la actualización.
create or replace function public.guardar_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Intencionadamente vacía: las contraseñas ya no se guardan en ningún sitio.
  return;
end $$;
revoke execute on function public.guardar_password(uuid, text) from public, anon, authenticated;
grant execute on function public.guardar_password(uuid, text) to service_role;

drop table if exists privado.contrasenas;
drop table if exists privado.clave;
do $privado$
begin
  if exists (select 1 from pg_namespace where nspname = 'privado')
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'privado') then
    drop schema privado;
  end if;
end;
$privado$;

-- ---------------------------------------------------------------------
-- A. Row Level Security activada en TODAS las tablas del esquema public
--    (sin políticas, una tabla con RLS no es accesible desde la API)
-- ---------------------------------------------------------------------
do $rls$
declare t record;
begin
  for t in
    select c.oid::regclass as tabla
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    execute format('alter table %s enable row level security', t.tabla);
    raise notice 'RLS activada en %', t.tabla;
  end loop;
end;
$rls$;

-- ---------------------------------------------------------------------
-- B. Ninguna política para usuarios sin sesión: se eliminan las que se
--    apliquen a «anon» o a «public» (todos los roles), en datos y archivos
-- ---------------------------------------------------------------------
do $politicas$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public', 'storage') and roles && array['anon', 'public']::name[]
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    raise notice 'Política abierta eliminada: % en %.%', p.policyname, p.schemaname, p.tablename;
  end loop;
end;
$politicas$;

-- ---------------------------------------------------------------------
-- C. Sin sesión no se puede leer ni escribir nada: anon pierde todo permiso
--    sobre tablas, vistas y secuencias, también sobre las que se creen después
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------
-- D. Funciones: se retira el permiso implícito de PUBLIC y el de anon.
--    Quien ya podía usarlas con sesión (authenticated) o el servidor
--    (service_role) lo conserva, para no romper ninguna pantalla.
-- ---------------------------------------------------------------------
do $funciones$
declare
  f record;
  v_auth boolean;
  v_srv boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    v_auth := has_function_privilege('authenticated', f.oid, 'execute');
    v_srv  := has_function_privilege('service_role', f.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', f.firma);
    if v_auth then execute format('grant execute on function %s to authenticated', f.firma); end if;
    if v_srv  then execute format('grant execute on function %s to service_role', f.firma); end if;
  end loop;
end;
$funciones$;
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------
-- E. Ruta de búsqueda fija en las funciones que no la tenían
--    (evita que se pueda suplantar una tabla o función con otra del mismo nombre)
-- ---------------------------------------------------------------------
do $ruta$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, extensions', f.firma);
  end loop;
end;
$ruta$;

-- ---------------------------------------------------------------------
-- F. Archivos: ningún espacio de almacenamiento público
--    (las fotos solo se ven con sesión, a través de enlaces firmados)
-- ---------------------------------------------------------------------
update storage.buckets set public = false where public;

-- ---------------------------------------------------------------------
-- Comprobación final: todo debe dar 0 (o solo las excepciones documentadas)
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity)            as tablas_sin_rls,
  (select count(*) from pg_policies
    where schemaname in ('public', 'storage') and roles && array['anon', 'public']::name[])      as politicas_para_anonimos,
  (select count(distinct table_name) from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public')                                          as tablas_accesibles_sin_sesion,
  (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))      as funciones_sin_sesion,
  (select count(*) from storage.buckets where public)                                            as archivos_publicos;
