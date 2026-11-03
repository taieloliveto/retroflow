import { useMemo, useRef, useState, type FormEvent } from "react";
import { Avatar } from "../../components/Avatar";
import { useToast } from "../../components/Toasts";
import { RoomError } from "../rooms/api";
import type { Commitment, CommitmentStatus, ReviewCard } from "../rooms/types";
import type { RoomLive } from "../rooms/useRoomLive";
import { newClientId, retroApi } from "../retro/api";
import { phaseById } from "../retro/phases";
import { STATUS_LABEL, downloadRetroResult, formatDue, sortCards } from "./export";

/**
 * Módulo 4 · Definición de compromisos (current_phase = "commitments") y
 * cierre de la retro (current_phase = "closed").
 * Solo el PO crea, edita y elimina; todos ven los cambios en tiempo real.
 */
export function CommitmentsScreen({ live }: { live: RoomLive }) {
  const cards = useMemo(() => sortCards((live.review?.cards ?? []).filter((c) => c.needsAction)), [live.review]);
  const commitments = live.commitments ?? [];
  if (live.room.currentPhase === "closed") return <ClosureScreen live={live} />;

  return (
    <main className="commit" data-testid="commitments">
      <section className="commit-head">
        <span className="review-head__eyebrow">Última etapa</span>
        <h1 className="commit-head__title">Definición de compromisos</h1>
        <p className="commit-head__text">
          Transformemos los accionables en compromisos concretos: qué se hará, quién se ocupa y para cuándo.
        </p>
        <div className="commit-head__stats">
          <span>
            <strong data-testid="commit-count">{commitments.length}</strong> compromisos
          </span>
          <span>
            <strong>{cards.length}</strong> tarjetas para generar acción
          </span>
        </div>
      </section>

      {cards.length === 0 ? (
        <p className="empty">
          No hay tarjetas marcadas con «Generar acción». {live.isPO ? "Podés finalizar la retro igual." : ""}
        </p>
      ) : (
        <div className="commit-list">
          {cards.map((c) => (
            <CardBlock key={c.id} live={live} card={c} commitments={commitments.filter((m) => m.cardId === c.id)} />
          ))}
        </div>
      )}

      {live.isPO ? (
        <FinishBar live={live} cards={cards} commitments={commitments} />
      ) : (
        <p className="waiting-po commit-wait">
          <span className="status-pill__pulse" /> El PO está definiendo los compromisos. Los ves acá en tiempo real.
        </p>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
function CardBlock({ live, card, commitments }: { live: RoomLive; card: ReviewCard; commitments: Commitment[] }) {
  const def = phaseById(card.phase);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  return (
    <article className={`commit-card tone-${def.tone}`} data-testid="commit-card">
      <div className="commit-card__origin">
        <div className="commit-card__meta">
          <span className="big-card__cat">{def.name}</span>
          <span className="commit-card__author">{card.anonymous || !card.authorName ? "Anónimo" : card.authorName}</span>
        </div>
        <h2 className="commit-card__title">{card.title}</h2>
        {card.body && <p className="commit-card__body">{card.body}</p>}
        <div className="commit-card__notes">
          <span className="commit-card__label">Accionables de la revisión</span>
          <p>{card.notes.trim() || "Sin accionables registrados."}</p>
        </div>
      </div>

      <div className="commit-card__items">
        <span className="commit-card__label">Compromisos ({commitments.length})</span>
        {commitments.length === 0 && editing !== "new" && (
          <p className="commit-none">{live.isPO ? "Todavía sin compromisos. Podés dejarla así si no corresponde una acción." : "Sin compromisos por ahora."}</p>
        )}
        <ul className="commit-items" data-testid="commit-items">
          {commitments.map((m) =>
            editing === m.id ? (
              <li key={m.id}>
                <CommitmentEditor live={live} card={card} existing={m} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={m.id}>
                <CommitmentRow live={live} m={m} onEdit={() => setEditing(m.id)} />
              </li>
            ),
          )}
        </ul>
        {live.isPO &&
          (editing === "new" ? (
            <CommitmentEditor live={live} card={card} onDone={() => setEditing(null)} />
          ) : (
            <button className="btn btn--soft btn--sm commit-add" onClick={() => setEditing("new")} disabled={editing !== null}>
              + Agregar compromiso
            </button>
          ))}
      </div>
    </article>
  );
}

function Owners({ owners, roomNames }: { owners: string[]; roomNames: Set<string> }) {
  if (owners.length === 0) return <span className="muted">Sin responsable</span>;
  return (
    <span className="owners">
      {owners.map((o) => (
        <span key={o} className={`owner ${roomNames.has(o.toLowerCase()) ? "" : "owner--ext"}`}>
          <Avatar name={o} size={20} />
          {o}
        </span>
      ))}
    </span>
  );
}

function CommitmentRow({ live, m, onEdit }: { live: RoomLive; m: Commitment; onEdit: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const roomNames = new Set(live.participants.map((p) => p.name.toLowerCase()));

  const remove = async () => {
    setBusy(true);
    try {
      await live.runAction(() => retroApi.deleteCommitment(live.session, m.id));
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
      toast("success", "Compromiso eliminado");
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos eliminar el compromiso.");
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className="commit-item" data-testid="commit-item">
      <p className="commit-item__action">{m.action}</p>
      <div className="commit-item__meta">
        <Owners owners={m.owners} roomNames={roomNames} />
        <span className={m.dueDate ? "due" : "muted"}>{m.dueDate ? `📅 ${formatDue(m.dueDate)}` : "Sin fecha"}</span>
        <span className={`cstatus cstatus--${m.status}`}>{STATUS_LABEL[m.status]}</span>
      </div>
      {live.isPO &&
        (confirm ? (
          <div className="commit-item__tools">
            <span>¿Eliminar este compromiso?</span>
            <button className="btn btn--danger btn--sm" onClick={remove} disabled={busy}>
              Eliminar
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="commit-item__tools">
            <button className="link-btn link-btn--neutral" onClick={onEdit}>
              Editar
            </button>
            <button className="link-btn" onClick={() => setConfirm(true)}>
              Eliminar
            </button>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function CommitmentEditor({
  live,
  card,
  existing,
  onDone,
}: {
  live: RoomLive;
  card: ReviewCard;
  existing?: Commitment;
  onDone: () => void;
}) {
  const toast = useToast();
  // El accionable de la revisión es el texto inicial de cada compromiso nuevo.
  const [action, setAction] = useState(existing?.action ?? card.notes.trim());
  const [owners, setOwners] = useState<string[]>(existing?.owners ?? []);
  const [due, setDue] = useState(existing?.dueDate ?? "");
  const [status, setStatus] = useState<CommitmentStatus>(existing?.status ?? "pending");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useRef(existing?.id ?? newClientId());

  const has = (name: string) => owners.some((o) => o.toLowerCase() === name.toLowerCase());
  const toggle = (name: string) =>
    setOwners((list) => (has(name) ? list.filter((o) => o.toLowerCase() !== name.toLowerCase()) : [...list, name]));
  const addExtra = () => {
    const n = extra.replace(/\s+/g, " ").trim();
    if (!n) return;
    if (n.length > 60) return setError("El nombre puede tener hasta 60 caracteres.");
    if (!has(n)) setOwners((l) => [...l, n]);
    setExtra("");
  };
  const roomNames = live.participants.map((p) => p.name);
  const externals = owners.filter((o) => !roomNames.some((n) => n.toLowerCase() === o.toLowerCase()));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!action.trim()) return setError("Describí la acción que se va a realizar.");
    setBusy(true);
    setError(null);
    try {
      await live.runAction(() =>
        retroApi.saveCommitment(live.session, { id: id.current, cardId: card.id, action, owners, dueDate: due || null, status }),
      );
      await live.channel.send("room:updated", { status: "in_progress" }).catch(() => undefined);
      toast("success", existing ? "Compromiso actualizado" : "Compromiso creado");
      onDone();
    } catch (err) {
      setError(err instanceof RoomError ? err.message : "No pudimos guardar el compromiso. Probá de nuevo.");
      setBusy(false);
    }
  };

  return (
    <form className="commit-editor" onSubmit={submit} data-testid="commit-editor" noValidate>
      <label className="field">
        <span className="field__label">Acción</span>
        <textarea
          className="input"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="¿Qué se va a hacer, concretamente?"
          aria-label="Acción"
          autoFocus
        />
      </label>

      <div className="field">
        <span className="field__label">Responsables</span>
        <div className="owner-picker">
          {live.participants.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`owner-opt ${has(p.name) ? "is-on" : ""}`}
              aria-pressed={has(p.name)}
              onClick={() => toggle(p.name)}
            >
              <Avatar name={p.name} size={22} />
              {p.name}
            </button>
          ))}
          {externals.map((n) => (
            <button type="button" key={n} className="owner-opt owner-opt--ext is-on" aria-pressed onClick={() => toggle(n)} title="Quitar">
              {n} ✕
            </button>
          ))}
        </div>
        <div className="owner-extra">
          <input
            className="input"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExtra();
              }
            }}
            placeholder="Agregar a alguien que no está en la sala"
            aria-label="Responsable externo"
            maxLength={60}
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={addExtra}>
            Agregar
          </button>
        </div>
      </div>

      <div className="commit-editor__row">
        <label className="field">
          <span className="field__label">Fecha objetivo (opcional)</span>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fecha objetivo" />
        </label>
        <label className="field">
          <span className="field__label">Estado</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as CommitmentStatus)} aria-label="Estado">
            <option value="pending">Pendiente</option>
            <option value="in_progress">En progreso</option>
            <option value="done">Completada</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="commit-editor__actions">
        <button className="btn btn--primary btn--sm" disabled={busy}>
          {busy ? "Guardando…" : existing ? "Guardar cambios" : "Guardar compromiso"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function commitmentStats(cards: ReviewCard[], commitments: Commitment[]) {
  return {
    total: commitments.length,
    withOwner: commitments.filter((m) => m.owners.length > 0).length,
    withoutOwner: commitments.filter((m) => m.owners.length === 0).length,
    withDate: commitments.filter((m) => m.dueDate).length,
    withoutDate: commitments.filter((m) => !m.dueDate).length,
    cardsWithout: cards.filter((c) => !commitments.some((m) => m.cardId === c.id)).length,
  };
}

function FinishBar({ live, cards, commitments }: { live: RoomLive; cards: ReviewCard[]; commitments: Commitment[] }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const st = commitmentStats(cards, commitments);

  const finish = async () => {
    setBusy(true);
    try {
      await live.runAction(() => retroApi.finishCommitments(live.session));
      await live.channel.send("room:updated", { status: "finished" }).catch(() => undefined);
    } catch (e) {
      toast("error", e instanceof RoomError ? e.message : "No pudimos finalizar.");
      setBusy(false);
    }
  };

  if (!asking)
    return (
      <div className="finish-bar">
        <button className="btn btn--primary btn--lg" onClick={() => setAsking(true)}>
          Finalizar definición de compromisos
        </button>
      </div>
    );

  return (
    <section className="card finish-confirm" data-testid="finish-confirm">
      <h2 className="section-title">Antes de cerrar, revisemos</h2>
      <dl className="finish-stats">
        <div>
          <dt>Compromisos definidos</dt>
          <dd data-testid="fs-total">{st.total}</dd>
        </div>
        <div>
          <dt>Con responsable</dt>
          <dd data-testid="fs-owner">{st.withOwner}</dd>
        </div>
        <div className={st.withoutOwner ? "is-warn" : ""}>
          <dt>Sin responsable</dt>
          <dd data-testid="fs-noowner">{st.withoutOwner}</dd>
        </div>
        <div>
          <dt>Con fecha objetivo</dt>
          <dd data-testid="fs-date">{st.withDate}</dd>
        </div>
        <div className={st.withoutDate ? "is-warn" : ""}>
          <dt>Sin fecha objetivo</dt>
          <dd data-testid="fs-nodate">{st.withoutDate}</dd>
        </div>
        <div>
          <dt>Tarjetas sin compromisos</dt>
          <dd data-testid="fs-cards">{st.cardsWithout}</dd>
        </div>
      </dl>
      {(st.withoutOwner > 0 || st.withoutDate > 0) && (
        <p className="muted">Podés cerrar igual: los datos faltantes quedan registrados como «sin responsable» o «sin fecha».</p>
      )}
      <div className="finish-confirm__actions">
        <button className="btn btn--primary" onClick={finish} disabled={busy}>
          {busy ? "Cerrando…" : "Confirmar y cerrar la retro"}
        </button>
        <button className="btn btn--ghost" onClick={() => setAsking(false)} disabled={busy}>
          Seguir editando
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function ClosureScreen({ live }: { live: RoomLive }) {
  const commitments = live.commitments ?? [];
  const cards = live.review?.cards ?? [];
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const roomNames = new Set(live.participants.map((p) => p.name.toLowerCase()));
  const ordered = [...commitments].sort((a, b) => {
    const ca = cardById.get(a.cardId);
    const cb = cardById.get(b.cardId);
    const r = { destacar: 0, mejorar: 1, mantener: 2 };
    return (ca ? r[ca.phase] : 9) - (cb ? r[cb.phase] : 9) || (ca?.order ?? 0) - (cb?.order ?? 0);
  });

  return (
    <main className="transition closure" data-testid="closure">
      <div className="done__burst" aria-hidden="true">
        <span className="tone-blue" />
        <span className="tone-coral" />
        <span className="tone-green" />
      </div>
      <h1 className="transition__title">¡Retro cerrada! Estos son nuestros compromisos</h1>
      <p className="transition__line">
        {commitments.length === 0
          ? "No se definieron compromisos en esta retrospectiva."
          : `${commitments.length} ${commitments.length === 1 ? "compromiso acordado" : "compromisos acordados"} por el equipo.`}
      </p>

      {live.isPO && (
        <button className="btn btn--primary btn--lg" onClick={() => downloadRetroResult(live)} data-testid="download-xlsx">
          ⬇ Descargar resultados (.xlsx)
        </button>
      )}

      {commitments.length > 0 && (
        <ul className="closure-list" data-testid="closure-list">
          {ordered.map((m) => {
            const card = cardById.get(m.cardId);
            const def = card ? phaseById(card.phase) : null;
            return (
              <li key={m.id} className={`closure-item ${def ? `tone-${def.tone}` : ""}`}>
                <div className="closure-item__main">
                  <p className="closure-item__action">{m.action}</p>
                  {card && (
                    <p className="closure-item__origin">
                      {def?.name} · {card.title}
                    </p>
                  )}
                </div>
                <div className="closure-item__meta">
                  <Owners owners={m.owners} roomNames={roomNames} />
                  <span className={m.dueDate ? "due" : "muted"}>{m.dueDate ? `📅 ${formatDue(m.dueDate)}` : "Sin fecha"}</span>
                  <span className={`cstatus cstatus--${m.status}`}>{STATUS_LABEL[m.status]}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
