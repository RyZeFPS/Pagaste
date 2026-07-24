-- Active group members must be able to see the complete member list for the
-- groups they belong to. The previous policy exposed every row to the owner,
-- but only the caller's own row to regular members.

create or replace function private.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.groups g
        where g.id = p_group_id
          and g.owner_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.group_members gm
        where gm.group_id = p_group_id
          and gm.user_id = (select auth.uid())
          and gm.status = 'active'
      )
    );
$$;

revoke all on function private.is_group_member(uuid)
from public, anon, authenticated;

grant execute on function private.is_group_member(uuid)
to authenticated;

drop policy if exists group_members_select_owner_or_self
on public.group_members;

drop policy if exists group_members_select_group_members
on public.group_members;

create policy group_members_select_group_members
on public.group_members
for select
to authenticated
using (private.is_group_member(group_id));
