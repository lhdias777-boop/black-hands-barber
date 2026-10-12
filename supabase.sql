-- BLACK HANDS BARBER SHOP - BANCO V2
-- Execute este arquivo no SQL Editor do Supabase.
-- Depois crie os usuários de barbeiros/admin pelo Authentication > Users.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role text not null default 'client' check (role in ('client','barber','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  price numeric(10,2) not null default 0 check (price >= 0),
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete restrict,
  barber_id uuid not null references public.barbers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'confirmed' check (status in ('pending','confirmed','completed','cancelled','no_show')),
  payment_method text not null default 'shop' check (payment_method in ('online','shop')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Impede duas reservas para o mesmo barbeiro, data e horário.
create unique index if not exists appointments_barber_date_time_unique
on public.appointments(barber_id, appointment_date, appointment_time)
where status <> 'cancelled';

create index if not exists appointments_client_idx on public.appointments(client_id, appointment_date);
create index if not exists appointments_barber_idx on public.appointments(barber_id, appointment_date);

-- Trigger para criar o perfil automaticamente quando alguém cria conta.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1), 'Cliente'),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Função para checar papel sem depender de RLS recursivo.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;

-- Profiles
 drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
 drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
 drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Barbeiros: público autenticado pode listar ativos; admin controla tudo.
drop policy if exists barbers_public_read on public.barbers;
create policy barbers_public_read on public.barbers for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists barbers_admin_all on public.barbers;
create policy barbers_admin_all on public.barbers for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Serviços: público pode listar ativos.
drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists services_admin_all on public.services;
create policy services_admin_all on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Agendamentos
drop policy if exists appointments_client_select on public.appointments;
create policy appointments_client_select on public.appointments for select to authenticated
using (client_id = auth.uid() or public.is_admin() or exists(select 1 from public.barbers b where b.id = barber_id and b.user_id = auth.uid()));

drop policy if exists appointments_client_insert on public.appointments;
create policy appointments_client_insert on public.appointments for insert to authenticated
with check (client_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'client'));

drop policy if exists appointments_client_update on public.appointments;
create policy appointments_client_update on public.appointments for update to authenticated
using (client_id = auth.uid() or public.is_admin() or exists(select 1 from public.barbers b where b.id = barber_id and b.user_id = auth.uid()))
with check (client_id = auth.uid() or public.is_admin() or exists(select 1 from public.barbers b where b.id = barber_id and b.user_id = auth.uid()));

drop policy if exists appointments_admin_delete on public.appointments;
create policy appointments_admin_delete on public.appointments for delete to authenticated using (public.is_admin());

-- Dados iniciais dos serviços.
insert into public.services (name, description, price, duration_minutes)
values
('Cabelo','Corte e acabamento.',35,30),
('Barba','Barba com acabamento.',30,30),
('Pintura','Procedimento de pintura.',15,30),
('Relaxamento','Tratamento para o cabelo.',15,30),
('Pigmentação','Realce e acabamento.',15,30),
('Pezinho','Acabamento preciso.',10,15),
('Sobrancelha','Acabamento da sobrancelha.',10,15)
on conflict (name) do update set description=excluded.description, price=excluded.price, duration_minutes=excluded.duration_minutes;

-- Barbeiro disponível para agendamento.
insert into public.barbers (name, active)
select 'WELIGOL', true
where not exists (select 1 from public.barbers where upper(trim(name)) = 'WELIGOL');

-- Exemplo para criar barbeiros depois de criar os usuários:
-- insert into public.barbers (user_id, name) values ('UUID_DO_USUARIO', 'Nome do Barbeiro');

-- Para transformar sua conta em ADMIN, primeiro crie a conta normalmente e depois:
-- update public.profiles set role = 'admin' where id = 'UUID_DA_SUA_CONTA';
