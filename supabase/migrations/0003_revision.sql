-- =====================================================================
-- RetroFlow · Módulo 3: Revisión de tarjetas
-- ---------------------------------------------------------------------
-- Requiere 0001 y 0002. Ejecutar completo en Supabase → SQL Editor →
-- New query → Run. Es idempotente (si volvés a correr 0001 o 0002,
-- corré esta después).
--
-- Qué agrega:
--   * Orden aleatorio de revisión por categoría, generado UNA vez.
--   * Estado de revisión por tarjeta (pending / in_review / reviewed),
--     marca independiente "Generar acción" y "Accionables" del PO.
--   * Puntero compartido de la sala: categoría y tarjeta en pantalla.
--   * RPC de inicio, navegación (solo PO) y registro (solo PO).
--
-- Anonimato: el listado de revisión devuelve el nombre del autor solo
-- en tarjetas NO anónimas y nunca devuelve author_id. Nadie (tampoco el
-- PO) puede obtener el autor de una tarjeta anónima desde la app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.cards
  add column if not exists review_order  integer,
  add column if not exists review_status text not null default 'pending',
  add column if not exists needs_action  boolean not null default false,
  add column if not exists po_notes      text not null default '',
  add column if not exists reviewed_at   timestamptz;

alter table public.rooms
  add column if not exists review_category text,
  -- Categoría más avanzada alcanzada: se puede volver a cualquier tarjeta hasta ella.
  add column if not exists review_reached  text,
  add column if not exists review_card_id  uuid references public.cards(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_review_status_check') then
    alter table public.cards add constraint cards_review_status_check
      check (review_status in ('pending', 'in_review', 'reviewed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_po_notes_check') then
    alter table public.cards add constraint cards_po_notes_check
      check (char_length(po_notes) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rooms_review_category_check') then
    alter table public.rooms add constraint rooms_review_category_check
      check (review_category is null or review_category in ('destacar', 'mejorar', 'mantener'));
  end if;
end $$;

-- current_phase suma 'review' (revisión en curso) y 'review_done' (resumen final).
alter table public.rooms drop constraint if exists rooms_current_phase_check;
alter table public.rooms add constraint rooms_current_phase_check
  check (current_phase is null or current_phase in
         ('destacar', 'mejorar', 'mantener', 'done', 'review', 'review_done'));

create index if not exists cards_review_idx on public.cards (room_id, phase, review_order);

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._rf_phase_rank(p text)
returns integer language sql immutable set search_path = public as $$
  select array_position(array['destacar', 'mejorar', 'mantener'], p);
$$;

-- Al poner una tarjeta en pantalla: si estaba pendiente pasa a "en revisión".
create or replace function public._rf_review_enter(p_card uuid)
returns void language sql volatile set search_path = public as $$
  update public.cards set review_status = 'in_review'
   where id = p_card and review_status = 'pending';
$$;

-- Al salir de una tarjeta sin cerrarla: "en revisión" vuelve a "pendiente".
create or replace function public._rf_review_leave(p_card uuid)
returns void language sql volatile set search_path = public as $$
  update public.cards set review_status = 'pending'
   where id = p_card and review_status = 'in_review';
$$;

create or replace function public._rf_first_card(p_room uuid, p_phase text)
returns uuid language sql stable set search_path = public as $$
  select id from public.cards
   where room_id = p_room and phase = p_phase
   order by review_order, id limit 1;
$$;

-- Estado completo: igual que en 0002 + bloque "review" durante la revisión.
create or replace function public._rf_state_json(me public.participants)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = me.room_id;
  return jsonb_build_object(
    'room', public._rf_room_json(r),
    'serverNow', clock_timestamp(),
    'participants', coalesce((
      select jsonb_agg(public._rf_participant_json(x) order by (x.role = 'po') desc, x.joined_at)
        from public.participants x
       where x.room_id = r.id and x.left_at is null
    ), '[]'::jsonb),
    'myCards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'phase', c.phase, 'title', c.title, 'body', c.body,
               'anonymous', c.is_anonymous, 'createdAt', c.created_at
             ) order by c.created_at)
        from public.cards c
       where c.author_id = me.id
    ), '[]'::jsonb),
    'progress', jsonb_build_object(
      'destacar', (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'destacar'),
      'mejorar',  (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'mejorar'),
      'mantener', (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'mantener')
    ),
    'contributors', (select count(distinct author_id) from public.cards where room_id = r.id),
    -- Solo durante la revisión se comparten las tarjetas del equipo.
    'review', case when r.current_phase in ('review', 'review_done') then jsonb_build_object(
      'category', r.review_category,
      'reached', coalesce(r.review_reached, r.review_category),
      'cardId', r.review_card_id,
      'cards', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id,
                 'phase', c.phase,
                 'order', c.review_order,
                 'title', c.title,
                 'body', c.body,
                 'anonymous', c.is_anonymous,
                 'authorName', case when c.is_anonymous then null else a.name end,
                 'status', c.review_status,
                 'needsAction', c.needs_action,
                 'notes', c.po_notes
               ) order by public._rf_phase_rank(c.phase), c.review_order, c.id)
          from public.cards c
          join public.participants a on a.id = c.author_id
         where c.room_id = r.id
      ), '[]'::jsonb)
    ) else null end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Iniciar la revisión (solo PO, al terminar la carga). Idempotente.
