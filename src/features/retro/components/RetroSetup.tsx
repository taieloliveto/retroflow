import { useCallback, useEffect, useRef, useState } from "react";
import { RoomError } from "../../rooms/api";
import type { PhaseId } from "../../rooms/types";
import type { RoomLive } from "../../rooms/useRoomLive";
import { retroApi } from "../api";
import { PHASES } from "../phases";

/**
 * Configuración previa (solo PO): nombre de la retro y duración de cada fase.
 * Se guarda sola en la sala (con una pequeña demora) y es igual para todos.
 * Devuelve `flush` para asegurar que lo último quedó guardado antes de iniciar.
 */
export function useRetroSetup(live: RoomLive) {
  const [title, setTitle] = useState(live.room.title ?? "");
  const [minutes, setMinutes] = useState<Record<PhaseId, number>>(() => ({
    destacar: Math.round(live.room.durations.destacar / 60),
    mejorar: Math.round(live.room.durations.mejorar / 60),
    mantener: Math.round(live.room.durations.mantener / 60),
  }));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ title, minutes });
  latest.current = { title, minutes };

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    const { title: t, minutes: m } = latest.current;
    try {
      await live.runAction(() =>
        retroApi.configure(live.session, t, {
          destacar: m.destacar * 60,
          mejorar: m.mejorar * 60,
          mantener: m.mantener * 60,
        }),
      );
      live.channel.send("room:updated", { status: "waiting" }).catch(() => undefined);
      setSaveState("saved");
      setError(null);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof RoomError ? e.message : "No pudimos guardar la configuración.");
      throw e;
    }
  }, [live]);

  const schedule = () => {
    dirty.current = true;
    setSaveState("idle");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save().catch(() => undefined), 700);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    title,
    minutes,
    saveState,
    error,
    setTitle: (v: string) => {
      setTitle(v);
      schedule();
    },
    setPhaseMinutes: (id: PhaseId, v: number) => {
      setMinutes((m) => ({ ...m, [id]: Math.min(60, Math.max(1, v)) }));
      schedule();
    },
    flush: save,
  };
}

export type RetroSetupState = ReturnType<typeof useRetroSetup>;

export function RetroSetupForm({ setup }: { setup: RetroSetupState }) {
  return (
    <div className="setup" data-testid="retro-setup">
      <label className="field">
        <span className="field__label">Nombre de la retrospectiva</span>
        <input
          className="input"
          value={setup.title}
          onChange={(e) => setup.setTitle(e.target.value)}
          placeholder="Ej.: Sprint 42 · Equipo Fulfillment"
          maxLength={60}
        />
      </label>

      <div className="field">
        <span className="field__label">Tiempo por fase</span>
        <ul className="durations">
          {PHASES.map((p) => (
            <li key={p.id} className={`durations__row tone-${p.tone}`}>
              <span className="durations__name">
                <span className="durations__dot" />
                {p.name}
              </span>
              <span className="stepper-input">
                <button
                  type="button"
                  aria-label={`Restar un minuto a ${p.name}`}
                  onClick={() => setup.setPhaseMinutes(p.id, setup.minutes[p.id] - 1)}
                  disabled={setup.minutes[p.id] <= 1}
                >
                  −
                </button>
                <span className="stepper-input__value" data-testid={`dur-${p.id}`}>
                  {setup.minutes[p.id]} min
                </span>
                <button
                  type="button"
                  aria-label={`Sumar un minuto a ${p.name}`}
                  onClick={() => setup.setPhaseMinutes(p.id, setup.minutes[p.id] + 1)}
                  disabled={setup.minutes[p.id] >= 60}
                >
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className={`setup__status setup__status--${setup.saveState}`}>
        {setup.saveState === "saving"
          ? "Guardando…"
          : setup.saveState === "saved"
            ? "✓ Configuración guardada"
            : setup.saveState === "error"
              ? setup.error
              : "Los cambios se guardan solos."}
      </p>
    </div>
  );
}
