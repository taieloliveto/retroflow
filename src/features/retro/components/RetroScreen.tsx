import { useState } from "react";
import { Avatar } from "../../../components/Avatar";
import { Logo } from "../../../components/Logo";
import { useToast } from "../../../components/Toasts";
import { RoomError } from "../../rooms/api";
import type { PhaseId } from "../../rooms/types";
import type { RoomLive } from "../../rooms/useRoomLive";
import { retroApi } from "../api";
import { PHASES, nextPhase, phaseById } from "../phases";
import { useCountdown } from "../useCountdown";
import { CardComposer } from "./CardComposer";
import { PhaseTimer } from "./PhaseTimer";

/**
 * Pantalla de la retrospectiva en curso (status = in_progress).
 * Según la fase actual muestra: carga de tarjetas, transición o cierre de carga.
 * El módulo 3 (revisión) se conectará desde `onContinueToReview`.
 */
export function RetroScreen({ live, onLeave }: { live: RoomLive; onLeave: () => void }) {
  const toast = useToast();
  const { room } = live;
  const phase = room.currentPhase;

  // Punto de conexión con el módulo 3 (mezcla aleatoria y revisión colectiva).
  const onContinueToReview = () =>
    toast("info", "La revisión de tarjetas estará disponible en el próximo módulo de RetroFlow.");

  let content;
  if (!live.hydrated)
    content = (
      <div className="center-screen">
        <span className="spinner spinner--lg" />
        <p className="muted">Recuperando la retrospectiva…</p>
      </div>
    );
  else if (phase === "done") content = <CollectionDone live={live} onContinue={onContinueToReview} />;
  else if (!phase) content = <div className="center-screen"><span className="spinner spinner--lg" /></div>;
  else if (room.phaseStatus === "closed") content = <PhaseTransition live={live} phase={phase} />;
  else content = <PhaseBoard key={phase} live={live} phase={phase} />;

  return (
    <div className={`page retro tone-${phase && phase !== "done" ? phaseById(phase).tone : "violet"}`}>
      <RetroBar live={live} onLeave={onLeave} />
      {live.connection !== "online" && (
        <div className="banner" role="status">
          <span className="spinner spinner--sm" /> Reconectando… tus tarjetas guardadas están a salvo.
        </div>
      )}
      {content}
    </div>
  );
}

export const retroTitle = (live: RoomLive) => live.room.title ?? `Retrospectiva ${live.room.code}`;

