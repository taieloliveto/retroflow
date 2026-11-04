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
