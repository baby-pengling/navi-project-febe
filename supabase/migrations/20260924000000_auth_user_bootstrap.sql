-- Make email/password onboarding valid before Google is connected.
-- The original schema required Google identity columns even though users can
-- create an email/password account first.

alter table public.users
  alter column google_email drop not null,
  alter column google_subject drop not null;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.auth_status (user_id, status, mail_connected, calendar_connected)
  values (new.id, 'disconnected', false, false)
  on conflict (user_id) do nothing;

  insert into public.notification_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();
