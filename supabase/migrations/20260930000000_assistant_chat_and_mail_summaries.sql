-- Assistant chat (conversations/messages), assistant_commands results, and mail summaries.
-- Contract: Notion "DB Schema" (2026-09-26) and "채팅 메시지 전송 및 assistant 응답 생성".
-- Replies, titles, command results and summaries are written only by the Edge Functions
-- (service_role), so the app can never forge an assistant answer.

-- ---------------------------------------------------------------------------
-- assistant_conversations: the app creates the row (id, user_id); the rest is Edge-only.
-- ---------------------------------------------------------------------------

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint assistant_conversations_user_id_id_unique unique (user_id, id),
  constraint assistant_conversations_title_length check (title is null or char_length(title) between 1 and 60)
);

create index assistant_conversations_user_recent_idx
  on public.assistant_conversations (user_id, last_message_at desc nulls last);

create trigger assistant_conversations_set_updated_at
before update on public.assistant_conversations
for each row execute function public.set_updated_at();

alter table public.assistant_conversations enable row level security;
revoke all on public.assistant_conversations from anon, authenticated;
grant select on public.assistant_conversations to authenticated;
grant insert (id, user_id) on public.assistant_conversations to authenticated;

create policy assistant_conversations_select_own
on public.assistant_conversations
for select to authenticated
using (user_id = auth.uid());

create policy assistant_conversations_insert_own
on public.assistant_conversations
for insert to authenticated
with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- assistant_commands: results for Realtime; the app only reads.
-- ---------------------------------------------------------------------------

alter table public.assistant_commands
  add column result_text text,
  add column conversation_id uuid,
  add constraint assistant_commands_user_id_id_unique unique (user_id, id),
  add constraint assistant_commands_conversation_same_user_fk
    foreign key (user_id, conversation_id)
    references public.assistant_conversations (user_id, id)
    on delete set null (conversation_id);

create index assistant_commands_user_created_idx on public.assistant_commands (user_id, created_at desc);

drop policy if exists assistant_commands_user_access on public.assistant_commands;
revoke all on public.assistant_commands from anon, authenticated;
grant select on public.assistant_commands to authenticated;

create policy assistant_commands_select_own
on public.assistant_commands
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- assistant_messages: SELECT-only for the app, ordered by (created_at, id).
-- ---------------------------------------------------------------------------

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null,
  content text not null,
  -- user rows: the attached {type, id}; assistant rows: {suggested_todos[], sources}.
  context jsonb,
  command_id uuid,
  created_at timestamptz not null default now(),
  constraint assistant_messages_role_check check (role in ('user', 'assistant')),
  constraint assistant_messages_content_length check (char_length(content) between 1 and 8000),
  constraint assistant_messages_conversation_same_user_fk
    foreign key (user_id, conversation_id)
    references public.assistant_conversations (user_id, id)
    on delete cascade,
  constraint assistant_messages_command_same_user_fk
    foreign key (user_id, command_id)
    references public.assistant_commands (user_id, id)
    on delete set null (command_id)
);

create index assistant_messages_conversation_order_idx
  on public.assistant_messages (conversation_id, created_at, id);

alter table public.assistant_messages enable row level security;
revoke all on public.assistant_messages from anon, authenticated;
grant select on public.assistant_messages to authenticated;

create policy assistant_messages_select_own
on public.assistant_messages
for select to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- mail_message_summaries: LLM summary per (message, source_version); Edge-only.
-- ---------------------------------------------------------------------------

alter table public.mail_messages_cache
  add constraint mail_messages_cache_user_id_id_unique unique (user_id, id);

create table public.mail_message_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  message_id uuid not null,
  summary_data jsonb not null,
  reply_suggestion text,
  suggested_todos jsonb not null default '[]'::jsonb,
  source_version text not null,
  generated_at timestamptz not null default now(),
  constraint mail_message_summaries_unique_version unique (user_id, message_id, source_version),
  constraint mail_message_summaries_message_same_user_fk
    foreign key (user_id, message_id)
    references public.mail_messages_cache (user_id, id)
    on delete cascade
);

alter table public.mail_message_summaries enable row level security;
revoke all on public.mail_message_summaries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (RLS still decides who receives each row)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['assistant_messages', 'assistant_commands', 'assistant_alerts', 'auth_status'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
