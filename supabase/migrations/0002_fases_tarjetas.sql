-- =====================================================================
-- RetroFlow · Módulo 2: Fases de carga de tarjetas
-- ---------------------------------------------------------------------
-- Requiere haber ejecutado 0001_salas.sql. Ejecutar completo en
-- Supabase → SQL Editor → New query → Run. Es idempotente.
--
-- Qué agrega:
--   * Nombre de la retro y duraciones por fase (en rooms.settings).
--   * Estado de fase y timer centralizado en la sala (la hora de
--     referencia es la del servidor; los navegadores solo la muestran).
--   * Tabla cards (tarjetas) asociada a sala, fase y autor.
--   * RPC para configurar, iniciar, controlar fases y agregar tarjetas.
--
-- Anonimato: cards.author_id se guarda para que cada persona vea sus
-- propias tarjetas y para contar contribuciones, pero NINGUNA función
-- devuelve el autor de una tarjeta anónima a otra persona (ni al PO).
-- Las tablas siguen cerradas al navegador (RLS sin políticas).
-- Regla para módulos futuros: toda RPC que liste tarjetas o comentarios
-- debe omitir author_id/nombre cuando is_anonymous = true.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sala: nombre, fase y timer
-- ---------------------------------------------------------------------
alter table public.rooms
  add column if not exists title              text,
  add column if not exists phase_status       text,
  add column if not exists phase_started_at   timestamptz,
  add column if not exists timer_ends_at      timestamptz,  -- null = pausado / sin timer
  add column if not exists timer_remaining_ms integer,      -- usado mientras está pausado
  add column if not exists timer_total_ms     integer;      -- duración total (incluye extensiones)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_title_check') then
    alter table public.rooms add constraint rooms_title_check
      check (title is null or char_length(title) between 1 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rooms_current_phase_check') then
    alter table public.rooms add constraint rooms_current_phase_check
      check (current_phase is null or current_phase in ('destacar', 'mejorar', 'mantener', 'done'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rooms_phase_status_check') then
    alter table public.rooms add constraint rooms_phase_status_check
      check (phase_status is null or phase_status in ('active', 'closed'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tarjetas
-- ---------------------------------------------------------------------
create table if not exists public.cards (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  author_id     uuid not null references public.participants(id) on delete cascade,
  phase         text not null check (phase in ('destacar', 'mejorar', 'mantener')),
  title         text not null check (char_length(title) between 1 and 120),
  body          text not null default '' check (char_length(body) <= 2000),
  is_anonymous  boolean not null,
  -- Id generado por el navegador: evita duplicados ante reintentos.
  client_id     uuid not null,
  created_at    timestamptz not null default now(),
  unique (author_id, client_id)
);
create index if not exists cards_room_phase_idx on public.cards (room_id, phase);

alter table public.cards enable row level security;
revoke all on table public.cards from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._rf_next_phase(p text)
returns text language sql immutable set search_path = public as $$
  select case p when 'destacar' then 'mejorar'
                when 'mejorar'  then 'mantener'
                when 'mantener' then 'done' end;
$$;

-- Duración (segundos) configurada para una fase, con valores sugeridos por defecto.
create or replace function public._rf_duration_s(r public.rooms, p text)
returns integer language sql stable set search_path = public as $$
  select coalesce(
    (r.settings -> 'durations' ->> p)::integer,
    case p when 'mejorar' then 420 else 300 end
  );
$$;

-- Reemplaza la versión del módulo 1 sumando nombre, duraciones, fase y timer.
create or replace function public._rf_room_json(r public.rooms)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'title', r.title,
    'status', r.status,
    'currentPhase', r.current_phase,
    'phaseStatus', r.phase_status,
    'durations', jsonb_build_object(
      'destacar', public._rf_duration_s(r, 'destacar'),
      'mejorar',  public._rf_duration_s(r, 'mejorar'),
      'mantener', public._rf_duration_s(r, 'mantener')
    ),
    'timer', jsonb_build_object(
      'endsAt', r.timer_ends_at,
      'remainingMs', r.timer_remaining_ms,
      'totalMs', r.timer_total_ms
    ),
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'finishedAt', r.finished_at,
    'poName', (select p.name from public.participants p where p.room_id = r.id and p.role = 'po')
  );
$$;

-- Estado completo que ve un participante. Nunca incluye tarjetas ajenas.
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
    -- Solo las tarjetas propias.
    'myCards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'phase', c.phase, 'title', c.title, 'body', c.body,
               'anonymous', c.is_anonymous, 'createdAt', c.created_at
             ) order by c.created_at)
        from public.cards c
       where c.author_id = me.id
    ), '[]'::jsonb),
    -- Progreso agregado: cantidades, sin contenido ni autores.
    'progress', jsonb_build_object(
      'destacar', (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'destacar'),
      'mejorar',  (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'mejorar'),
      'mantener', (select jsonb_build_object('cards', count(*), 'contributors', count(distinct author_id))
                     from public.cards where room_id = r.id and phase = 'mantener')
    ),
    'contributors', (select count(distinct author_id) from public.cards where room_id = r.id)
  );
