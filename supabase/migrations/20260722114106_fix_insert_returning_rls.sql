-- PostgREST requests a representation after creating these records. During
-- INSERT ... RETURNING, a SELECT policy that only re-queries the row being
-- inserted cannot see that row yet. Keep the existing relationship checks for
-- members, while authorizing the creator directly from the candidate row.

drop policy if exists groups_select_members on public.groups;
create policy groups_select_members
on public.groups
for select
to authenticated
using (
  (select auth.uid()) = owner_id
  or private.is_group_member(id)
);

drop policy if exists expenses_select_authorized on public.expenses;
create policy expenses_select_authorized
on public.expenses
for select
to authenticated
using (
  (select auth.uid()) = created_by
  or private.can_read_expense(id)
);
