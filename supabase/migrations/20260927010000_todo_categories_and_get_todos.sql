-- Todo/calendar categories, todos.category_id/due_at, get_todos RPC, and parent auto-complete.
-- Contract: Notion "DB Schema" (Supabase-only DB contract, 2026-09-26) and "API 명세"
-- rows todo_categories / calendar_categories / todos / get_todos.

-- ---------------------------------------------------------------------------
-- Categories (user-owned; color is the user's choice)
-- ---------------------------------------------------------------------------

create table public.todo_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  color text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todo_categories_name_length check (char_length(name) between 1 and 30),
  constraint todo_categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint todo_categories_user_name_unique unique (user_id, name),
  constraint todo_categories_user_id_id_unique unique (user_id, id)
);

create table public.calendar_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  color text not null,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_categories_name_length check (char_length(name) between 1 and 30),
  constraint calendar_categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint calendar_categories_user_name_unique unique (user_id, name),
  constraint calendar_categories_user_id_id_unique unique (user_id, id)
);

create trigger todo_categories_set_updated_at
before update on public.todo_categories
for each row execute function public.set_updated_at();

create trigger calendar_categories_set_updated_at
before update on public.calendar_categories
for each row execute function public.set_updated_at();

alter table public.todo_categories enable row level security;
alter table public.calendar_categories enable row level security;

create policy todo_categories_user_access
on public.todo_categories
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy calendar_categories_user_access
on public.calendar_categories
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.todo_categories to authenticated;
grant select, insert, update, delete on public.calendar_categories to authenticated;

-- ---------------------------------------------------------------------------
-- todos: category_id (same-user composite FK), due_at replaces due_date
-- ---------------------------------------------------------------------------

alter table public.todos
  add column category_id uuid,
  add column due_at timestamptz;

alter table public.todos
  add constraint todos_category_same_user_fk
    foreign key (user_id, category_id)
    references public.todo_categories (user_id, id)
    on delete set null (category_id);

-- Old date-only deadlines become midnight in the owner's timezone.
update public.todos t
set due_at = (t.due_date::timestamp at time zone u.timezone)
from public.users u
where u.id = t.user_id
  and t.due_date is not null;

alter table public.todos drop column due_date;

create index todos_user_date_order_idx on public.todos (user_id, date, order_index);
create index todos_user_parent_idx on public.todos (user_id, parent_id);

-- App UPDATE is limited to these columns; ownership stays with RLS.
revoke update on public.todos from authenticated;
grant update (title, date, due_at, category_id, linked_event_id, status, order_index)
  on public.todos to authenticated;

-- ---------------------------------------------------------------------------
-- notification_settings: snooze range and allowed UPDATE columns
-- ---------------------------------------------------------------------------

alter table public.notification_settings
  drop constraint notification_settings_snooze_check,
  add constraint notification_settings_snooze_check
    check (alert_snooze_minutes between 1 and 1440);

-- Rows are created by the account bootstrap trigger; the app only reads and updates them.
revoke insert, update, delete on public.notification_settings from authenticated;
grant update (
  new_mail_enabled,
  calendar_reminder_enabled,
  mail_send_confirmation_enabled,
  calendar_approval_enabled,
  alert_snooze_minutes
) on public.notification_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Parent auto-complete: a parent is done exactly when all of its children are done.
-- ---------------------------------------------------------------------------

create or replace function public.sync_parent_todo_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent uuid := coalesce(new.parent_id, old.parent_id);
  owner uuid := coalesce(new.user_id, old.user_id);
  open_children integer;
  total_children integer;
begin
  if parent is null then
    return null;
  end if;

  select count(*) filter (where status = 'active'), count(*)
  into open_children, total_children
  from public.todos
  where user_id = owner and parent_id = parent;

  if total_children = 0 then
    return null;
  end if;

  update public.todos
  set status = case when open_children = 0 then 'done' else 'active' end::public.todo_status
  where id = parent
    and user_id = owner
    and status <> case when open_children = 0 then 'done' else 'active' end::public.todo_status;

  return null;
end;
$$;

create trigger todos_sync_parent_status
after insert or delete or update of status, parent_id on public.todos
for each row execute function public.sync_parent_todo_status();

revoke all on function public.sync_parent_todo_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_todos(filter, date, category_id, q)
-- ---------------------------------------------------------------------------
-- Returns a JSON array of the caller's top-level todos, each with its category, children,
-- and linked_event. filter: 'today' (default) | 'week' (Mon–Sun) | 'overdue' | 'all';
-- an explicit date wins over filter. "Today" uses users.timezone.
-- linked_event is null until calendar_events_cache exists (Edge-owned; not in this schema).

create or replace function public.get_todos(
  filter text default 'today',
  date date default null,
  category_id uuid default null,
  q text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  tz text;
  today date;
  week_start date;
  result jsonb;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if get_todos.date is null and coalesce(filter, 'today') not in ('today', 'week', 'overdue', 'all') then
    raise exception 'filter must be today, week, overdue, or all' using errcode = '22023';
  end if;

  select coalesce(u.timezone, 'Asia/Seoul') into tz from public.users u where u.id = caller;
  today := (now() at time zone coalesce(tz, 'Asia/Seoul'))::date;
  week_start := today - (extract(isodow from today)::integer - 1);

  select coalesce(jsonb_agg(item order by sort_order, sort_created), '[]'::jsonb)
  into result
  from (
    select
      t.order_index as sort_order,
      t.created_at as sort_created,
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'status', t.status,
        'date', t.date,
        'due_at', t.due_at,
        'source', t.source,
        'order_index', t.order_index,
        'category', case when c.id is null then null
          else jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) end,
        'linked_event', null,
        'children', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', ch.id,
              'title', ch.title,
              'status', ch.status,
              'date', ch.date,
              'due_at', ch.due_at,
              'source', ch.source,
              'order_index', ch.order_index
            )
            order by ch.order_index, ch.created_at
          )
          from public.todos ch
          where ch.user_id = caller and ch.parent_id = t.id
        ), '[]'::jsonb)
      ) as item
    from public.todos t
    left join public.todo_categories c
      on c.user_id = caller and c.id = t.category_id
    where t.user_id = caller
      and t.parent_id is null
      and (get_todos.category_id is null or t.category_id = get_todos.category_id)
      and (q is null or t.title ilike '%' || q || '%')
      and (
        case
          when get_todos.date is not null then t.date = get_todos.date
          when coalesce(filter, 'today') = 'today' then t.date = today
          when filter = 'week' then t.date between week_start and week_start + 6
          when filter = 'overdue' then t.status = 'active' and t.due_at is not null and t.due_at < now()
          else true
        end
      )
  ) rows;

  return result;
end;
$$;

revoke all on function public.get_todos(text, date, uuid, text) from public, anon;
grant execute on function public.get_todos(text, date, uuid, text) to authenticated;
