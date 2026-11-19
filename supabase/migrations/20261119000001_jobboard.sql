-- Lab job board for the cloud-native recovery sprint. Synthetic data only.
-- Uses each thing that is hard to recover: row-level security, a trigger,
-- database functions, an extension, a scheduled job, a private bucket and Realtime.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Staff profiles. Office staff see every job; technicians see their own.
create type public.staff_role as enum ('technician', 'office');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role public.staff_role not null default 'technician'
);

create or replace function public.is_office()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'office'
  );
$$;
revoke execute on function public.is_office() from public, anon;
grant execute on function public.is_office() to authenticated;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  town text not null,
  created_at timestamptz not null default now()
);
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);

create type public.job_status as enum ('open', 'in_progress', 'done');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  title text not null,
  status public.job_status not null default 'open',
  assigned_to uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_assigned_to_idx on public.jobs (assigned_to, created_at desc);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  amount_pence integer not null check (amount_pence >= 0),
  vat_rate numeric(4, 3) not null default 0.200,
  created_at timestamptz not null default now()
);
create index quotes_job_id_idx on public.quotes (job_id);

-- Written every minute by pg_cron, so a restore's data loss can be measured to the minute.
create table public.heartbeat (
  id bigint generated always as identity primary key,
  written_at timestamptz not null default now()
);

-- Trigger: keep jobs.updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Function the app calls: counts of the caller's visible jobs by status. Runs with the caller's rights.
create or replace function public.job_summary()
returns table (status public.job_status, job_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select j.status, count(*) from public.jobs j group by j.status order by j.status;
$$;
revoke execute on function public.job_summary() from public, anon;
grant execute on function public.job_summary() to authenticated;

-- Privileges: nothing for anonymous visitors; signed-in staff through row-level security only.
revoke all on public.profiles, public.customers, public.jobs, public.quotes, public.heartbeat from anon;
grant select on public.profiles, public.customers, public.heartbeat to authenticated;
grant select, insert, update on public.jobs, public.quotes to authenticated;
grant insert, update on public.customers to authenticated;
grant all on public.profiles, public.customers, public.jobs, public.quotes, public.heartbeat to service_role;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.quotes enable row level security;
alter table public.heartbeat enable row level security;

create policy "Own profile, or office sees all" on public.profiles
  for select to authenticated using (user_id = auth.uid() or public.is_office());

create policy "Signed-in staff read customers" on public.customers
  for select to authenticated using (true);
create policy "Office adds customers" on public.customers
  for insert to authenticated with check (public.is_office());
create policy "Office edits customers" on public.customers
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy "Own jobs, or office sees all" on public.jobs
  for select to authenticated using (assigned_to = auth.uid() or public.is_office());
create policy "Office creates jobs" on public.jobs
  for insert to authenticated with check (public.is_office());
create policy "Assignee or office updates jobs" on public.jobs
  for update to authenticated
  using (assigned_to = auth.uid() or public.is_office())
  with check (assigned_to = auth.uid() or public.is_office());

create policy "Quotes of visible jobs" on public.quotes
  for select to authenticated using (exists (select 1 from public.jobs j where j.id = job_id));
create policy "Office creates quotes" on public.quotes
  for insert to authenticated with check (public.is_office());
create policy "Office edits quotes" on public.quotes
  for update to authenticated using (public.is_office()) with check (public.is_office());

create policy "Signed-in staff read heartbeat" on public.heartbeat
  for select to authenticated using (true);

-- Private bucket for job files; the first folder of each path is the job id.
insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', false)
on conflict (id) do nothing;

create policy "Read files of visible jobs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-files'
    and exists (select 1 from public.jobs j where j.id::text = (storage.foldername(name))[1])
  );
create policy "Upload files to visible jobs" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-files'
    and exists (select 1 from public.jobs j where j.id::text = (storage.foldername(name))[1])
  );

-- Realtime: the app listens for job changes.
alter publication supabase_realtime add table public.jobs;

-- Scheduled job: the heartbeat.
select cron.schedule('heartbeat', '* * * * *', $$insert into public.heartbeat default values$$);
