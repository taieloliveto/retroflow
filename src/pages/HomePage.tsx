import { useState } from "react";
import { Logo } from "../components/Logo";
import { Avatar } from "../components/Avatar";
import { CreateRoomForm, JoinRoomForm } from "../features/rooms/components/EntryForms";
import { setPendingEntry } from "../features/rooms/pendingEntry";
import type { EnterResult } from "../features/rooms/types";
import { roomPath, useRouter } from "../lib/router";

export function HomePage() {
  const { navigate } = useRouter();
  const [creating, setCreating] = useState(false);

  const onEntered = (r: EnterResult) => {
    setPendingEntry(r);
    navigate(roomPath(r.room.code));
  };

  return (
    <div className="page home">
      <div className="bg-blobs" aria-hidden="true">
        <span className="blob blob--violet" />
        <span className="blob blob--coral" />
        <span className="blob blob--mint" />
      </div>

      <header className="topbar topbar--home">
        <Logo />
      </header>

      <main className="home__main">
        <section className="hero">
          <div className="hero__team" aria-hidden="true">
            {["Sofi Ruiz", "Mati", "Juli Paz", "Nico", "Caro Díaz"].map((n, i) => (
              <span key={n} style={{ zIndex: 10 - i }}>
                <Avatar name={n} size={40} />
              </span>
            ))}
            <span className="hero__team-label">Tu equipo, en la misma sala</span>
          </div>
          <h1 className="hero__title">
            Las mejores mejoras empiezan con una <span className="hl">conversación</span>
          </h1>
          <p className="hero__subtitle">Un espacio para compartir, reflexionar y construir mejores equipos.</p>
        </section>

        <section className="actions">
          <article className="action-card action-card--create">
            <div className="action-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
            <h2 className="action-card__title">Crear retrospectiva</h2>
            <p className="action-card__text">Abrí una sala nueva, compartí el código y facilitá la reunión como PO.</p>
            {!creating && (
              <ul className="perks">
                <li>
                  <span className="perks__icon">#</span>
                  <span>
                    <strong>Código único</strong> de 6 caracteres, fácil de dictar y compartir.
                  </span>
                </li>
                <li>
                  <span className="perks__icon">★</span>
                  <span>
                    <strong>Sos el PO</strong>: vas a ver el panel para iniciar la retro.
                  </span>
                </li>
                <li>
                  <span className="perks__icon">●</span>
                  <span>
                    <strong>En tiempo real</strong>: mirá cómo se suma tu equipo.
                  </span>
                </li>
              </ul>
            )}
            {creating ? (
              <CreateRoomForm onEntered={onEntered} />
            ) : (
              <button className="btn btn--primary btn--block" onClick={() => setCreating(true)}>
                Crear retrospectiva
              </button>
            )}
          </article>

          <article className="action-card action-card--join">
            <div className="action-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <path d="M10 17l5-5-5-5" />
                <path d="M15 12H3" />
              </svg>
            </div>
            <h2 className="action-card__title">Ingresar a una retrospectiva</h2>
            <p className="action-card__text">¿Te pasaron un código? Sumate a la sala de tu equipo.</p>
            <JoinRoomForm onEntered={onEntered} />
          </article>
        </section>
      </main>

      <footer className="footer">RetroFlow · Retrospectivas colaborativas para equipos ágiles</footer>
    </div>
  );
}
