create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'LAK',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_key text not null check (role_key in ('owner', 'accountant', 'viewer', 'sales', 'purchase')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.app_states (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  state jsonb not null,
  revision text not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  risk text not null default 'medium',
  target_type text not null,
  target_id text,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists organization_members_user_idx on public.organization_members (user_id);
create index if not exists audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.app_states enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_organization_id
      and om.user_id = (select auth.uid())
  );
$$;

create or replace function public.current_org_role(target_organization_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select om.role_key
  from public.organization_members om
  where om.organization_id = target_organization_id
    and om.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.can_write_org(target_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_org_role(target_organization_id) in ('owner', 'accountant', 'sales', 'purchase'), false);
$$;

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (public.is_org_member(id));

drop policy if exists "profiles_select_self_or_org_member" on public.profiles;
create policy "profiles_select_self_or_org_member"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = profiles.id
  )
);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "members_select_member" on public.organization_members;
create policy "members_select_member"
on public.organization_members
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "app_states_select_member" on public.app_states;
create policy "app_states_select_member"
on public.app_states
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "app_states_insert_writer" on public.app_states;
create policy "app_states_insert_writer"
on public.app_states
for insert
to authenticated
with check (public.can_write_org(organization_id));

drop policy if exists "app_states_update_writer" on public.app_states;
create policy "app_states_update_writer"
on public.app_states
for update
to authenticated
using (public.can_write_org(organization_id))
with check (public.can_write_org(organization_id));

drop policy if exists "audit_logs_select_member" on public.audit_logs;
create policy "audit_logs_select_member"
on public.audit_logs
for select
to authenticated
using (public.is_org_member(organization_id));

drop policy if exists "audit_logs_insert_member" on public.audit_logs;
create policy "audit_logs_insert_member"
on public.audit_logs
for insert
to authenticated
with check (public.is_org_member(organization_id) and actor_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  5000000,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments_select_member" on storage.objects;
create policy "attachments_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attachments'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "attachments_insert_writer" on storage.objects;
create policy "attachments_insert_writer"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'attachments'
  and public.can_write_org(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "attachments_update_writer" on storage.objects;
create policy "attachments_update_writer"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'attachments'
  and public.can_write_org(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'attachments'
  and public.can_write_org(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "attachments_delete_writer" on storage.objects;
create policy "attachments_delete_writer"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'attachments'
  and public.can_write_org(((storage.foldername(name))[1])::uuid)
);
