import { useCallback, useEffect, useState } from "react";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toasts";
import { RoomError, roomsApi, toSession } from "../features/rooms/api";
import { isValidCodeShape, normalizeCode } from "../features/rooms/code";
import { JoinRoomForm } from "../features/rooms/components/EntryForms";
import { WaitingRoom } from "../features/rooms/components/WaitingRoom";
import { RetroScreen } from "../features/retro/components/RetroScreen";
import { takePendingEntry } from "../features/rooms/pendingEntry";
import { clearSession, loadSession, saveSession } from "../features/rooms/session";
import type { EnterResult, Session } from "../features/rooms/types";
import { useRoomLive, type RoomNotice } from "../features/rooms/useRoomLive";
import { Link, roomPath, useRouter } from "../lib/router";

type Gate =
  | { step: "checking" }
  | { step: "join" }
  | { step: "inside"; session: Session; entry: EnterResult; key: number };

export function RoomPage({ code: rawCode }: { code: string }) {
  const code = normalizeCode(rawCode);
  const { navigate } = useRouter();
  const toast = useToast();
  const [gate, setGate] = useState<Gate>({ step: "checking" });

  const enter = useCallback(
    (entry: EnterResult, fresh: boolean) => {
      if (entry.room.code !== code) {
        // Ingresó con otro código desde el formulario de esta página.
        navigate(roomPath(entry.room.code));
        return;
      }
      const session = toSession(entry);
      saveSession(session); // fija la identidad en esta pestaña
      setGate({ step: "inside", session, entry, key: Date.now() });
      if (fresh && entry.reconnected) {
        toast(
          "success",
          entry.participant.role === "po"
            ? `¡Hola de nuevo, ${entry.participant.name}! Recuperaste tu rol de PO.`
            : `¡Hola de nuevo, ${entry.participant.name}!`,
        );
      }
    },
    [code, navigate, toast],
  );

  useEffect(() => {
    let cancelled = false;
    setGate({ step: "checking" });

    const pending = takePendingEntry(code);
    if (pending) {
      enter(pending, true);
      return;
    }
    const stored = isValidCodeShape(code) ? loadSession(code) : null;
    if (!stored) {
      setGate({ step: "join" });
      return;
    }
    roomsApi
      .resume(stored)
      .then((entry) => !cancelled && enter(entry, false))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof RoomError && e.code === "SESSION_INVALID") clearSession(code);
        setGate({ step: "join" });
        if (e instanceof RoomError && e.code === "NETWORK") toast("error", e.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (gate.step === "checking") {
    return (
      <div className="page center-screen">
        <span className="spinner spinner--lg" />
        <p className="muted">Entrando a la sala…</p>
      </div>
    );
  }

  if (gate.step === "join") {
    return (
      <div className="page center-screen">
        <div className="bg-blobs" aria-hidden="true">
          <span className="blob blob--violet" />
          <span className="blob blob--coral" />
        </div>
        <Link to="/" className="center-screen__logo">
          <Logo />
        </Link>
        <article className="action-card action-card--join invite-card">
          <span className="eyebrow">Te invitaron a una retrospectiva</span>
          <h1 className="action-card__title">Sumate a la sala {isValidCodeShape(code) ? code : ""}</h1>
          <p className="action-card__text">Escribí tu nombre para que el equipo te reconozca.</p>
          <JoinRoomForm onEntered={(r) => enter(r, true)} initialCode={isValidCodeShape(code) ? code : ""} autoFocusName />
        </article>
      </div>
    );
  }

  return (
    <RoomLiveView
      key={gate.key}
      session={gate.session}
      entry={gate.entry}
      onSessionLost={() => {
        clearSession(code);
        setGate({ step: "join" });
      }}
    />
  );
}

function RoomLiveView({
  session,
  entry,
  onSessionLost,
}: {
  session: Session;
  entry: EnterResult;
  onSessionLost: () => void;
}) {
  const toast = useToast();
  const { navigate } = useRouter();
  const notify = useCallback((n: RoomNotice) => toast(n.kind, n.text), [toast]);
  const live = useRoomLive(session, entry, notify);

  useEffect(() => {
    if (live.sessionLost) {
      toast("error", "Tu sesión ya no es válida. Volvé a ingresar con tu nombre.");
      onSessionLost();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.sessionLost]);

  const leave = async () => {
    try {
      await live.leave();
    } catch {
      /* si falla igual salimos: la presencia ya se liberó */
    }
    clearSession(session.roomCode);
    navigate("/");
  };

  // Según el estado de la sala se renderiza el módulo correspondiente.
  switch (live.room.status) {
    case "finished":
      // Retro cerrada desde la definición de compromisos: se muestra el cierre con el listado final.
      if (live.room.currentPhase === "closed") return <RetroScreen live={live} onLeave={leave} />;
      return <FinishedRoom code={live.room.code} onExit={leave} />;
    case "in_progress":
      return <RetroScreen live={live} onLeave={leave} />;
    case "waiting":
    default:
      return <WaitingRoom live={live} onLeave={leave} />;
  }
}

function FinishedRoom({ code, onExit }: { code: string; onExit: () => void }) {
  return (
    <div className="page center-screen">
      <Logo />
      <article className="action-card finished-card">
        <span className="eyebrow">Sala {code}</span>
        <h1 className="action-card__title">Esta retrospectiva finalizó</h1>
        <p className="action-card__text">¡Gracias por participar! La sala ya no admite nuevos ingresos.</p>
        <button className="btn btn--primary btn--block" onClick={onExit}>
          Volver al inicio
        </button>
      </article>
    </div>
  );
}
