-- NAVI initial Supabase schema.
-- public.users is created/upserted by the Google connect flow after auth.users exists.
-- Google Calendar events remain external references; they are not stored as a table here.

create type public.auth_status_state as enum ('connected', 'needs_reauth', 'disconnected');
create type public.memory_key_type as enum ('role', 'interest_tag');
create type public.memory_source_type as enum ('onboarding', 'settings');
create type public.push_service_type as enum ('gmail', 'calendar');
create type public.push_subscription_status as enum ('active', 'expired', 'failed', 'disabled');
create type public.mail_draft_status as enum ('pending', 'sent', 'failed');
create type public.calendar_briefing_type as enum ('today', 'week');
create type public.calendar_range_kind as enum ('current', 'next');
create type public.calendar_command_source as enum ('natural_language', 'form');
create type public.calendar_command_status as enum ('pending', 'approved', 'executed', 'failed');
create type public.todo_status as enum ('active', 'done');
create type public.todo_source_type as enum ('manual', 'calendar_suggestion', 'mail_suggestion', 'subdivision');
create type public.assistant_alert_source as enum (
  'mail_important',
  'mail_send_confirmation',
  'mail_billing_ready',
  'calendar_reminder',
  'calendar_approval'
);
create type public.assistant_alert_target_type as enum (
  'mail_message',
  'mail_draft',
  'calendar_event',
  'calendar_command'
);
create type public.assistant_alert_status as enum ('unseen', 'seen', 'dismissed', 'snoozed');
create type public.assistant_command_status as enum (
  'received',
  'running',
  'awaiting_approval',
  'completed',
  'failed'
);
create type public.idempotency_status as enum ('processing', 'completed', 'failed');

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  google_email text not null unique,
  google_subject text not null unique,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table public.auth_status (
  user_id uuid primary key references public.users (id) on delete cascade,
  status public.auth_status_state not null,
  mail_connected boolean not null default false,
  calendar_connected boolean not null default false,
  last_refresh_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  disconnected_at timestamptz,
  constraint auth_status_connected_service_check check (
    status <> 'connected' or mail_connected or calendar_connected
  ),
  constraint auth_status_disconnected_service_check check (
    status <> 'disconnected' or (not mail_connected and not calendar_connected)
  )
);

create table public.notification_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  new_mail_enabled boolean not null default true,
  calendar_reminder_enabled boolean not null default true,
  mail_send_confirmation_enabled boolean not null default true,
  calendar_approval_enabled boolean not null default true,
  alert_snooze_minutes integer not null default 9,
  updated_at timestamptz not null default now(),
  constraint notification_settings_snooze_check check (alert_snooze_minutes > 0)
);

create table public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  key public.memory_key_type not null,
  value text not null,
  source public.memory_source_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_memory_unique_value unique (user_id, key, value)
);

create unique index user_memory_one_role_per_user
  on public.user_memory (user_id)
  where key = 'role';

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  service public.push_service_type not null,
  status public.push_subscription_status not null,
  topic_name text,
  channel_id text,
  resource_id text,
  expiration timestamptz,
  last_renewed_at timestamptz,
  last_error_code text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_unique_service unique (user_id, service),
  constraint push_subscriptions_active_expiration_check check (
    status <> 'active' or expiration is not null
  ),
  constraint push_subscriptions_disabled_retry_check check (
    status <> 'disabled' or next_retry_at is null
  )
);

create table public.mail_sync_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  last_history_id text,
  updated_at timestamptz not null default now()
);

create table public.mail_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  categorized_data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint mail_briefings_unique_date unique (user_id, date)
);

create table public.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  gmail_draft_id text not null,
  draft_payload jsonb,
  status public.mail_draft_status not null default 'pending',
  original_command text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  failed_at timestamptz,
  sent_at timestamptz,
  error_code text,
  constraint mail_drafts_unique_google_draft unique (user_id, gmail_draft_id),
  constraint mail_drafts_status_timestamps_check check (
    (status = 'pending' and sent_at is null and failed_at is null)
    or (status = 'sent' and sent_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and sent_at is null)
  )
);

create table public.mail_messages_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  gmail_message_id text not null,
  label_ids jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  cached_at timestamptz not null default now(),
  constraint mail_messages_cache_unique_google_message unique (user_id, gmail_message_id)
);

create table public.mail_billing_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  month text not null,
  summary_data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint mail_billing_summaries_unique_month unique (user_id, month),
  constraint mail_billing_summaries_month_format_check check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

create table public.calendar_sync_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  last_checked_at timestamptz,
  sync_token text
);

