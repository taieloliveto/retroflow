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
