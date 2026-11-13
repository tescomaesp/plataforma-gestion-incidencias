-- Migración 2: tiendas y trabajadoras iniciales
-- Nombres provisionales, editables desde el panel de la central.
-- Los usuarios se crean aparte con scripts/crear-usuarios.mjs, porque
-- necesitan Supabase Auth (contraseñas) y no se pueden crear desde SQL.

insert into public.stores (code, name)
select 'T' || lpad(n::text, 2, '0'), 'Tienda ' || lpad(n::text, 2, '0')
from generate_series(1, 9) n
on conflict (code) do nothing;

insert into public.store_workers (store_id, full_name)
select s.id, 'Trabajadora ' || w || ' – ' || s.code
from public.stores s cross join generate_series(1, 2) w
where not exists (select 1 from public.store_workers sw where sw.store_id = s.id)
order by s.id, w;
