-- Profile photos are private objects. Only the owner and people who share a
-- group or expense with that owner can mint a short-lived download URL.

alter table public.profiles
  add constraint profiles_avatar_path_shape check (
    avatar_path is null
    or avatar_path ~* (
      '^' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    )
  );

create function private.profile_avatar_object_owned(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    and split_part(p_name, '/', 1) = (select auth.uid())::text;
$$;

create function private.profile_avatar_object_visible(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
begin
  if v_actor is null or p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$' then
    return false;
  end if;

  v_owner := split_part(p_name, '/', 1)::uuid;
  if v_owner = v_actor then return true; end if;

  return exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = v_actor
      and mine.status = 'active'
      and theirs.user_id = v_owner
      and theirs.status = 'active'
  ) or exists (
    select 1
    from public.expenses e
    join public.expense_participants theirs on theirs.expense_id = e.id
    where e.created_by = v_actor
      and theirs.user_id = v_owner
  ) or exists (
    select 1
    from public.expenses e
    join public.expense_participants mine on mine.expense_id = e.id
    where mine.user_id = v_actor
      and e.created_by = v_owner
  ) or exists (
    select 1
    from public.expense_participants mine
    join public.expense_participants theirs on theirs.expense_id = mine.expense_id
    where mine.user_id = v_actor
      and theirs.user_id = v_owner
  );
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy profile_avatars_select_related
on storage.objects
for select
to authenticated
using (
  bucket_id = 'profile-avatars'
  and private.profile_avatar_object_visible(name)
);

create policy profile_avatars_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and private.profile_avatar_object_owned(name)
);

create policy profile_avatars_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and private.profile_avatar_object_owned(name)
);

create function private.sync_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_members set
    display_name = new.display_name,
    avatar_path = new.avatar_path
  where user_id = new.id
    and (display_name, avatar_path) is distinct from (new.display_name, new.avatar_path);

  update public.expense_participants set
    display_name = new.display_name,
    avatar_path = new.avatar_path
  where user_id = new.id
    and (display_name, avatar_path) is distinct from (new.display_name, new.avatar_path);

  return new;
end;
$$;

create trigger profiles_sync_linked_identity
after update of display_name, avatar_path on public.profiles
for each row
when (
  old.display_name is distinct from new.display_name
  or old.avatar_path is distinct from new.avatar_path
)
execute function private.sync_profile_identity();

create function private.hydrate_linked_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if new.user_id is null then return new; end if;
  select * into v_profile from public.profiles where id = new.user_id;
  if found then
    new.display_name := v_profile.display_name;
    new.avatar_path := v_profile.avatar_path;
    new.email := v_profile.email;
  end if;
  return new;
end;
$$;

create trigger group_members_hydrate_linked_identity
before insert or update of user_id on public.group_members
for each row execute function private.hydrate_linked_identity();

create trigger expense_participants_hydrate_linked_identity
before insert or update of user_id on public.expense_participants
for each row execute function private.hydrate_linked_identity();

update public.group_members member set
  display_name = profile.display_name,
  avatar_path = profile.avatar_path
from public.profiles profile
where member.user_id = profile.id
  and (member.display_name, member.avatar_path)
      is distinct from (profile.display_name, profile.avatar_path);

update public.expense_participants participant set
  display_name = profile.display_name,
  avatar_path = profile.avatar_path
from public.profiles profile
where participant.user_id = profile.id
  and (participant.display_name, participant.avatar_path)
      is distinct from (profile.display_name, profile.avatar_path);

revoke all on function private.profile_avatar_object_owned(text),
  private.profile_avatar_object_visible(text),
  private.sync_profile_identity(),
  private.hydrate_linked_identity()
from public, anon, authenticated;

grant execute on function private.profile_avatar_object_owned(text),
  private.profile_avatar_object_visible(text)
to authenticated;