create table public.calendar_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  date date not null,
  type public.calendar_briefing_type not null,
  range_kind public.calendar_range_kind,
  range_start date not null,
  range_end date not null,
  summary_data jsonb not null,
  generated_at timestamptz not null default now(),
  constraint calendar_briefings_unique_range unique (user_id, type, range_start, range_end),
  constraint calendar_briefings_range_check check (range_start <= range_end),
  constraint calendar_briefings_range_kind_check check (
    (type = 'today' and range_kind is null)
    or (type = 'week' and range_kind is not null)
  )
);

create table public.calendar_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  original_command text,
  source public.calendar_command_source not null,
  parsed_action jsonb not null,
  status public.calendar_command_status not null default 'pending',
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  error_code text
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  status public.todo_status not null default 'active',
  parent_id uuid,
  date date not null,
  due_date date,
  linked_event_id text,
  source public.todo_source_type not null default 'manual',
  order_index double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_user_id_id_unique unique (user_id, id),
  constraint todos_parent_same_user_fk
    foreign key (user_id, parent_id)
    references public.todos (user_id, id)
    on delete cascade
);

create table public.assistant_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source public.assistant_alert_source not null,
  title text not null,
  body text not null,
  target_type public.assistant_alert_target_type not null,
  target_id text not null,
  status public.assistant_alert_status not null default 'unseen',
  seen_at timestamptz,
  dismissed_at timestamptz,
  snoozed_at timestamptz,
  snoozed_until timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint assistant_alerts_status_timestamps_check check (
    (status = 'unseen'
      and seen_at is null
      and dismissed_at is null
      and snoozed_at is null
      and snoozed_until is null)
    or (status = 'seen'
      and seen_at is not null
      and dismissed_at is null
      and snoozed_until is null)
    or (status = 'dismissed'
      and dismissed_at is not null
      and snoozed_until is null)
    or (status = 'snoozed'
      and snoozed_at is not null
      and snoozed_until is not null
      and dismissed_at is null)
  )
);

create unique index assistant_alerts_user_dedupe_key_unique
  on public.assistant_alerts (user_id, dedupe_key)
  where dedupe_key is not null;

create table public.assistant_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  raw_input text not null,
  status public.assistant_command_status not null default 'received',
  tool_calls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  error_code text
);

create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  request_hash text not null,
  status public.idempotency_status not null default 'processing',
  response_status integer,
  response_payload jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint api_idempotency_keys_unique_request unique (user_id, operation, idempotency_key)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notification_settings_set_updated_at
before update on public.notification_settings
for each row execute function public.set_updated_at();

create trigger user_memory_set_updated_at
before update on public.user_memory
for each row execute function public.set_updated_at();

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create trigger mail_sync_state_set_updated_at
before update on public.mail_sync_state
for each row execute function public.set_updated_at();

create trigger mail_drafts_set_updated_at
before update on public.mail_drafts
for each row execute function public.set_updated_at();

create trigger calendar_commands_set_updated_at
before update on public.calendar_commands
for each row execute function public.set_updated_at();

create trigger assistant_commands_set_updated_at
before update on public.assistant_commands
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.auth_status enable row level security;
alter table public.notification_settings enable row level security;
alter table public.user_memory enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.mail_sync_state enable row level security;
alter table public.mail_briefings enable row level security;
alter table public.mail_drafts enable row level security;
alter table public.mail_messages_cache enable row level security;
alter table public.mail_billing_summaries enable row level security;
alter table public.calendar_sync_state enable row level security;
alter table public.calendar_briefings enable row level security;
alter table public.calendar_commands enable row level security;
alter table public.todos enable row level security;
alter table public.assistant_alerts enable row level security;
alter table public.assistant_commands enable row level security;
alter table public.api_idempotency_keys enable row level security;

create policy users_self_access
on public.users
for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy auth_status_user_access
on public.auth_status
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy notification_settings_user_access
on public.notification_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy user_memory_user_access
on public.user_memory
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy push_subscriptions_user_access
on public.push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy mail_sync_state_user_access
on public.mail_sync_state
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy mail_briefings_user_access
on public.mail_briefings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy mail_drafts_user_access
on public.mail_drafts
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy mail_messages_cache_user_access
on public.mail_messages_cache
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy mail_billing_summaries_user_access
on public.mail_billing_summaries
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy calendar_sync_state_user_access
on public.calendar_sync_state
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy calendar_briefings_user_access
on public.calendar_briefings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy calendar_commands_user_access
on public.calendar_commands
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy todos_user_access
on public.todos
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy assistant_alerts_user_access
on public.assistant_alerts
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy assistant_commands_user_access
on public.assistant_commands
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy api_idempotency_keys_user_access
on public.api_idempotency_keys
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