-- Mezcla aleatoriamente cada categoría por separado, una sola vez.
-- ---------------------------------------------------------------------
create or replace function public.start_review(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  v_card uuid;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' or r.current_phase not in ('done', 'review', 'review_done') then
    raise exception using message = 'COLLECTION_NOT_DONE', errcode = 'P0001';
  end if;

  if r.current_phase = 'done' then
    -- Orden aleatorio dentro de cada categoría (nunca se mezclan categorías).
    update public.cards c
       set review_order = s.n
      from (select id, row_number() over (partition by phase order by random()) as n
              from public.cards where room_id = r.id) s
     where c.id = s.id and c.review_order is null;

    v_card := public._rf_first_card(r.id, 'destacar');
    perform public._rf_review_enter(v_card);
    update public.rooms
       set current_phase = 'review', review_category = 'destacar', review_reached = 'destacar',
           review_card_id = v_card
     where id = r.id;
  end if;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Navegación (solo PO)
--   next          → marca la actual como revisada y pasa a la siguiente
--   skip          → deja la actual pendiente y pasa a la siguiente
--   prev          → vuelve a la anterior (la actual conserva su estado)
--   goto          → va a una tarjeta puntual (p_target) de la categoría
--                   actual o de una anterior (retomar pendientes / revisadas)
--   next_category → desde el resumen de una categoría, pasa a la siguiente
--   finish        → desde el resumen de Mantener, cierra la revisión
-- Después de la última tarjeta de una categoría se muestra su resumen
-- (review_card_id = null).
-- p_expected_category / p_expected_card: lo que ve el PO. Si no coincide
-- con el estado real → REVIEW_CHANGED (evita dobles clics).
-- ---------------------------------------------------------------------
create or replace function public.review_navigate(
  p_participant_id uuid, p_token uuid, p_action text,
  p_expected_category text, p_expected_card uuid, p_target uuid default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  cur public.cards;
  t public.cards;
  v_next uuid;
  v_cat text;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' or r.current_phase not in ('review', 'review_done') then
    raise exception using message = 'REVIEW_NOT_ACTIVE', errcode = 'P0001';
  end if;
  if r.review_category is distinct from p_expected_category
     or r.review_card_id is distinct from p_expected_card then
    raise exception using message = 'REVIEW_CHANGED', errcode = 'P0001';
  end if;

  if r.review_card_id is not null then
    select * into cur from public.cards where id = r.review_card_id;
  end if;

  if p_action in ('next', 'skip') then
    if cur.id is null or r.current_phase <> 'review' then
      raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
    end if;
    if p_action = 'next' then
      update public.cards set review_status = 'reviewed', reviewed_at = now() where id = cur.id;
    else
      update public.cards set review_status = 'pending' where id = cur.id;
    end if;
    select id into v_next from public.cards
     where room_id = r.id and phase = cur.phase and review_order > cur.review_order
     order by review_order limit 1;
    perform public._rf_review_enter(v_next);
    update public.rooms set review_card_id = v_next where id = r.id;

  elsif p_action = 'prev' then
    if r.current_phase <> 'review' then
      raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
    end if;
    if cur.id is null then
      -- desde el resumen: volver a la última tarjeta de la categoría
      select id into v_next from public.cards
       where room_id = r.id and phase = r.review_category
       order by review_order desc limit 1;
    else
      select id into v_next from public.cards
       where room_id = r.id and phase = cur.phase and review_order < cur.review_order
       order by review_order desc limit 1;
    end if;
    if v_next is not null then
      perform public._rf_review_leave(cur.id);
      perform public._rf_review_enter(v_next);
      update public.rooms set review_card_id = v_next where id = r.id;
    end if;

  elsif p_action = 'goto' then
    select * into t from public.cards where id = p_target and room_id = r.id;
    if t.id is null then
      raise exception using message = 'CARD_NOT_FOUND', errcode = 'P0001';
    end if;
    -- Solo categorías ya alcanzadas: se respeta el orden Destacar → Mejorar → Mantener.
    if r.current_phase = 'review'
       and public._rf_phase_rank(t.phase) > public._rf_phase_rank(coalesce(r.review_reached, r.review_category)) then
      raise exception using message = 'CATEGORY_LOCKED', errcode = 'P0001';
    end if;
    if cur.id is distinct from t.id then
      perform public._rf_review_leave(cur.id);
    end if;
    perform public._rf_review_enter(t.id);
    update public.rooms
       set current_phase = 'review', review_category = t.phase, review_card_id = t.id
     where id = r.id;

  elsif p_action = 'next_category' then
    if cur.id is not null or r.current_phase <> 'review' or r.review_category = 'mantener' then
      raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
    end if;
    v_cat := public._rf_next_phase(r.review_category);
    v_next := public._rf_first_card(r.id, v_cat);
    perform public._rf_review_enter(v_next);
    update public.rooms
       set review_category = v_cat,
           review_card_id = v_next,
           review_reached = case when public._rf_phase_rank(v_cat) > public._rf_phase_rank(coalesce(review_reached, 'destacar'))
                                 then v_cat else review_reached end
     where id = r.id;

  elsif p_action = 'finish' then
    if cur.id is not null or r.current_phase <> 'review' or r.review_category <> 'mantener' then
      raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
    end if;
    update public.rooms set current_phase = 'review_done', review_card_id = null where id = r.id;

  else
    raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
  end if;

  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Registro del PO sobre una tarjeta: Accionables y marca "Generar acción".
-- Parámetros null = no cambiar. No toca el contenido original de la tarjeta.
-- ---------------------------------------------------------------------
create or replace function public.update_card_review(
  p_participant_id uuid, p_token uuid, p_card uuid,
  p_notes text default null, p_needs_action boolean default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id;
  if r.status <> 'in_progress' or r.current_phase not in ('review', 'review_done') then
    raise exception using message = 'REVIEW_NOT_ACTIVE', errcode = 'P0001';
  end if;
  if p_notes is not null and char_length(p_notes) > 4000 then
    raise exception using message = 'NOTES_TOO_LONG', errcode = 'P0001';
  end if;
  update public.cards
     set po_notes = coalesce(p_notes, po_notes),
         needs_action = coalesce(p_needs_action, needs_action)
   where id = p_card and room_id = r.id;
  if not found then
    raise exception using message = 'CARD_NOT_FOUND', errcode = 'P0001';
  end if;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function
  public._rf_phase_rank(text),
  public._rf_review_enter(uuid),
  public._rf_review_leave(uuid),
  public._rf_first_card(uuid, text),
  public._rf_state_json(public.participants),
  public.start_review(uuid, uuid),
  public.review_navigate(uuid, uuid, text, text, uuid, uuid),
  public.update_card_review(uuid, uuid, uuid, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.start_review(uuid, uuid),
  public.review_navigate(uuid, uuid, text, text, uuid, uuid),
  public.update_card_review(uuid, uuid, uuid, text, boolean)
to anon, authenticated;

-- Avisar a la API de Supabase que hay funciones nuevas.
notify pgrst, 'reload schema';
