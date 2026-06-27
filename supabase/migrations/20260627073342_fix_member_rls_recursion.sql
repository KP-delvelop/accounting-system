drop policy if exists "members_select_member" on public.organization_members;
create policy "members_select_self"
on public.organization_members
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "profiles_select_self_or_org_member" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));
