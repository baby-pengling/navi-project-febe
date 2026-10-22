-- Google credentials in Vault, the calendar event cache, and set_event_category.
-- Contract: Notion "DB Schema" (2026-09-26) and "API 명세" rows google-auth/credentials,
-- calendar/events, and set_event_category.

-- ---------------------------------------------------------------------------
-- Google refresh tokens (Vault; Edge Functions only)
-- ---------------------------------------------------------------------------
-- One secret per user, named google_refresh_token:<user_id>. Only service_role (the Edge
-- Functions) can call these; the app never sees the token after handing it over.

create or replace function public.store_google_refresh_token(target_user uuid, token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_name text := 'google_refresh_token:' || target_user;
  existing uuid;
begin
  if token is null or btrim(token) = '' then
    raise exception 'token is required' using errcode = '22023';
  end if;

  select s.id into existing from vault.secrets s where s.name = secret_name;
  if existing is null then
    perform vault.create_secret(token, secret_name, 'Google OAuth refresh token');
  else
    perform vault.update_secret(existing, token);
  end if;
end;
$$;

create or replace function public.get_google_refresh_token(target_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'google_refresh_token:' || target_user;
$$;

create or replace function public.delete_google_refresh_token(target_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = 'google_refresh_token:' || target_user;
$$;

revoke all on function public.store_google_refresh_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_google_refresh_token(uuid) from public, anon, authenticated;
revoke all on function public.delete_google_refresh_token(uuid) from public, anon, authenticated;
grant execute on function public.store_google_refresh_token(uuid, text) to service_role;
grant execute on function public.get_google_refresh_token(uuid) to service_role;
grant execute on function public.delete_google_refresh_token(uuid) to service_role;

-- The account row and connection status are written by google-auth, not the app.
revoke insert, update, delete on public.users from authenticated;
revoke insert, update, delete on public.auth_status from authenticated;

-- ---------------------------------------------------------------------------
-- Private Google caches: the app only sees what the Edge Functions return.
-- ---------------------------------------------------------------------------

revoke all on public.mail_messages_cache from authenticated;
drop policy if exists mail_messages_cache_user_access on public.mail_messages_cache;

create table public.calendar_events_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text not null,
  payload jsonb not null,
  category_id uuid,
  cached_at timestamptz not null default now(),
  constraint calendar_events_cache_unique_google_event unique (user_id, google_calendar_id, google_event_id),
  constraint calendar_events_cache_user_id_id_unique unique (user_id, id),
  constraint calendar_events_cache_category_same_user_fk
    foreign key (user_id, category_id)
    references public.calendar_categories (user_id, id)
    on delete set null (category_id)
);

create index calendar_events_cache_user_start_idx
  on public.calendar_events_cache (user_id, ((payload ->> 'start_at')));

alter table public.calendar_events_cache enable row level security;
revoke all on public.calendar_events_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- set_event_category(event_id, category_id): category is Navi-only; Google is untouched.
-- ---------------------------------------------------------------------------

create or replace function public.set_event_category(event_id uuid, category_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if set_event_category.category_id is not null and not exists (
    select 1 from public.calendar_categories c
    where c.user_id = caller and c.id = set_event_category.category_id
  ) then
    raise exception 'category not found' using errcode = 'PT404';
  end if;

  update public.calendar_events_cache e
  set category_id = set_event_category.category_id
  where e.user_id = caller and e.id = set_event_category.event_id;

  if not found then
    raise exception 'event not found' using errcode = 'PT404';
  end if;
end;
$$;

revoke all on function public.set_event_category(uuid, uuid) from public, anon;
grant execute on function public.set_event_category(uuid, uuid) to authenticated;
