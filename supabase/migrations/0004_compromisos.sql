-- =====================================================================
-- RetroFlow · Módulo 4: Definición de compromisos
-- ---------------------------------------------------------------------
-- Requiere 0001, 0002 y 0003. Ejecutar completo en Supabase → SQL
-- Editor → New query → Run. Es idempotente (si volvés a correr una
-- migración anterior, corré esta después).
--
-- Qué agrega:
--   * Tabla commitments: acción, responsables (integrantes o personas
--     externas), fecha objetivo opcional y estado.
--   * Fases 'commitments' (definición) y 'closed' (retro cerrada).
--   * RPC (solo PO) para iniciar, guardar, eliminar y finalizar.
-- =====================================================================

create table if not exists public.commitments (
  id          uuid primary key,              -- lo genera el navegador: guardar dos veces no duplica
  room_id     uuid not null references public.rooms(id) on delete cascade,
  card_id     uuid not null references public.cards(id) on delete cascade,
  action      text not null check (char_length(action) between 1 and 1000),
  owners      text[] not null default '{}',  -- nombres de integrantes o de personas externas
  due_date    date,
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists commitments_room_idx on public.commitments (room_id, card_id, created_at);

alter table public.commitments enable row level security;
revoke all on table public.commitments from anon, authenticated;

-- Fases nuevas: 'commitments' (definición) y 'closed' (cierre definitivo).
alter table public.rooms drop constraint if exists rooms_current_phase_check;
alter table public.rooms add constraint rooms_current_phase_check
  check (current_phase is null or current_phase in
         ('destacar', 'mejorar', 'mantener', 'done', 'review', 'review_done', 'commitments', 'closed'));

-- ---------------------------------------------------------------------
-- Estado completo: igual que en 0003; las tarjetas de la revisión se
-- siguen compartiendo durante compromisos y cierre, y se suma la lista
-- de compromisos.
-- ---------------------------------------------------------------------
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
    'review', case when r.current_phase in ('review', 'review_done', 'commitments', 'closed') then jsonb_build_object(
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
    ) else null end,
    'commitments', case when r.current_phase in ('commitments', 'closed') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'cardId', m.card_id,
               'action', m.action,
               'owners', to_jsonb(m.owners),
               'dueDate', m.due_date,
               'status', m.status,
               'createdAt', m.created_at
             ) order by m.created_at, m.id)
        from public.commitments m
       where m.room_id = r.id
    ), '[]'::jsonb) else null end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Iniciar la definición de compromisos (solo PO, al terminar la revisión).
-- ---------------------------------------------------------------------
create or replace function public.start_commitments(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' or r.current_phase not in ('review_done', 'commitments') then
    raise exception using message = 'REVIEW_NOT_DONE', errcode = 'P0001';
  end if;
  if r.current_phase = 'review_done' then
    update public.rooms set current_phase = 'commitments', review_card_id = null where id = r.id;
  end if;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Crear o editar un compromiso (solo PO). p_id lo genera el navegador:
-- si ya existe se actualiza, si no se crea (un reintento no duplica).
-- p_owners: array JSON de nombres, p. ej. ["Ana", "Mesa de ayuda"].
-- ---------------------------------------------------------------------
create or replace function public.save_commitment(
  p_participant_id uuid, p_token uuid, p_id uuid, p_card uuid,
  p_action text, p_owners jsonb, p_due_date date, p_status text
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  v_action text := btrim(coalesce(p_action, ''));
  v_owners text[];
  v_status text := coalesce(p_status, 'pending');
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' or r.current_phase <> 'commitments' then
    raise exception using message = 'COMMITMENTS_CLOSED', errcode = 'P0001';
  end if;
  if not exists (select 1 from public.cards where id = p_card and room_id = r.id) then
    raise exception using message = 'CARD_NOT_FOUND', errcode = 'P0001';
  end if;
  if char_length(v_action) < 1 or char_length(v_action) > 1000 then
    raise exception using message = 'INVALID_COMMITMENT', errcode = 'P0001';
  end if;
  if v_status not in ('pending', 'in_progress', 'done') then
    raise exception using message = 'INVALID_COMMITMENT', errcode = 'P0001';
  end if;

  -- Responsables: sin vacíos ni repetidos (sin distinguir mayúsculas), hasta 20, de hasta 60 caracteres.
  begin
    select coalesce(array_agg(n order by first_pos), '{}') into v_owners
      from (select min(n) as n, min(pos) as first_pos
              from (select public._rf_normalize_name(e) as n, ord as pos
                      from jsonb_array_elements_text(coalesce(p_owners, '[]'::jsonb)) with ordinality as t(e, ord)) x
             where n <> ''
             group by lower(n)) y;
  exception when others then
    raise exception using message = 'INVALID_COMMITMENT', errcode = 'P0001';
  end;
  if cardinality(v_owners) > 20 or exists (select 1 from unnest(v_owners) o where char_length(o) > 60) then
    raise exception using message = 'INVALID_COMMITMENT', errcode = 'P0001';
  end if;

  insert into public.commitments (id, room_id, card_id, action, owners, due_date, status)
  values (p_id, r.id, p_card, v_action, v_owners, p_due_date, v_status)
  on conflict (id) do update
     set action = excluded.action,
         owners = excluded.owners,
         due_date = excluded.due_date,
         status = excluded.status,
         updated_at = now()
   where public.commitments.room_id = r.id;

  return public._rf_state_json(p);
end;
$$;

create or replace function public.delete_commitment(p_participant_id uuid, p_token uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' or r.current_phase <> 'commitments' then
    raise exception using message = 'COMMITMENTS_CLOSED', errcode = 'P0001';
  end if;
  delete from public.commitments where id = p_id and room_id = r.id;  -- borrar algo ya borrado no falla
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Finalizar (solo PO): la retro queda cerrada y nadie más puede ingresar.
-- Quienes ya estaban siguen viendo el cierre con el listado final.
-- ---------------------------------------------------------------------
create or replace function public.finish_commitments(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.current_phase = 'closed' then
    return public._rf_state_json(p);  -- idempotente
  end if;
  if r.status <> 'in_progress' or r.current_phase <> 'commitments' then
    raise exception using message = 'COMMITMENTS_CLOSED', errcode = 'P0001';
  end if;
  update public.rooms
     set current_phase = 'closed', status = 'finished', finished_at = now()
   where id = r.id;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function
  public._rf_state_json(public.participants),
  public.start_commitments(uuid, uuid),
  public.save_commitment(uuid, uuid, uuid, uuid, text, jsonb, date, text),
  public.delete_commitment(uuid, uuid, uuid),
  public.finish_commitments(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.start_commitments(uuid, uuid),
  public.save_commitment(uuid, uuid, uuid, uuid, text, jsonb, date, text),
  public.delete_commitment(uuid, uuid, uuid),
  public.finish_commitments(uuid, uuid)
to anon, authenticated;

notify pgrst, 'reload schema';
