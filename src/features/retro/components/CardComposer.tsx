import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useToast } from "../../../components/Toasts";
import { RoomError } from "../../rooms/api";
import type { PhaseId } from "../../rooms/types";
import type { RoomLive } from "../../rooms/useRoomLive";
import { newClientId, retroApi } from "../api";

const TITLE_MAX = 120;
const BODY_MAX = 2000;

export function CardComposer({ live, phase, myCount }: { live: RoomLive; phase: PhaseId; myCount: number }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // El anonimato se elige por tarjeta; se recuerda la última elección para comodidad.
  const [anonymous, setAnonymous] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mismo id mientras el borrador no se guarde: un reintento no duplica la tarjeta.
  const clientId = useRef(newClientId());
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError("Agregale un título a tu tarjeta.");
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await live.runAction(() =>
        retroApi.addCard(live.session, { phase, title, body, anonymous, clientId: clientId.current }),
      );
      live.channel.send("cards:changed", {}).catch(() => undefined);
      clientId.current = newClientId();
      setTitle("");
      setBody("");
      toast("success", anonymous ? "Tarjeta anónima agregada" : "Tarjeta agregada con tu nombre");
      titleRef.current?.focus();
    } catch (err) {
      if (err instanceof RoomError && err.code === "PHASE_CLOSED") {
        toast("error", err.message);
        live.refresh();
      } else {
        setError(err instanceof RoomError ? err.message : "No pudimos guardar la tarjeta. Probá de nuevo.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };

  return (
    <form className="composer card" onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <div className="composer__head">
        <h2 className="section-title">Nueva tarjeta</h2>
        <span className="my-count" data-testid="my-count">
          <strong>{myCount}</strong> {myCount === 1 ? "tarjeta tuya" : "tarjetas tuyas"} en esta fase
        </span>
      </div>

      <input
        ref={titleRef}
        className="input composer__title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título de la tarjeta"
        maxLength={TITLE_MAX}
        aria-label="Título"
        disabled={busy}
        autoFocus
      />
      <div className="composer__body-wrap">
        <textarea
          className="input composer__body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escribí acá tu idea, experiencia o propuesta..."
          maxLength={BODY_MAX}
          rows={6}
          aria-label="Desarrollo"
          disabled={busy}
        />
        {body.length > BODY_MAX * 0.8 && (
          <span className="composer__counter">
            {body.length}/{BODY_MAX}
          </span>
        )}
      </div>

      <div className="composer__foot">
        <div className="segmented" role="radiogroup" aria-label="Identificación de la tarjeta">
          <button
            type="button"
            role="radio"
            aria-checked={anonymous}
            className={anonymous ? "is-on" : ""}
            onClick={() => setAnonymous(true)}
          >
            <MaskIcon /> Anónima
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!anonymous}
            className={!anonymous ? "is-on" : ""}
            onClick={() => setAnonymous(false)}
          >
            <PersonIcon /> Mostrar mi nombre
          </button>
        </div>
        <button className="btn btn--primary composer__submit" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {busy ? "Guardando…" : "+ Agregar tarjeta"}
        </button>
      </div>
      <p className="composer__hint">
        {anonymous
          ? "Nadie, ni siquiera el PO, va a poder saber que la escribiste vos."
          : `La tarjeta va a mostrar tu nombre (${live.me.name}) durante toda la retrospectiva.`}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const MaskIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M3 8c3-1 6-1 9 1 3-2 6-2 9-1-.5 5-3 8-5.5 8-1.8 0-2.6-1.6-3.5-1.6S10.3 16 8.5 16C6 16 3.5 13 3 8z" />
    <circle cx="8" cy="11" r="1" fill="currentColor" />
    <circle cx="16" cy="11" r="1" fill="currentColor" />
  </svg>
);
const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
