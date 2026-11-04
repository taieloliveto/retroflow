import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { CharacterTrio } from "../theme/IdentityCard";
import { themeOf } from "../theme/themes";
import { Avatar } from "../../components/Avatar";
import { useToast } from "../../components/Toasts";
import { RoomError } from "../rooms/api";
import type { PhaseId, ReviewCard, ReviewState } from "../rooms/types";
import type { RoomLive } from "../rooms/useRoomLive";
import { retroApi, type ReviewAction } from "../retro/api";
import { PHASES, nextPhase, phaseById } from "../retro/phases";
import { cardsOf, firstPending, rank, statsFor, type ReviewStats } from "./stats";

/**
 * Módulo 3 · Revisión de tarjetas.
 * Todo lo que se ve (categoría, tarjeta, orden, estados, notas, marca de
 * acción) sale del estado compartido de la sala: todos ven lo mismo.
 * Solo el PO navega y registra; el resto mira.
 */
export function ReviewScreen({ live, onContinue }: { live: RoomLive; onContinue: () => Promise<void> | void }) {
  const review = live.review;
  const flushNotes = useRef<() => Promise<void>>(async () => undefined);
  const nav = useReviewNav(live, flushNotes);

  if (!review) return null;
  if (live.room.currentPhase === "review_done") return <ReviewDone live={live} review={review} nav={nav} onContinue={onContinue} />;

  const card = review.cards.find((c) => c.id === review.cardId) ?? null;
  return (
    <main className="review" data-testid="review">
      <ReviewHeader live={live} review={review} nav={nav} />
      {card ? (
        <CardView key={card.id} live={live} review={review} card={card} nav={nav} flushNotes={flushNotes} />
      ) : (
        <CategorySummary live={live} review={review} nav={nav} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Navegación del PO
// ---------------------------------------------------------------------------
type Nav = ReturnType<typeof useReviewNav>;

function useReviewNav(live: RoomLive, flushNotes: MutableRefObject<() => Promise<void>>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const go = useCallback(
    async (action: ReviewAction, target?: string) => {
      const review = live.review;
      if (!review || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await flushNotes.current().catch(() => undefined); // las notas se guardan antes de moverse
        await live.runAction(() =>
          retroApi.reviewNavigate(live.session, action, review.category, review.cardId, target),
        );
        await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
      } catch (e) {
        if (e instanceof RoomError && e.code === "REVIEW_CHANGED") live.refresh();
        else toast("error", e instanceof RoomError ? e.message : "No pudimos cambiar de tarjeta.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [live, flushNotes, toast],
  );

  return { go, busy };
}

// ---------------------------------------------------------------------------
// Encabezado: categoría, avance y mapa de tarjetas
// ---------------------------------------------------------------------------
function ReviewHeader({ live, review, nav }: { live: RoomLive; review: ReviewState; nav: Nav }) {
  const def = phaseById(review.category);
  const list = cardsOf(review, review.category);
  const idx = list.findIndex((c) => c.id === review.cardId);
  const st = statsFor(list);
  const behind = rank(review.category) < rank(review.reached);
  const backTarget = behind ? firstPending(review, review.reached) ?? cardsOf(review, review.reached)[0] : null;

  return (
    <section className="review-head">
      <div className="review-head__top">
        <div>
          <span className="review-head__eyebrow">Revisión · Categoría {def.number} de 3</span>
          <h1 className="review-head__name" data-testid="review-category">{def.name}</h1>
        </div>
        <div className="review-head__count">
          {idx >= 0 ? (
            <>
              <strong data-testid="review-position">
                {idx + 1} / {list.length}
              </strong>
              <span>tarjeta en pantalla</span>
            </>
          ) : (
            <>
              <strong>{list.length}</strong>
              <span>{list.length === 1 ? "tarjeta" : "tarjetas"}</span>
            </>
          )}
        </div>
      </div>

      <div className="review-head__progress">
        <ol className="dots" aria-label="Avance de la categoría" data-testid="review-dots">
          {list.map((c, i) => {
            const label = `Tarjeta ${i + 1}: ${STATUS_LABEL[c.status]}${c.needsAction ? " · Generar acción" : ""}`;
            const cls = `dot dot--${c.status} ${c.id === review.cardId ? "is-current" : ""} ${c.needsAction ? "has-action" : ""}`;
            return (
              <li key={c.id}>
                {live.isPO ? (
                  <button className={cls} title={label} aria-label={label} onClick={() => nav.go("goto", c.id)} disabled={nav.busy || c.id === review.cardId}>
                    {i + 1}
                  </button>
                ) : (
                  <span className={cls} title={label}>
                    {i + 1}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="review-head__legend">
          <span>
            <i className="dot dot--reviewed" /> {st.reviewed} revisadas
          </span>
          <span>
            <i className="dot dot--pending" /> {st.pending} pendientes
          </span>
          <span>
            <i className="dot dot--reviewed has-action" /> {st.actions} para acción
          </span>
        </p>
      </div>

      {live.isPO && backTarget && (
        <button className="btn btn--ghost btn--sm review-head__back" onClick={() => nav.go("goto", backTarget.id)} disabled={nav.busy}>
          Volver a {phaseById(review.reached).name} →
        </button>
      )}
    </section>
  );
}

const STATUS_LABEL: Record<ReviewCard["status"], string> = {
  pending: "Pendiente de revisión",
  in_review: "En revisión",
  reviewed: "Revisada",
};

// ---------------------------------------------------------------------------
// Tarjeta en pantalla
// ---------------------------------------------------------------------------
function CardView({
  live,
  review,
  card,
  nav,
  flushNotes,
}: {
  live: RoomLive;
  review: ReviewState;
  card: ReviewCard;
  nav: Nav;
  flushNotes: MutableRefObject<() => Promise<void>>;
}) {
  const def = phaseById(card.phase);
  const list = cardsOf(review, review.category);
  const isFirst = list[0]?.id === card.id;
  const isLast = list[list.length - 1]?.id === card.id;
  const pendingElsewhere = firstPending(review);

  // Atajos de teclado para el PO (fuera de campos de texto).
  useEffect(() => {
    if (!live.isPO) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowRight") nav.go("next");
      if (e.key === "ArrowLeft" && !isFirst) nav.go("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live.isPO, nav, isFirst]);

  return (
    <div className="review__grid">
      <div className="review__stage">
        <article className={`big-card tone-${def.tone}`} data-testid="review-card">
          <img className="big-card__char" src={themeOf(live.room.theme).characters[card.phase]} alt="" draggable={false} />
          <header className="big-card__head">
            <span className="big-card__cat">{def.name}</span>
            <span className={`status-chip status-chip--${card.status}`} data-testid="card-status">
              {STATUS_LABEL[card.status]}
            </span>
            {card.needsAction && (
              <span className="action-flag" data-testid="action-flag">
                ⚑ Generar acción
              </span>
            )}
          </header>
          <h2 className="big-card__title" data-testid="card-title">{card.title}</h2>
          {card.body && <p className="big-card__body">{card.body}</p>}
          <footer className="big-card__author" data-testid="card-author">
            {card.anonymous || !card.authorName ? (
              <>
                <span className="anon-avatar" aria-hidden="true">
                  ?
                </span>
                Anónimo
              </>
            ) : (
              <>
                <Avatar name={card.authorName} size={32} />
                {card.authorName}
              </>
            )}
          </footer>
        </article>

        {live.isPO ? (
          <div className="review-controls" data-testid="review-controls">
            <button className="btn btn--ghost" onClick={() => nav.go("prev")} disabled={nav.busy || isFirst}>
              ← Anterior
            </button>
            <button className="btn btn--soft" onClick={() => nav.go("skip")} disabled={nav.busy} title="Queda pendiente para retomarla después">
              Saltar
            </button>
            <button className="btn btn--primary" onClick={() => nav.go("next")} disabled={nav.busy}>
              {isLast ? "Revisada · ver resumen" : "Revisada · siguiente →"}
            </button>
            <ActionToggle live={live} card={card} />
            {pendingElsewhere && (
              <button className="link-btn link-btn--neutral" onClick={() => nav.go("goto", pendingElsewhere.id)} disabled={nav.busy}>
                Retomar una pendiente
              </button>
            )}
          </div>
        ) : (
          <p className="review-watch">
            <span className="status-pill__pulse" /> El PO guía la revisión. Todos están viendo esta tarjeta.
          </p>
        )}
      </div>

      <Accionables live={live} card={card} flushNotes={flushNotes} />
    </div>
  );
}

function ActionToggle({ live, card }: { live: RoomLive; card: ReviewCard }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await live.runAction(() => retroApi.updateCardReview(live.session, card.id, { needsAction: !card.needsAction }));
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos guardar la marca.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className={`toggle ${card.needsAction ? "is-on" : ""}`}
      role="switch"
      aria-checked={card.needsAction}
      onClick={toggle}
      disabled={busy}
      data-testid="action-toggle"
    >
      <span className="toggle__track">
        <span className="toggle__thumb" />
      </span>
      Generar acción
    </button>
  );
}

// ---------------------------------------------------------------------------
// Accionables (solo el PO escribe; se guarda solo)
// ---------------------------------------------------------------------------
function Accionables({
  live,
  card,
  flushNotes,
}: {
  live: RoomLive;
  card: ReviewCard;
  flushNotes: MutableRefObject<() => Promise<void>>;
}) {
  const [text, setText] = useState(card.notes);
  const [state, setState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const dirty = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const timer = useRef<number | undefined>(undefined);
  const cardId = card.id;
  // Ref estable: `live` cambia en cada render y no debe disparar guardados.
  const liveRef = useRef(live);
  liveRef.current = live;

  // Cambios que llegan del servidor (otra pestaña del PO, recarga) si no hay edición en curso.
  useEffect(() => {
    if (!dirty.current) setText(card.notes);
  }, [card.notes]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setState("saving");
    const lv = liveRef.current;
    try {
      await lv.runAction(() => retroApi.updateCardReview(lv.session, cardId, { notes: textRef.current }));
      await lv.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
      setState(dirty.current ? "dirty" : "saved");
    } catch {
      dirty.current = true;
      setState("error");
    }
  }, [cardId]);

  useEffect(() => {
    flushNotes.current = save;
    return () => {
      // Al cambiar de tarjeta se guarda lo pendiente.
      if (dirty.current) save();
      flushNotes.current = async () => undefined;
    };
  }, [save, flushNotes]);

  if (!live.isPO) {
    return (
      <aside className="card accionables" data-testid="accionables">
        <h3 className="section-title">Accionables</h3>
        {card.notes ? (
          <p className="accionables__read" data-testid="notes-read">
            {card.notes}
          </p>
        ) : (
          <p className="accionables__empty">El PO todavía no registró accionables para esta tarjeta.</p>
        )}
        <p className="accionables__hint">Solo el PO puede editar este espacio.</p>
      </aside>
    );
  }

  return (
    <aside className="card accionables" data-testid="accionables">
      <div className="accionables__head">
        <h3 className="section-title">Accionables</h3>
        <span className={`save-state save-state--${state}`} data-testid="notes-state">
          {state === "saving"
            ? "Guardando…"
            : state === "saved"
              ? "✓ Guardado"
              : state === "dirty"
                ? "Sin guardar"
                : state === "error"
                  ? "No se pudo guardar"
                  : ""}
        </span>
      </div>
      <textarea
        className="input accionables__input"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          dirty.current = true;
          setState("dirty");
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(save, 900);
        }}
        onBlur={() => save()}
        placeholder="Qué surgió de esta tarjeta, ideas, próximos pasos…"
        maxLength={4000}
        rows={9}
        aria-label="Accionables"
      />
      <div className="accionables__foot">
        <span className="accionables__hint">Se guarda solo. El equipo lo ve en tiempo real.</span>
        <button className="btn btn--soft btn--sm" onClick={() => save()} disabled={state !== "dirty" && state !== "error"}>
          Guardar
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Resumen de categoría
// ---------------------------------------------------------------------------
function StatTiles({ st, testid }: { st: ReviewStats; testid?: string }) {
  return (
    <div className="summary review-stats" data-testid={testid}>
      <div className="summary__tile tone-violet">
        <strong data-testid="st-total">{st.total}</strong>
        <span>tarjetas</span>
      </div>
      <div className="summary__tile tone-mustard">
        <strong data-testid="st-reviewed">{st.reviewed}</strong>
        <span>revisadas</span>
      </div>
      <div className="summary__tile tone-coral">
        <strong data-testid="st-pending">{st.pending}</strong>
        <span>pendientes</span>
      </div>
      <div className="summary__tile tone-teal">
        <strong data-testid="st-actions">{st.actions}</strong>
        <span>para generar acción</span>
      </div>
    </div>
  );
}

function CategorySummary({ live, review, nav }: { live: RoomLive; review: ReviewState; nav: Nav }) {
  const def = phaseById(review.category);
  const next = nextPhase(review.category);
  const st = statsFor(cardsOf(review, review.category));
  const pending = firstPending(review, review.category);

  return (
    <section className="transition review-summary" data-testid="category-summary">
      <img className="transition__char" src={themeOf(live.room.theme).characters[review.category]} alt="" draggable={false} />
      <h2 className="transition__title">
        {st.total === 0 ? `No hubo tarjetas en ${def.name}` : `Terminamos de revisar ${def.name}`}
      </h2>
      <StatTiles st={st} />
      {live.isPO ? (
        <div className="review-summary__actions">
          {next ? (
            <button className="btn btn--primary btn--lg" onClick={() => nav.go("next_category")} disabled={nav.busy}>
              Continuar con {next.name}
            </button>
          ) : (
            <button className="btn btn--primary btn--lg" onClick={() => nav.go("finish")} disabled={nav.busy}>
              Finalizar revisión
            </button>
          )}
          {pending && (
            <button className="btn btn--soft" onClick={() => nav.go("goto", pending.id)} disabled={nav.busy}>
              Retomar pendientes ({st.pending})
            </button>
          )}
          {st.total > 0 && (
            <button className="btn btn--ghost" onClick={() => nav.go("prev")} disabled={nav.busy}>
              ← Volver a la última tarjeta
            </button>
          )}
          {st.pending > 0 && <p className="muted">Las pendientes conservan su estado: podés retomarlas más adelante.</p>}
        </div>
      ) : (
        <p className="waiting-po">
          <span className="status-pill__pulse" /> Esperando que el PO continúe…
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Resumen final
// ---------------------------------------------------------------------------
function ReviewDone({ live, review, nav, onContinue }: { live: RoomLive; review: ReviewState; nav: Nav; onContinue: () => Promise<void> | void }) {
  const total = statsFor(review.cards);
  const [continuing, setContinuing] = useState(false);
  const pending = firstPending(review);
  return (
    <main className="transition review-done" data-testid="review-done">
      <CharacterTrio theme={live.room.theme} />
      <h1 className="transition__title">¡Revisión completa!</h1>
      <p className="transition__line">Así quedó lo que conversamos como equipo.</p>

      <table className="review-table" data-testid="review-table">
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Tarjetas</th>
            <th>Revisadas</th>
            <th>Pendientes</th>
            <th>Para acción</th>
          </tr>
        </thead>
        <tbody>
          {PHASES.map((p) => {
            const st = statsFor(cardsOf(review, p.id as PhaseId));
            return (
              <tr key={p.id} className={`tone-${p.tone}`}>
                <td>
                  <span className="durations__dot" /> {p.name}
                </td>
                <td>{st.total}</td>
                <td>{st.reviewed}</td>
                <td>{st.pending}</td>
                <td>{st.actions}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr data-testid="review-total">
            <td>Total</td>
            <td>{total.total}</td>
            <td>{total.reviewed}</td>
            <td>{total.pending}</td>
            <td>{total.actions}</td>
          </tr>
        </tfoot>
      </table>

      {live.isPO ? (
        <div className="review-summary__actions">
          <button
            className="btn btn--primary btn--lg"
            onClick={async () => {
              setContinuing(true);
              await onContinue();
              setContinuing(false);
            }}
            disabled={continuing}
          >
            Continuar a la definición de compromisos
          </button>
          {pending && (
            <button className="btn btn--soft" onClick={() => nav.go("goto", pending.id)} disabled={nav.busy}>
              Retomar pendientes ({total.pending})
            </button>
          )}
        </div>
      ) : (
        <p className="waiting-po">
          <span className="status-pill__pulse" /> Esperando que el PO continúe con la definición de compromisos…
        </p>
      )}
    </main>
  );
}