function RetroBar({ live, onLeave }: { live: RoomLive; onLeave: () => void }) {
  const [asking, setAsking] = useState(false);
  return (
    <header className="room-bar retro-bar">
      <div className="room-bar__brand">
        <Logo size={32} />
        <div className="retro-bar__title">
          <span className="retro-bar__name" data-testid="retro-title">{retroTitle(live)}</span>
          <span className="retro-bar__meta">
            Sala <span className="mono">{live.room.code}</span> · {live.connectedCount} conectados
          </span>
        </div>
      </div>
      <PhaseStepper current={live.room.currentPhase} closed={live.room.phaseStatus === "closed"} />
      <div className="room-bar__end">
        {live.isPO && <span className="role-tag">PO</span>}
        {asking ? (
          <span className="leave-confirm">
            <span>¿Salir?</span>
            <button className="btn btn--danger btn--sm" onClick={onLeave}>
              Salir
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setAsking(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={() => setAsking(true)}>
            Salir
          </button>
        )}
      </div>
    </header>
  );
}

function PhaseStepper({ current, closed }: { current: string | null; closed: boolean }) {
  const idx = current === "done" ? 3 : PHASES.findIndex((p) => p.id === current);
  return (
    <ol className="stepper" aria-label="Fases">
      {PHASES.map((p, i) => {
        const state = i < idx || (i === idx && closed) ? "done" : i === idx ? "current" : "next";
        return (
          <li key={p.id} className={`stepper__step stepper__step--${state} tone-${p.tone}`}>
            <span className="stepper__dot">{state === "done" ? "✓" : p.number}</span>
            <span className="stepper__name">{p.name}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Fase activa: carga de tarjetas
// ---------------------------------------------------------------------------
function PhaseBoard({ live, phase }: { live: RoomLive; phase: PhaseId }) {
  const def = phaseById(phase);
  const mine = live.myCards.filter((c) => c.phase === phase);
  const prog = live.progress[phase];
  const t = useCountdown(live.room.timer, live.serverOffset);

  return (
    <main className="retro__main">
      <section className="phase-hero">
        <div className="phase-hero__text">
          <span className="phase-hero__eyebrow">
            Fase {def.number} de 3
          </span>
          <h1 className="phase-hero__name" data-testid="phase-name">{def.name}</h1>
          <p className="phase-hero__question">{def.question}</p>
        </div>
        <PhaseTimer live={live} phase={phase} />
      </section>

      {t.expired && (
        <div className="timeup" role="status" data-testid="timeup">
          <span className="timeup__icon">⏰</span>
          {live.isPO
            ? "Se cumplió el tiempo. Cuando el equipo esté listo, tocá «Finalizar fase» para pasar a la siguiente."
            : "Se cumplió el tiempo. Todavía podés agregar tarjetas hasta que el PO cierre la fase."}
        </div>
      )}

      <div className="retro__grid">
        <div className="retro__col">
          <CardComposer live={live} phase={phase} myCount={mine.length} />

          <section className="my-cards">
            <h2 className="section-title">Tus tarjetas en {def.name}</h2>
            {mine.length === 0 ? (
              <p className="empty">Todavía no agregaste tarjetas en esta fase. No es obligatorio: sumá las que quieras.</p>
            ) : (
              <ul className="card-list" data-testid="my-cards">
                {[...mine].reverse().map((c) => (
                  <li key={c.id} className="retro-card">
                    <div className="retro-card__head">
                      <h3 className="retro-card__title">{c.title}</h3>
                      <span className={`chip ${c.anonymous ? "chip--anon" : "chip--named"}`}>
                        {c.anonymous ? "Anónima" : `Con tu nombre`}
                      </span>
                    </div>
                    {c.body && <p className="retro-card__body">{c.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="retro__aside">
          <section className="card team-progress" data-testid="team-progress">
            <h2 className="section-title">Progreso del equipo</h2>
            <div className="team-progress__stats">
              <div>
                <strong data-testid="phase-total">{prog.cards}</strong>
                <span>{prog.cards === 1 ? "tarjeta en la fase" : "tarjetas en la fase"}</span>
              </div>
              <div>
                <strong>
                  {prog.contributors}
                  <small>/{live.participants.length}</small>
                </strong>
                <span>personas aportaron</span>
              </div>
            </div>
            <p className="team-progress__note">
              🔒 Las tarjetas del equipo se mantienen ocultas hasta la revisión grupal.
            </p>
            <ul className="mini-people">
              {live.participants.map((p) => (
                <li key={p.id} className={live.isOnline(p.id) ? "" : "is-offline"}>
                  <Avatar name={p.name} size={30} online={live.isOnline(p.id)} />
                  <span>{p.name}</span>
                  {p.role === "po" && <span className="role-tag role-tag--sm">PO</span>}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Transición entre fases (controlada por el PO)
// ---------------------------------------------------------------------------
function PhaseTransition({ live, phase }: { live: RoomLive; phase: PhaseId }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const def = phaseById(phase);
  const next = nextPhase(phase)!;
  const total = live.progress[phase].cards;
  const minutes = Math.round(live.room.durations[next.id] / 60);

  const start = async () => {
    setBusy(true);
    try {
      await live.runAction(() => retroApi.control(live.session, "next", phase));
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
    } catch (e) {
      if (e instanceof RoomError && e.code === "PHASE_CHANGED") live.refresh();
      else toast("error", e instanceof RoomError ? e.message : "No pudimos iniciar la fase.");
      setBusy(false);
    }
  };

  return (
    <main className="transition" data-testid="transition">
      <div className={`transition__badge tone-${def.tone}`}>✓</div>
      <h1 className="transition__title">{def.doneTitle}</h1>
      <p className="transition__line">{def.nextLine}</p>
      <p className="transition__saved">
        Se guardaron <strong>{total}</strong> {total === 1 ? "tarjeta" : "tarjetas"} en {def.name}.
      </p>

      <article className={`next-phase tone-${next.tone}`}>
        <span className="next-phase__eyebrow">
          Próxima fase · {next.number} de 3 · {minutes} min
        </span>
        <h2 className="next-phase__name">{next.name}</h2>
        <p className="next-phase__question">{next.question}</p>
      </article>

      {live.isPO ? (
        <button className="btn btn--primary btn--lg" onClick={start} disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Comenzar fase {next.name}
        </button>
      ) : (
        <p className="waiting-po">
          <span className="status-pill__pulse" /> Esperando que el PO habilite la siguiente fase…
        </p>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Fin de la carga
// ---------------------------------------------------------------------------
function CollectionDone({ live, onContinue }: { live: RoomLive; onContinue: () => void }) {
  return (
    <main className="transition done" data-testid="collection-done">
      <div className="done__burst" aria-hidden="true">
        <span className="tone-blue" />
        <span className="tone-coral" />
        <span className="tone-green" />
      </div>
      <h1 className="transition__title">¡Excelente! Ya tenemos todas las perspectivas del equipo.</h1>
      <div className="summary">
        {PHASES.map((p) => (
          <div key={p.id} className={`summary__tile tone-${p.tone}`}>
            <strong data-testid={`summary-${p.id}`}>{live.progress[p.id].cards}</strong>
            <span>tarjetas de {p.name}</span>
          </div>
        ))}
        <div className="summary__tile tone-violet">
          <strong data-testid="summary-contributors">{live.contributors}</strong>
          <span>{live.contributors === 1 ? "persona contribuyó" : "personas contribuyeron"}</span>
        </div>
      </div>
      {live.isPO ? (
        <button className="btn btn--primary btn--lg" onClick={onContinue}>
          Continuar a la revisión de tarjetas
        </button>
      ) : (
        <p className="waiting-po">
          <span className="status-pill__pulse" /> Esperando que el PO inicie la revisión de tarjetas…
        </p>
      )}
    </main>
  );
}
