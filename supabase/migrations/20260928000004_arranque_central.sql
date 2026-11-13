-- Migración 4: arranque del primer usuario de central
-- Cuando se crea en Supabase Auth el usuario central@tiendas.local y todavía no
-- existe ninguna central, se le asigna automáticamente el perfil de central.
-- Una vez existe una central, este trigger no hace nada: las demás altas pasan
-- por la función "usuarios".
create or replace function public.tg_arranque_central() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = 'central@tiendas.local'
     and not exists (select 1 from public.profiles where role = 'MASTER') then
    insert into public.profiles (id, username, role, store_id, must_change_password)
    values (new.id, 'central', 'MASTER', null, false);
  end if;
  return new;
end $$;

drop trigger if exists arranque_central on auth.users;
create trigger arranque_central after insert on auth.users
  for each row execute function public.tg_arranque_central();

revoke execute on function public.tg_arranque_central() from anon, authenticated;
