import { useState } from "react";
import { Avatar } from "../../../components/Avatar";
import { Logo } from "../../../components/Logo";
import { useToast } from "../../../components/Toasts";
import { copyText, formatDateTime, inviteLink } from "../../../lib/clipboard";
import { RoomError } from "../api";
import type { RoomLive } from "../useRoomLive";
import { retroApi } from "../../retro/api";
import { PHASES } from "../../retro/phases";
import { RetroSetupForm, useRetroSetup } from "../../retro/components/RetroSetup";

export function WaitingRoom({ live, onLeave }: { live: RoomLive; onLeave: () => void }) {
  const toast = useToast();
  const { room, participants, me, isPO, isOnline, connectedCount, connection } = live;

  const copy = async (text: string, okMsg: string) => {
    const ok = await copyText(text);
    toast(ok ? "success" : "error", ok ? okMsg : "No pudimos copiar. Copialo manualmente.");
  };

  return (
    <div className="page room">
      <header className="room-bar">
        <div className="room-bar__brand">
          <Logo size={32} />
          <span className="status-pill">
            <span className="status-pill__pulse" />
            Esperando participantes
          </span>
        </div>

        <div className="room-bar__code">
          <span className="room-bar__code-label">Código de sala</span>
          <span className="code-chip" data-testid="room-code">{room.code}</span>
          <button className="btn btn--soft btn--sm" onClick={() => copy(room.code, "Código copiado")}>
            <CopyIcon /> Copiar código
          </button>
          <button className="btn btn--soft btn--sm" onClick={() => copy(inviteLink(room.code), "Enlace de invitación copiado")}>
            <LinkIcon /> Copiar enlace
          </button>
        </div>

        <div className="room-bar__end">
          <ConnectionBadge status={connection} />
          <LeaveButton onConfirm={onLeave} />
        </div>
      </header>

      {connection !== "online" && (
        <div className="banner" role="status">
          <span className="spinner spinner--sm" /> Reconectando con la sala… tus datos están a salvo.
        </div>
      )}

      <main className="room__grid">
        <div className="room__main">
          <section className="welcome">
            <div className="welcome__art" aria-hidden="true">
              <span className="note note--1" />
              <span className="note note--2" />
              <span className="note note--3" />
            </div>
            <div>
              <h1 className="welcome__title">¡Ya estamos preparando la retrospectiva!</h1>
              <p className="welcome__text">Compartí el código con tu equipo para que todos puedan sumarse.</p>
            </div>
          </section>

          <section className="people">
            <div className="people__head">
              <h2 className="section-title">Participantes</h2>
              <span className="counter" data-testid="connected-count">
                <strong>{connectedCount}</strong> {connectedCount === 1 ? "conectado" : "conectados"}
                {participants.length !== connectedCount && <span className="muted"> · {participants.length} en la sala</span>}
              </span>
            </div>

            <ul className="people__grid" data-testid="participants">
              {participants.map((p) => {
                const online = isOnline(p.id);
                return (
                  <li key={p.id} className={`person ${online ? "" : "person--offline"} ${p.id === me.id ? "person--me" : ""}`}>
                    <Avatar name={p.name} size={52} online={online} />
                    <div className="person__info">
                      <span className="person__name">
                        {p.name}
                        {p.id === me.id && <span className="person__you"> (vos)</span>}
                      </span>
                      <span className={`person__status ${online ? "is-online" : ""}`}>{online ? "Conectado" : "Desconectado"}</span>
                    </div>
                    {p.role === "po" && <span className="role-tag">PO</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <aside className="room__aside">
          {isPO && <PoPanel live={live} />}

          <section className="card info">
            <h2 className="section-title">Información de la reunión</h2>
            <dl className="info__list">
              {room.title && (
                <div>
                  <dt>Retrospectiva</dt>
                  <dd data-testid="info-title">{room.title}</dd>
                </div>
              )}
              <div>
                <dt>Código de acceso</dt>
                <dd className="mono">{room.code}</dd>
              </div>
              <div>
                <dt>Participantes conectados</dt>
                <dd>{connectedCount}</dd>
              </div>
              <div>
                <dt>Creada</dt>
                <dd>{formatDateTime(room.createdAt)}</dd>
              </div>
              <div>
                <dt>PO</dt>
                <dd className="info__po">
                  {room.poName ? <Avatar name={room.poName} size={24} /> : null}
                  {room.poName ?? "—"}
                </dd>
              </div>
              <div>
                <dt>Tiempos</dt>
                <dd className="info__durations" data-testid="info-durations">
                  {PHASES.map((p) => (
                    <span key={p.id} className={`tone-${p.tone}`}>
                      {p.name} {Math.round(room.durations[p.id] / 60)}′
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </main>
    </div>
  );
}

function PoPanel({ live }: { live: RoomLive }) {
  const toast = useToast();
  const setup = useRetroSetup(live);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    try {
      await setup.flush(); // guarda la configuración pendiente antes de iniciar
      await live.runAction(() => retroApi.start(live.session));
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos iniciar la retrospectiva.");
      setStarting(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await live.finish();
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos finalizar la sala.");
      setBusy(false);
      setConfirmFinish(false);
    }
  };

  return (
    <section className="card po-panel" data-testid="po-panel">
      <span className="po-panel__tag">★ Sos el PO de esta retrospectiva</span>
      <div className="po-panel__count">
        <strong>{live.connectedCount}</strong>
        <span>{live.connectedCount === 1 ? "persona conectada" : "personas conectadas"}</span>
      </div>

      <RetroSetupForm setup={setup} />

      <button className="btn btn--primary btn--block btn--lg" onClick={start} disabled={starting}>
        {starting ? <span className="spinner" /> : null}
        {starting ? "Iniciando…" : "Iniciar retrospectiva"}
      </button>

      {confirmFinish ? (
        <div className="confirm">
          <p>¿Finalizar la sala? Nadie más va a poder ingresar.</p>
          <div className="confirm__actions">
            <button className="btn btn--danger btn--sm" onClick={finish} disabled={busy}>
              {busy ? "Finalizando…" : "Sí, finalizar"}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirmFinish(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button className="link-btn" onClick={() => setConfirmFinish(true)}>
          Finalizar sala
        </button>
      )}
    </section>
  );
}

function LeaveButton({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className="btn btn--ghost btn--sm" onClick={() => setAsking(true)}>
        Salir
      </button>
    );
  return (
    <span className="leave-confirm">
      <span>¿Salir de la sala?</span>
      <button className="btn btn--danger btn--sm" onClick={onConfirm}>
        Salir
      </button>
      <button className="btn btn--ghost btn--sm" onClick={() => setAsking(false)}>
        Cancelar
      </button>
    </span>
  );
}

function ConnectionBadge({ status }: { status: "connecting" | "online" | "offline" }) {
  const label = status === "online" ? "En línea" : status === "connecting" ? "Conectando…" : "Sin conexión";
  return <span className={`conn conn--${status}`}>{label}</span>;
}

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
