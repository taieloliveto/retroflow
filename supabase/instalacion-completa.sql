-- =====================================================================
-- Retronadas 2.0 · Instalación completa de la base (migraciones 0001 a 0005)
-- Para un proyecto de Supabase nuevo: pegar TODO en SQL Editor → Run.
-- También se puede volver a correr sobre un proyecto existente (es idempotente).
-- =====================================================================

-- >>> supabase/migrations/0001_salas.sql
-- =====================================================================
-- RetroFlow · Módulo 1: Salas y participantes
-- ---------------------------------------------------------------------
-- Ejecutar completo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a ejecutar sin romper nada.
--
-- Modelo de seguridad:
--   * Las tablas tienen RLS activado y SIN políticas: el navegador no
--     puede leer ni escribir directamente.
--   * Todo el acceso pasa por funciones RPC (security definer) que
--     validan código de sala, nombre y token de sesión.
--   * El token de sesión (session_token) solo se devuelve a quien crea
--     o recupera su participante; nunca aparece en los listados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  -- 6 caracteres sin ambiguos (sin 0, O, 1, I, L)
  code          text not null unique check (code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  -- waiting: sala de espera · in_progress: retro en curso (módulo 2) · finished
  status        text not null default 'waiting'
                check (status in ('waiting', 'in_progress', 'finished')),
  -- Reservado para los próximos módulos (fase actual, configuración de la dinámica)
  current_phase text,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);

create table if not exists public.participants (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 30),
  role           text not null check (role in ('po', 'collaborator')),
  session_token  uuid not null default gen_random_uuid(),
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  left_at        timestamptz
);

-- Un nombre por sala (sin distinguir mayúsculas): el nombre es la identidad.
create unique index if not exists participants_room_name_key
  on public.participants (room_id, lower(name));

-- Nunca más de un PO por sala.
create unique index if not exists participants_one_po_per_room
  on public.participants (room_id) where role = 'po';

create index if not exists participants_room_idx on public.participants (room_id);

alter table public.rooms        enable row level security;
alter table public.participants enable row level security;

-- Sin acceso directo a las tablas desde el navegador.
revoke all on table public.rooms, public.participants from anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers internos (no expuestos)
-- ---------------------------------------------------------------------
create or replace function public._rf_normalize_name(p_name text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
$$;

create or replace function public._rf_normalize_code(p_code text)
returns text language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
$$;

-- Código aleatorio de 6 caracteres con aleatoriedad criptográfica (gen_random_uuid).
create or replace function public._rf_generate_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  result text := '';
begin
  for i in 0..5 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

create or replace function public._rf_room_json(r public.rooms)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'status', r.status,
    'currentPhase', r.current_phase,
    'createdAt', r.created_at,
    'startedAt', r.started_at,
    'finishedAt', r.finished_at,
    'poName', (select p.name from public.participants p where p.room_id = r.id and p.role = 'po')
  );
$$;

create or replace function public._rf_participant_json(p public.participants)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'role', p.role,
    'joinedAt', p.joined_at
  );
$$;

-- Valida (participante, token) y devuelve el participante. Lanza SESSION_INVALID.
create or replace function public._rf_auth(p_participant_id uuid, p_token uuid)
returns public.participants language plpgsql stable security definer set search_path = public as $$
declare
  p public.participants;
begin
  select * into p from public.participants
   where id = p_participant_id and session_token = p_token;
  if not found then
    raise exception using message = 'SESSION_INVALID', errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- Tiempo durante el cual un participante se considera "activo" desde su último latido.
create or replace function public._rf_active_window()
returns interval language sql immutable as $$ select interval '90 seconds' $$;

-- ---------------------------------------------------------------------
-- RPC públicas
-- ---------------------------------------------------------------------

