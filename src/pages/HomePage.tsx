import { useState } from "react";
import { Logo } from "../components/Logo";
import { CreateRoomForm, JoinRoomForm } from "../features/rooms/components/EntryForms";
import { setPendingEntry } from "../features/rooms/pendingEntry";
import type { EnterResult } from "../features/rooms/types";
import { IdentityCard } from "../features/theme/IdentityCard";
import { THEMES } from "../features/theme/themes";
import { Link, roomPath, useRouter } from "../lib/router";

/** Portada: presentación de Retronadas y botón para empezar. */
export function HomePage() {
  const { navigate } = useRouter();
  return (
    <div className="page home theme theme-normal">
      <header className="topbar">
        <Logo size={44} />
      </header>

      <main className="landing">
        <section className="landing__text">
          <span className="landing__badge">Retrospectivas que se disfrutan</span>
          <h1 className="hero__title">
            Las mejores mejoras empiezan con una <span className="hl">conversación</span>
          </h1>
          <p className="hero__subtitle">Un espacio para compartir, reflexionar y construir mejores equipos.</p>
          <ul className="landing__steps">
            <li>
              <span>1</span> Creás la sala y compartís el código
            </li>
            <li>
              <span>2</span> Cada uno escribe qué destacar, mejorar y mantener
            </li>
            <li>
              <span>3</span> Lo revisan juntos y definen compromisos
            </li>
          </ul>
          <button className="btn btn--primary btn--xl" onClick={() => navigate("/empezar")} data-testid="vamos">
            ¡Vamos!
          </button>
        </section>

        <section className="landing__art" aria-hidden="true">
          <IdentityCard phase="destacar" className="fan fan--1" />
          <IdentityCard phase="mejorar" className="fan fan--2" />
          <IdentityCard phase="mantener" className="fan fan--3" />
        </section>
      </main>

      <footer className="footer">Retronadas 2.0 · Retrospectivas colaborativas para equipos ágiles</footer>
    </div>
  );
}

/** Segunda vista: crear una retrospectiva o ingresar a una existente. */
export function StartPage() {
  const { navigate } = useRouter();
  const [creating, setCreating] = useState(false);

  const onEntered = (r: EnterResult) => {
    setPendingEntry(r);
    navigate(roomPath(r.room.code));
  };

  return (
    <div className="page home theme theme-normal">
      <header className="topbar">
        <Link to="/">
          <Logo size={44} />
        </Link>
        <Link to="/" className="btn btn--ghost btn--sm">
          ← Volver
        </Link>
      </header>

      <main className="home__main">
        <h1 className="start__title">¿Qué querés hacer?</h1>
        <section className="actions">
          <article className="action-card action-card--create">
            <img className="action-card__char" src={THEMES.normal.alt} alt="" draggable={false} />
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
                    <strong>Sos el PO</strong>: elegís la temática y guiás la retro.
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
            <img className="action-card__char" src={THEMES.normal.characters.mantener} alt="" draggable={false} />
            <h2 className="action-card__title">Ingresar a una retrospectiva</h2>
            <p className="action-card__text">¿Te pasaron un código? Sumate a la sala de tu equipo.</p>
            <JoinRoomForm onEntered={onEntered} />
          </article>
        </section>
      </main>

      <footer className="footer">Retronadas 2.0 · Retrospectivas colaborativas para equipos ágiles</footer>
    </div>
  );
}
