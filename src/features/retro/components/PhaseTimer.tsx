import { useState } from "react";
import { useToast } from "../../../components/Toasts";
import { RoomError } from "../../rooms/api";
import type { PhaseId } from "../../rooms/types";
import type { RoomLive } from "../../rooms/useRoomLive";
import { retroApi, type PhaseAction } from "../api";
import { formatClock, useCountdown } from "../useCountdown";

const R = 52;
const C = 2 * Math.PI * R;

export function PhaseTimer({ live, phase }: { live: RoomLive; phase: PhaseId }) {
  const t = useCountdown(live.room.timer, live.serverOffset);
  const state = t.expired ? "expired" : t.paused ? "paused" : t.warning ? "warning" : "running";
  const label =
    state === "expired" ? "Tiempo cumplido" : state === "paused" ? "En pausa" : state === "warning" ? "¡Último minuto!" : "Tiempo restante";

  return (
    <div className={`timer timer--${state}`} data-testid="timer" data-state={state}>
      <div className="timer__ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="timer__track" cx="60" cy="60" r={R} />
          <circle
            className="timer__bar"
            cx="60"
            cy="60"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - t.fraction)}
          />
        </svg>
        <div className="timer__text">
          <span className="timer__clock" data-testid="timer-clock">
            {formatClock(t.remainingMs)}
          </span>
          <span className="timer__label">{label}</span>
        </div>
      </div>
      {live.isPO && <TimerControls live={live} phase={phase} paused={t.paused} expired={t.expired} />}
    </div>
  );
}

function TimerControls({ live, phase, paused, expired }: { live: RoomLive; phase: PhaseId; paused: boolean; expired: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const act = async (action: PhaseAction, seconds?: number) => {
    setBusy(true);
    try {
      await live.runAction(() => retroApi.control(live.session, action, phase, seconds));
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
      if (action === "extend") toast("success", `Sumaste ${seconds! / 60} min a la fase`);
    } catch (e) {
      if (e instanceof RoomError && e.code === "PHASE_CHANGED") live.refresh();
      else toast("error", e instanceof RoomError ? e.message : "No pudimos aplicar el cambio.");
    } finally {
      setBusy(false);
      setConfirmClose(false);
    }
  };

  return (
    <div className="timer-controls" data-testid="timer-controls">
      <div className="timer-controls__row">
        {paused ? (
          <button className="btn btn--soft btn--sm" onClick={() => act("resume")} disabled={busy}>
            ▶ Reanudar
          </button>
        ) : (
          <button className="btn btn--soft btn--sm" onClick={() => act("pause")} disabled={busy || expired}>
            ❚❚ Pausar
          </button>
        )}
        <button className="btn btn--soft btn--sm" onClick={() => act("extend", 60)} disabled={busy}>
          +1 min
        </button>
        <button className="btn btn--soft btn--sm" onClick={() => act("extend", 180)} disabled={busy}>
          +3 min
        </button>
      </div>
      {confirmClose ? (
        <div className="confirm confirm--inline">
          <p>¿Cerrar la fase? Nadie más podrá agregar tarjetas en ella.</p>
          <div className="confirm__actions">
            <button className="btn btn--dark btn--sm" onClick={() => act("close")} disabled={busy}>
              Sí, cerrar fase
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClose(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          className={`btn btn--block btn--sm ${expired ? "btn--primary btn--attention" : "btn--ghost"}`}
          onClick={() => setConfirmClose(true)}
          disabled={busy}
        >
          Finalizar fase
        </button>
      )}
    </div>
  );
}