-- Crear sala: genera código único, registra al creador como PO.
create or replace function public.create_room(p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := public._rf_normalize_name(p_name);
  r public.rooms;
  p public.participants;
  attempts int := 0;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception using message = 'INVALID_NAME', errcode = 'P0001';
  end if;

  loop
    attempts := attempts + 1;
    begin
      insert into public.rooms (code) values (public._rf_generate_code()) returning * into r;
      exit;
    exception when unique_violation then
      if attempts >= 20 then
        raise exception using message = 'CODE_GENERATION_FAILED', errcode = 'P0001';
      end if;
    end;
  end loop;

  insert into public.participants (room_id, name, role)
  values (r.id, v_name, 'po')
  returning * into p;

  return jsonb_build_object(
    'room', public._rf_room_json(r),
    'participant', public._rf_participant_json(p),
    'token', p.session_token,
    'reconnected', false
  );
end;
$$;

-- Ingresar a una sala. Si el nombre ya existe en la sala, se recupera ese
-- participante (mismo rol, incluido PO), salvo que esté conectado ahora mismo.
create or replace function public.join_room(p_code text, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_code text := public._rf_normalize_code(p_code);
  v_name text := public._rf_normalize_name(p_name);
  r public.rooms;
  p public.participants;
  v_reconnected boolean := false;
begin
  if v_code !~ '^[A-Z0-9]{6}$' then
    raise exception using message = 'INVALID_CODE', errcode = 'P0001';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 30 then
    raise exception using message = 'INVALID_NAME', errcode = 'P0001';
  end if;

  select * into r from public.rooms where code = v_code;
  if not found then
    raise exception using message = 'ROOM_NOT_FOUND', errcode = 'P0001';
  end if;
  if r.status = 'finished' then
    raise exception using message = 'ROOM_FINISHED', errcode = 'P0001';
  end if;

  insert into public.participants (room_id, name, role)
  values (r.id, v_name, 'collaborator')
  on conflict (room_id, lower(name)) do nothing
  returning * into p;

  if p.id is null then
    -- El nombre ya existe en la sala → recuperar identidad.
    select * into p from public.participants
     where room_id = r.id and lower(name) = lower(v_name)
     for update;

    if p.left_at is null and p.last_seen_at > now() - public._rf_active_window() then
      raise exception using message = 'NAME_IN_USE', errcode = 'P0001';
    end if;

    update public.participants
       set left_at = null, last_seen_at = now()
     where id = p.id
    returning * into p;
    v_reconnected := true;
  end if;

  return jsonb_build_object(
    'room', public._rf_room_json(r),
    'participant', public._rf_participant_json(p),
    'token', p.session_token,
    'reconnected', v_reconnected
  );
end;
$$;

-- Recuperar la sesión guardada en el navegador (recarga de página).
create or replace function public.resume_session(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id;
  if r.status <> 'finished' then
    update public.participants set left_at = null, last_seen_at = now()
     where id = p.id returning * into p;
  end if;
  return jsonb_build_object(
    'room', public._rf_room_json(r),
    'participant', public._rf_participant_json(p),
    'token', p.session_token,
    'reconnected', true
  );
end;
$$;

-- Estado de la sala + participantes activos. También funciona como latido.
create or replace function public.get_room_state(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
  r public.rooms;
begin
  select * into r from public.rooms where id = p.room_id;
  if r.status <> 'finished' then
    update public.participants set last_seen_at = now(), left_at = null where id = p.id;
  end if;
  return jsonb_build_object(
    'room', public._rf_room_json(r),
    'participants', coalesce((
      select jsonb_agg(public._rf_participant_json(x)
                       order by (x.role = 'po') desc, x.joined_at)
        from public.participants x
       where x.room_id = r.id and x.left_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- Abandonar la sala voluntariamente.
create or replace function public.leave_room(p_participant_id uuid, p_token uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
begin
  update public.participants set left_at = now() where id = p.id;
end;
$$;

-- Finalizar la sala (solo PO). Una sala finalizada no admite nuevos ingresos.
create or replace function public.finish_room(p_participant_id uuid, p_token uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth(p_participant_id, p_token);
  r public.rooms;
begin
  if p.role <> 'po' then
    raise exception using message = 'NOT_PO', errcode = 'P0001';
  end if;
  update public.rooms set status = 'finished', finished_at = now()
   where id = p.room_id returning * into r;
  return public._rf_room_json(r);
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos: solo las RPC públicas son ejecutables desde el navegador.
-- ---------------------------------------------------------------------
revoke execute on function
  public._rf_normalize_name(text),
  public._rf_normalize_code(text),
  public._rf_generate_code(),
  public._rf_room_json(public.rooms),
  public._rf_participant_json(public.participants),
  public._rf_auth(uuid, uuid),
  public._rf_active_window(),
  public.create_room(text),
  public.join_room(text, text),
  public.resume_session(uuid, uuid),
  public.get_room_state(uuid, uuid),
  public.leave_room(uuid, uuid),
  public.finish_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_room(text),
  public.join_room(text, text),
  public.resume_session(uuid, uuid),
  public.get_room_state(uuid, uuid),
  public.leave_room(uuid, uuid),
  public.finish_room(uuid, uuid)
to anon, authenticated;

-- >>> supabase/migrations/0002_fases_tarjetas.sql
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

-- >>> supabase/migrations/0003_revision.sql
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

-- >>> supabase/migrations/0004_compromisos.sql
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

-- >>> supabase/migrations/0005_tematicas.sql
-- =====================================================================
-- Retronadas 2.0 · Temáticas (normal, halloween, argentina, mario)
-- ---------------------------------------------------------------------
-- Requiere 0001 a 0004. Ejecutar completo en Supabase → SQL Editor →
-- New query → Run. Es idempotente (si volvés a correr una migración
-- anterior, corré esta después).
--
-- La temática se guarda en rooms.settings->>'theme' y la elige el PO.
-- =====================================================================

-- Datos de la sala: igual que en 0002 + 'theme'.
create or replace function public._rf_room_json(r public.rooms)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', r.id,
    'code', r.code,
    'title', r.title,
    'theme', coalesce(r.settings ->> 'theme', 'normal'),
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

-- Elegir temática (solo PO, mientras la retro no esté cerrada).
create or replace function public.set_room_theme(p_participant_id uuid, p_token uuid, p_theme text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p public.participants := public._rf_auth_po(p_participant_id, p_token);
  r public.rooms;
begin
  if p_theme not in ('normal', 'halloween', 'argentina', 'mario') then
    raise exception using message = 'INVALID_THEME', errcode = 'P0001';
  end if;
  select * into r from public.rooms where id = p.room_id for update;
  if r.status = 'finished' then
    raise exception using message = 'ROOM_FINISHED', errcode = 'P0001';
  end if;
  update public.rooms
     set settings = settings || jsonb_build_object('theme', p_theme)
   where id = r.id;
  return public._rf_state_json(p);
end;
$$;

revoke execute on function
  public._rf_room_json(public.rooms),
  public.set_room_theme(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.set_room_theme(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
