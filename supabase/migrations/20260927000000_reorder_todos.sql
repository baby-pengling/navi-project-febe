-- reorder_todos(items jsonb): batch-update todos.order_index for the caller's todos.
-- API spec: "여러 투두의 order_index를 배열로 한 번에 갱신" (RPC, MVP).
--
-- items: [{"id": "<todo uuid>", "order_index": <number>}, ...]
-- Runs in one transaction: every id must be unique and belong to auth.uid(), otherwise
-- nothing is updated and an error is raised.
--   42501 not authenticated
--   22023 malformed items (not an array, missing/invalid id or order_index, duplicate id)
--   22P02 id is not a valid uuid
--   P0002 one or more todos not found for the caller (foreign or missing rows)

create or replace function public.reorder_todos(items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item_count integer;
  distinct_count integer;
  owned_count integer;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(items) as item
    where jsonb_typeof(item) <> 'object'
      or coalesce(jsonb_typeof(item -> 'id'), '') <> 'string'
      or coalesce(jsonb_typeof(item -> 'order_index'), '') <> 'number'
  ) then
    raise exception 'each item needs a string id and a numeric order_index' using errcode = '22023';
  end if;

  select count(*), count(distinct (item ->> 'id')::uuid)
  into item_count, distinct_count
  from jsonb_array_elements(items) as item;

  if item_count <> distinct_count then
    raise exception 'duplicate todo id in items' using errcode = '22023';
  end if;

  select count(*)
  into owned_count
  from public.todos t
  join jsonb_array_elements(items) as item on t.id = (item ->> 'id')::uuid
  where t.user_id = caller;

  if owned_count <> item_count then
    raise exception 'todo not found' using errcode = 'P0002';
  end if;

  update public.todos t
  set order_index = (item ->> 'order_index')::double precision
  from jsonb_array_elements(items) as item
  where t.id = (item ->> 'id')::uuid
    and t.user_id = caller;
end;
$$;

revoke all on function public.reorder_todos(jsonb) from public, anon;
grant execute on function public.reorder_todos(jsonb) to authenticated;