end;
$$;

create or replace function public._rf_auth_po(p_participant_id uuid, p_token uuid)
returns public.participants language plpgsql stable security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
begin
  if p.role <> 'po' then
    raise exception using message = 'NOT_PO', errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- ---------------------------------------------------------------------
-- get_room_state: misma firma que el módulo 1, ahora con el estado extendido.
-- ---------------------------------------------------------------------
create or replace function public.get_room_state(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
  v_status text;
begin
  select status into v_status from public.rooms where id = p.room_id;
  if v_status <> 'finished' then
    update public.participants set last_seen_at = now(), left_at = null where id = p.id
    returning * into p;
  end if;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Configuración previa (solo PO, solo en sala de espera)
-- p_durations: {"destacar": 300, "mejorar": 420, "mantener": 300} en segundos (1 a 60 min)
-- ---------------------------------------------------------------------
create or replace function public.configure_room(
  p_participant_id uuid, p_token uuid, p_title text, p_durations jsonb
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  v_title text := nullif(public._rf_normalize_name(p_title), '');
  v_d jsonb := '{}'::jsonb;
  v_ph text;
  v_s integer;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'waiting' then
    raise exception using message = 'ROOM_ALREADY_STARTED', errcode = 'P0001';
  end if;
  if v_title is not null and char_length(v_title) > 60 then
    raise exception using message = 'INVALID_TITLE', errcode = 'P0001';
  end if;
  foreach v_ph in array array['destacar', 'mejorar', 'mantener'] loop
    begin
      v_s := coalesce((p_durations ->> v_ph)::integer, public._rf_duration_s(r, v_ph));
    exception when others then
      raise exception using message = 'INVALID_DURATION', errcode = 'P0001';
    end;
    if v_s < 60 or v_s > 3600 then
      raise exception using message = 'INVALID_DURATION', errcode = 'P0001';
    end if;
    v_d := v_d || jsonb_build_object(v_ph, v_s);
  end loop;

  update public.rooms
     set title = v_title,
         settings = settings || jsonb_build_object('durations', v_d)
   where id = r.id;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Iniciar la retrospectiva (solo PO). Idempotente.
-- ---------------------------------------------------------------------
create or replace function public.start_retrospective(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  v_s integer;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status = 'finished' then
    raise exception using message = 'ROOM_FINISHED', errcode = 'P0001';
  end if;
  if r.status = 'waiting' then
    v_s := public._rf_duration_s(r, 'destacar');
    update public.rooms
       set status = 'in_progress',
           started_at = now(),
           current_phase = 'destacar',
           phase_status = 'active',
           phase_started_at = now(),
           timer_total_ms = v_s * 1000,
           timer_ends_at = now() + make_interval(secs => v_s),
           timer_remaining_ms = null
     where id = r.id;
  end if;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Control de fase y timer (solo PO)
--   p_action: pause | resume | extend | close | next
--   p_phase:  fase que el PO está viendo; si no coincide con la actual se
--             rechaza con PHASE_CHANGED (evita dobles clics y saltos de fase).
-- ---------------------------------------------------------------------
create or replace function public.phase_control(
  p_participant_id uuid, p_token uuid, p_action text, p_phase text, p_seconds integer default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
  v_next text;
  v_s integer;
begin
  select * into r from public.rooms where id = p.room_id for update;
  if r.status <> 'in_progress' then
    raise exception using message = 'ROOM_NOT_IN_PROGRESS', errcode = 'P0001';
  end if;
  if r.current_phase is distinct from p_phase then
    raise exception using message = 'PHASE_CHANGED', errcode = 'P0001';
  end if;

  if p_action = 'pause' then
    if r.phase_status = 'active' and r.timer_ends_at is not null then
      update public.rooms
         set timer_remaining_ms = greatest(0, floor(extract(epoch from (r.timer_ends_at - now())) * 1000))::integer,
             timer_ends_at = null
       where id = r.id;
    end if;

  elsif p_action = 'resume' then
    if r.phase_status = 'active' and r.timer_ends_at is null then
      update public.rooms
         set timer_ends_at = now() + make_interval(secs => coalesce(r.timer_remaining_ms, 0) / 1000.0),
             timer_remaining_ms = null
       where id = r.id;
    end if;

  elsif p_action = 'extend' then
    v_s := coalesce(p_seconds, 60);
    if v_s < 10 or v_s > 1800 then
      raise exception using message = 'INVALID_DURATION', errcode = 'P0001';
    end if;
    if r.phase_status = 'active' then
      if r.timer_ends_at is null then
        -- en pausa: suma al tiempo restante
        update public.rooms
           set timer_remaining_ms = coalesce(r.timer_remaining_ms, 0) + v_s * 1000,
               timer_total_ms = case when coalesce(r.timer_remaining_ms, 0) = 0 then v_s * 1000
                                     else r.timer_total_ms + v_s * 1000 end
         where id = r.id;
      elsif r.timer_ends_at <= now() then
        -- ya había vencido: arranca de nuevo desde ahora
        update public.rooms
           set timer_ends_at = now() + make_interval(secs => v_s),
               timer_total_ms = v_s * 1000
         where id = r.id;
      else
        update public.rooms
           set timer_ends_at = r.timer_ends_at + make_interval(secs => v_s),
               timer_total_ms = r.timer_total_ms + v_s * 1000
         where id = r.id;
      end if;
    end if;

  elsif p_action = 'close' then
    if r.phase_status = 'active' then
      update public.rooms
         set phase_status = case when r.current_phase = 'mantener' then null else 'closed' end,
             current_phase = case when r.current_phase = 'mantener' then 'done' else r.current_phase end,
             timer_ends_at = null,
             timer_remaining_ms = 0
       where id = r.id;
    end if;

  elsif p_action = 'next' then
    if r.phase_status = 'closed' and r.current_phase in ('destacar', 'mejorar') then
      v_next := public._rf_next_phase(r.current_phase);
      v_s := public._rf_duration_s(r, v_next);
      update public.rooms
         set current_phase = v_next,
             phase_status = 'active',
             phase_started_at = now(),
             timer_total_ms = v_s * 1000,
             timer_ends_at = now() + make_interval(secs => v_s),
             timer_remaining_ms = null
       where id = r.id;
    end if;

  else
    raise exception using message = 'INVALID_ACTION', errcode = 'P0001';
  end if;

  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Agregar tarjeta. Idempotente por (autor, p_client_id).
-- Solo se acepta en la fase actual y mientras esté activa (aunque el
-- timer haya llegado a cero: la fase la cierra el PO).
-- ---------------------------------------------------------------------
create or replace function public.add_card(
  p_participant_id uuid, p_token uuid, p_phase text, p_title text, p_body text,
  p_anonymous boolean, p_client_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
  r public.rooms;
  v_title text := public._rf_normalize_name(p_title);
  v_body text := btrim(coalesce(p_body, ''));
begin
  -- Reintento de una tarjeta ya guardada: devolver el estado sin duplicar.
  if exists (select 1 from public.cards where author_id = p.id and client_id = p_client_id) then
    return public._rf_state_json(p);
  end if;

  -- Bloqueo compartido: serializa con el cierre de fase del PO.
  select * into r from public.rooms where id = p.room_id for share;
  if r.status <> 'in_progress' or r.current_phase is distinct from p_phase or r.phase_status <> 'active' then
    raise exception using message = 'PHASE_CLOSED', errcode = 'P0001';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 or char_length(v_body) > 2000 then
    raise exception using message = 'INVALID_CARD', errcode = 'P0001';
  end if;

  insert into public.cards (room_id, author_id, phase, title, body, is_anonymous, client_id)
  values (r.id, p.id, p_phase, v_title, v_body, coalesce(p_anonymous, true), p_client_id)
  on conflict (author_id, client_id) do nothing;

  update public.participants set last_seen_at = now() where id = p.id;
  return public._rf_state_json(p);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function
  public._rf_next_phase(text),
  public._rf_duration_s(public.rooms, text),
  public._rf_room_json(public.rooms),
  public._rf_state_json(public.participants),
  public._rf_auth_po(uuid, uuid),
  public.get_room_state(uuid, uuid),
  public.configure_room(uuid, uuid, text, jsonb),
  public.start_retrospective(uuid, uuid),
  public.phase_control(uuid, uuid, text, text, integer),
  public.add_card(uuid, uuid, text, text, text, boolean, uuid)
from public, anon, authenticated;

grant execute on function
  public.get_room_state(uuid, uuid),
  public.configure_room(uuid, uuid, text, jsonb),
  public.start_retrospective(uuid, uuid),
  public.phase_control(uuid, uuid, text, text, integer),
  public.add_card(uuid, uuid, text, text, text, boolean, uuid)
to anon, authenticated;
